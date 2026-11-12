import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { dateValue, todayIn } from "@/lib/dates";
import type { EmailSender } from "@/lib/email";
import type { Quote, QuoteItem } from "@/lib/generated/prisma/client";
import type { TenantData, TenantDb } from "@/lib/tenant/core";
import type { PublicLink } from "@/lib/tenant/public";

/**
 * The customer's side of a quote (spec §7.5, decisions D15 and D16): the
 * public page behind a share link, first-view tracking, acceptance confirmed
 * by an emailed code, and rejection. No session: the link is the credential,
 * and every query runs as a tenant transaction for the link's workspace.
 */

export interface PublicDeps {
  data: TenantData;
  links: { quoteLink(token: string): Promise<PublicLink | null> };
  email: EmailSender;
  now?: () => Date;
}

export interface Visitor {
  ipAddress: string | null;
  userAgent: string | null;
}

export const CODE_TTL_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_CODES_PER_HOUR = 5;
/** Repeated page loads within this window are one view. */
const VIEW_WINDOW_MS = 30 * 60_000;

const clip = (value: string | null, max: number) => (value ? value.slice(0, max) : null);

/** Hides most of an address: "chidi@okafor.ng" → "c••••@okafor.ng". */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}${"•".repeat(Math.max(1, local.length - 1))}@${domain}`;
}

/** SHA-256 of what the customer saw, so an acceptance names its exact version. */
export function contentHash(quote: Quote & { items: QuoteItem[] }): string {
  const canonical = JSON.stringify(
    {
      id: quote.id, number: quote.number, revision: quote.revision, currency: quote.currency, taxMode: quote.taxMode,
      issuedOn: quote.issuedOn, expiresOn: quote.expiresOn, recipientName: quote.recipientName, recipientEmail: quote.recipientEmail,
      customerSnapshot: quote.customerSnapshot, notes: quote.notes, terms: quote.terms,
      subtotalMinor: quote.subtotalMinor, discountMinor: quote.discountMinor, taxMinor: quote.taxMinor, totalMinor: quote.totalMinor,
      taxLines: quote.taxLines,
      items: quote.items
        .sort((a, b) => a.position - b.position)
        .map((i) => [i.position, i.description, i.quantityMilli, i.unit, i.unitPriceMinor, i.discountKind, i.discountValue, i.taxName, i.taxMilliPercent, i.netMinor]),
    },
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

const codeHash = (codeId: string, code: string) => createHash("sha256").update(`${codeId}:${code}`).digest("hex");

type Loaded = { link: PublicLink; quote: Quote & { items: QuoteItem[] }; today: string };

/** Resolves a token to its live quote, or null for anything that should look like "no such link". */
async function load(deps: PublicDeps, tenant: TenantDb, link: PublicLink, now: Date): Promise<Loaded | null> {
  const quote = await tenant.quote.findUnique({ where: { id: link.quoteId }, include: { items: { orderBy: { position: "asc" } } } });
  if (!quote || quote.status === "draft") return null;
  // A newer sent revision replaces this one for the customer whatever its own
  // status (D16): a declined quote that was revised is replaced too.
  const newer = await tenant.quote.findFirst({
    where: { number: quote.number, revision: { gt: quote.revision }, status: { not: "draft" } },
    select: { id: true },
  });
  const replaced = newer && quote.status !== "superseded" ? { ...quote, status: "superseded" } : quote;
  return { link, quote: replaced, today: todayIn(link.organization.timezone, now) };
}

const isOpen = (quote: Quote, today: string) => quote.status === "sent" && quote.expiresOn >= dateValue(today);

export type PublicQuoteView =
  | { state: "invalid" }
  | { state: "superseded"; seller: string }
  | {
      state: "ready";
      seller: { name: string; locale: string };
      quote: Quote & { items: QuoteItem[] };
      /** Accept or reject is possible now. */
      open: boolean;
      expired: boolean;
      acceptance: { name: string | null; at: Date } | null;
      /** A code was sent recently and can still be entered. */
      pendingCode: { sentTo: string } | null;
      /** Where a code will go: the quote's recipient, or null to ask the customer. */
      recipientEmail: string | null;
    };

/** Shows the quote behind a link and records the first view. */
export async function openQuote(deps: PublicDeps, token: string, visitor: Visitor): Promise<PublicQuoteView> {
  const now = deps.now?.() ?? new Date();
  const link = await deps.links.quoteLink(token);
  if (!link || link.revokedAt) return { state: "invalid" };
  return deps.data.transaction(link.organizationId, async (tenant) => {
    const loaded = await load(deps, tenant, link, now);
    if (!loaded) return { state: "invalid" } as const;
    const { quote, today } = loaded;
    if (quote.status === "superseded") return { state: "superseded", seller: link.organization.name } as const;

    if (quote.status === "sent" && !quote.viewedAt) {
      await tenant.quote.updateMany({ where: { id: quote.id, viewedAt: null }, data: { viewedAt: now } });
    }
    const recent = await tenant.quoteEvent.findFirst({
      where: { quoteId: quote.id, linkId: link.id, kind: "viewed", createdAt: { gt: new Date(now.getTime() - VIEW_WINDOW_MS) } },
    });
    if (!recent) {
      await tenant.quoteEvent.create({
        data: {
          quoteId: quote.id, linkId: link.id, kind: "viewed", ipAddress: clip(visitor.ipAddress, 100), userAgent: clip(visitor.userAgent, 500),
          createdAt: now,
        },
      });
    }
    const accepted = quote.status === "accepted"
      ? await tenant.quoteEvent.findFirst({ where: { quoteId: quote.id, kind: "accepted" }, orderBy: { createdAt: "desc" } })
      : null;
    const code = isOpen(quote, today)
      ? await tenant.quoteAcceptanceCode.findFirst({
          where: { quoteId: quote.id, linkId: link.id, usedAt: null, expiresAt: { gt: now }, attempts: { lt: MAX_CODE_ATTEMPTS } },
          orderBy: { createdAt: "desc" },
        })
      : null;
    return {
      state: "ready",
      seller: { name: link.organization.name, locale: link.organization.locale },
      quote: { ...quote, viewedAt: quote.viewedAt ?? (quote.status === "sent" ? now : null) },
      open: isOpen(quote, today),
      expired: quote.status === "sent" && !isOpen(quote, today),
      acceptance: quote.acceptedAt ? { name: accepted?.name ?? null, at: quote.acceptedAt } : null,
      pendingCode: code ? { sentTo: maskEmail(code.email) } : null,
      recipientEmail: quote.recipientEmail ? maskEmail(quote.recipientEmail) : null,
    } as const;
  });
}

export type PublicResult = { ok: true; message: string } | { ok: false; message: string; fields?: Record<string, string> };

const requestSchema = z.object({
  name: z.string().trim().min(1, { error: "is required" }).max(200),
  email: z.string().trim().toLowerCase().max(254).optional(),
});

/** Runs `work` for an open quote behind a valid link; anything else gets one generic answer. */
async function withOpenQuote(
  deps: PublicDeps,
  token: string,
  work: (tenant: TenantDb, loaded: Loaded, now: Date) => Promise<PublicResult>,
): Promise<PublicResult> {
  const now = deps.now?.() ?? new Date();
  const link = await deps.links.quoteLink(token);
  if (!link || link.revokedAt) return { ok: false, message: "This link is not valid." };
  return deps.data.transaction(link.organizationId, async (tenant) => {
    const loaded = await load(deps, tenant, link, now);
    if (!loaded) return { ok: false, message: "This link is not valid." };
    if (!isOpen(loaded.quote, loaded.today)) {
      const { status } = loaded.quote;
      return {
        ok: false,
        message:
          status === "sent"
            ? "This quote has expired, so it can no longer be accepted."
            : status === "superseded"
              ? "This quote was replaced by a newer version. Ask for the latest link."
              : "This quote has already been answered.",
      };
    }
    return work(tenant, loaded, now);
  });
}

/**
 * Step 1 of acceptance: email a 6-digit code to the quote's recipient (or,
 * without one, the address the customer gives). Limited per quote per hour.
 */
export async function requestAcceptanceCode(deps: PublicDeps, token: string, input: unknown, visitor: Visitor): Promise<PublicResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter your full name.", fields: { name: "is required" } };
  return withOpenQuote(deps, token, async (tenant, { link, quote }, now) => {
    const to = quote.recipientEmail ?? parsed.data.email ?? "";
    if (!z.email().safeParse(to).success) {
      return { ok: false, message: "Enter the email address to send your code to.", fields: { email: "must be a valid email address" } };
    }
    const recent = await tenant.quoteAcceptanceCode.count({ where: { quoteId: quote.id, createdAt: { gt: new Date(now.getTime() - 3_600_000) } } });
    if (recent >= MAX_CODES_PER_HOUR) return { ok: false, message: "Too many codes were requested for this quote. Try again in an hour." };

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const id = randomUUID();
    const row = await tenant.quoteAcceptanceCode.create({
      data: {
        id, quoteId: quote.id, linkId: link.id, email: to, name: parsed.data.name,
        codeHash: codeHash(id, code), expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000), createdAt: now,
      },
    });
    await tenant.quoteEvent.create({
      data: {
        quoteId: quote.id, linkId: link.id, kind: "code_sent", name: parsed.data.name, email: to,
        ipAddress: clip(visitor.ipAddress, 100), userAgent: clip(visitor.userAgent, 500), createdAt: now,
      },
    });
    // Inside the transaction: if the email fails, no code or event is kept.
    await deps.email.send({
      to,
      subject: `${code} is your code to accept quote ${quote.number}`,
      text: [
        `Your code to accept quote ${quote.number} from ${link.organization.name} is: ${code}`,
        "",
        `It expires in ${CODE_TTL_MINUTES} minutes. If you did not ask for it, ignore this email; nothing has been accepted.`,
      ].join("\n"),
      idempotencyKey: `quote-code-${row.id}`,
    });
    return { ok: true, message: `We sent a 6-digit code to ${maskEmail(to)}.` };
  });
}

/** Step 2: the code confirms acceptance of this exact version. */
export async function confirmAcceptance(deps: PublicDeps, token: string, input: unknown, visitor: Visitor): Promise<PublicResult> {
  const code = String((input as { code?: unknown })?.code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, message: "Enter the 6-digit code from the email.", fields: { code: "must be 6 digits" } };

  // A wrong guess must count even though the request fails, so attempts are
  // recorded in their own transaction before the answer is decided.
  const verdict = await withOpenQuote(deps, token, async (tenant, { link, quote }, now) => {
    const pending = await tenant.quoteAcceptanceCode.findFirst({
      where: { quoteId: quote.id, linkId: link.id, usedAt: null, expiresAt: { gt: now }, attempts: { lt: MAX_CODE_ATTEMPTS } },
      orderBy: { createdAt: "desc" },
    });
    if (!pending) return { ok: false, message: "That code has expired or was used up. Request a new one." };
    await tenant.quoteAcceptanceCode.updateMany({ where: { id: pending.id }, data: { attempts: { increment: 1 } } });
    const expected = Buffer.from(pending.codeHash, "hex");
    const given = Buffer.from(codeHash(pending.id, code), "hex");
    if (!timingSafeEqual(expected, given)) {
      const left = MAX_CODE_ATTEMPTS - pending.attempts - 1;
      return { ok: false, message: left > 0 ? `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code is not right. Request a new one." };
    }
    return { ok: true, message: pending.id };
  });
  if (!verdict.ok) return verdict;

  return withOpenQuote(deps, token, async (tenant, { link, quote }, now) => {
    const used = await tenant.quoteAcceptanceCode.updateMany({ where: { id: verdict.message, usedAt: null }, data: { usedAt: now } });
    const pending = await tenant.quoteAcceptanceCode.findUnique({ where: { id: verdict.message } });
    if (used.count !== 1 || !pending) return { ok: false, message: "That code was already used. Request a new one." };
    const { count } = await tenant.quote.updateMany({
      where: { id: quote.id, status: "sent" },
      data: { status: "accepted", acceptedAt: now, version: { increment: 1 } },
    });
    if (count !== 1) return { ok: false, message: "This quote has already been answered." };
    await tenant.quoteEvent.create({
      data: {
        quoteId: quote.id, linkId: link.id, kind: "accepted", name: pending.name, email: pending.email,
        ipAddress: clip(visitor.ipAddress, 100), userAgent: clip(visitor.userAgent, 500), contentHash: contentHash(quote),
        createdAt: now,
      },
    });
    await recordAudit(tenant, {
      action: "quote.accepted", actorUserId: null, targetType: "quote", targetId: quote.id,
      metadata: { number: quote.number, revision: quote.revision, via: "public_link" },
    });
    return { ok: true, message: `Thank you, ${pending.name}. You accepted quote ${quote.number}.` };
  });
}

