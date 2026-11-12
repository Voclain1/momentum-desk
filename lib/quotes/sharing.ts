import { randomBytes } from "node:crypto";
import { recordAudit } from "@/lib/audit";
import type { EmailSender } from "@/lib/email";
import { RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import type { TenantData } from "@/lib/tenant/core";
import { hashToken } from "@/lib/tenant/public";
import type { Actor } from "./service";

/**
 * Sharing a quote with the customer (decision D16): links whose token is
 * shown once and stored only as a hash, revocation, and emailing the link.
 * Callers check quotes:write (quotes:read to list).
 */

/** Statuses a customer may be shown. Drafts are not ready; superseded ones point nowhere. */
const SHAREABLE = new Set(["sent", "accepted", "rejected"]);

export const quotePath = (token: string) => `/q/${token}`;

/** A new link. The token is returned once, never stored, and cannot be recovered. */
export async function createShareLink(data: TenantData, actor: Actor, quoteId: string) {
  const token = randomBytes(32).toString("base64url");
  const link = await data.transaction(actor.organizationId, async (tenant) => {
    const quote = await tenant.quote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new RecordNotFoundError("Quote");
    if (!SHAREABLE.has(quote.status)) {
      throw new RecordConflictError(quote.status === "draft" ? "This quote is still a draft, so it" : "This quote was replaced by a newer revision, so it");
    }
    const created = await tenant.quoteLink.create({ data: { quoteId, tokenHash: hashToken(token), createdById: actor.userId } });
    await recordAudit(tenant, { action: "quote.link_created", actorUserId: actor.userId, targetType: "quote", targetId: quoteId });
    return created;
  });
  return { token, linkId: link.id };
}

/** Stops every link to this quote revision from working. */
export async function revokeShareLinks(data: TenantData, actor: Actor, quoteId: string) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const quote = await tenant.quote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new RecordNotFoundError("Quote");
    const { count } = await tenant.quoteLink.updateMany({ where: { quoteId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count) {
      await recordAudit(tenant, { action: "quote.links_revoked", actorUserId: actor.userId, targetType: "quote", targetId: quoteId, metadata: { count } });
    }
    return { revoked: count };
  });
}

/**
 * Creates a link and emails it to the quote's recipient. A failed email
 * rolls the link back, so no unsent link is left behind.
 */
export async function emailQuote(
  data: TenantData,
  actor: Actor,
  quoteId: string,
  { appUrl, seller, email }: { appUrl: string; seller: string; email: EmailSender },
) {
  const token = randomBytes(32).toString("base64url");
  return data.transaction(actor.organizationId, async (tenant) => {
    const quote = await tenant.quote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new RecordNotFoundError("Quote");
    if (quote.status !== "sent") throw new RecordConflictError("Only a sent quote can be emailed, so this one");
    if (!quote.recipientEmail) throw new RecordConflictError("This quote has no recipient email, so it");
    await tenant.quoteLink.create({ data: { quoteId, tokenHash: hashToken(token), createdById: actor.userId } });
    await recordAudit(tenant, { action: "quote.emailed", actorUserId: actor.userId, targetType: "quote", targetId: quoteId });
    const url = new URL(quotePath(token), appUrl).toString();
    await email.send({
      to: quote.recipientEmail,
      subject: `Quote ${quote.number} from ${seller}`,
      text: [
        `Hello${quote.recipientName ? ` ${quote.recipientName}` : ""},`,
        "",
        `${seller} has sent you quote ${quote.number}${quote.revision > 1 ? ` (revision ${quote.revision})` : ""}.`,
        "",
        `View, accept or decline it here: ${url}`,
        "",
        "This link is private to you; anyone who has it can see the quote.",
      ].join("\n"),
      idempotencyKey: `quote-${quoteId}-${hashToken(token).slice(0, 16)}`,
    });
    return { sentTo: quote.recipientEmail };
  });
}

/** Links (without tokens) and public-page events, for the quote page. */
export async function quoteActivity(data: TenantData, organizationId: string, quoteId: string) {
  const tenant = data.scoped(organizationId);
  const [links, events] = await Promise.all([
    tenant.quoteLink.findMany({
      where: { quoteId },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, revokedAt: true, createdBy: { select: { name: true } } },
    }),
    tenant.quoteEvent.findMany({ where: { quoteId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return { links, events };
}