const rejectSchema = z.object({
  name: z.string().trim().max(200).optional(),
  reason: z.string().trim().max(1000, { error: "must be at most 1000 characters" }).optional(),
});

/** Declining needs no code: it commits the customer to nothing. */
export async function rejectQuote(deps: PublicDeps, token: string, input: unknown, visitor: Visitor): Promise<PublicResult> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "The reason is too long.", fields: { reason: "must be at most 1000 characters" } };
  return withOpenQuote(deps, token, async (tenant, { link, quote }, now) => {
    const { count } = await tenant.quote.updateMany({
      where: { id: quote.id, status: "sent" },
      data: { status: "rejected", rejectedAt: now, version: { increment: 1 } },
    });
    if (count !== 1) return { ok: false, message: "This quote has already been answered." };
    await tenant.quoteEvent.create({
      data: {
        quoteId: quote.id, linkId: link.id, kind: "rejected", name: parsed.data.name || null, reason: parsed.data.reason || null,
        ipAddress: clip(visitor.ipAddress, 100), userAgent: clip(visitor.userAgent, 500), createdAt: now,
      },
    });
    await recordAudit(tenant, {
      action: "quote.rejected", actorUserId: null, targetType: "quote", targetId: quote.id,
      metadata: { number: quote.number, revision: quote.revision, via: "public_link" },
    });
    return { ok: true, message: `You declined quote ${quote.number}. Your answer has been recorded for ${link.organization.name}.` };
  });
}
