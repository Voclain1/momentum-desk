import type { Invoice, InvoiceItem } from "@/lib/generated/prisma/client";
import { todayIn } from "@/lib/dates";
import type { TenantData } from "@/lib/tenant/core";
import type { PublicLink } from "@/lib/tenant/public";
import { invoiceStatus, type InvoiceStatus } from "./service";

/**
 * The customer's view of an invoice behind a share link (D16): no session;
 * the link is the credential and everything runs as a tenant transaction for
 * its workspace. The first view is recorded, then at most one view event per
 * link per half hour. Online payment comes with providers in M4.
 */

export interface InvoicePublicDeps {
  data: TenantData;
  links: { invoiceLink(token: string): Promise<(PublicLink & { invoiceId: string }) | null> };
  now?: () => Date;
}

export interface Visitor {
  ipAddress: string | null;
  userAgent: string | null;
}

const VIEW_WINDOW_MS = 30 * 60_000;
const clip = (value: string | null, max: number) => (value ? value.slice(0, max) : null);

export type PublicInvoiceView =
  | { state: "invalid" }
  | { state: "ready"; seller: { name: string; locale: string }; invoice: Invoice & { items: InvoiceItem[] }; status: InvoiceStatus };

export async function openInvoice(deps: InvoicePublicDeps, token: string, visitor: Visitor): Promise<PublicInvoiceView> {
  const now = deps.now?.() ?? new Date();
  const link = await deps.links.invoiceLink(token);
  if (!link || link.revokedAt) return { state: "invalid" };
  return deps.data.transaction(link.organizationId, async (tenant) => {
    const invoice = await tenant.invoice.findUnique({ where: { id: link.invoiceId }, include: { items: { orderBy: { position: "asc" } } } });
    if (!invoice || invoice.status === "draft") return { state: "invalid" } as const;
    if (invoice.status === "issued" && !invoice.viewedAt) {
      await tenant.invoice.updateMany({ where: { id: invoice.id, viewedAt: null }, data: { viewedAt: now } });
    }
    const recent = await tenant.invoiceEvent.findFirst({
      where: { invoiceId: invoice.id, linkId: link.id, createdAt: { gt: new Date(now.getTime() - VIEW_WINDOW_MS) } },
    });
    if (!recent) {
      await tenant.invoiceEvent.create({
        data: {
          invoiceId: invoice.id, linkId: link.id, kind: "viewed",
          ipAddress: clip(visitor.ipAddress, 100), userAgent: clip(visitor.userAgent, 500), createdAt: now,
        },
      });
    }
    const shown = { ...invoice, viewedAt: invoice.viewedAt ?? (invoice.status === "issued" ? now : null) };
    return {
      state: "ready",
      seller: { name: link.organization.name, locale: link.organization.locale },
      invoice: shown,
      status: invoiceStatus(shown, todayIn(link.organization.timezone, now)),
    } as const;
  });
}

/** The invoice behind a live link, for its PDF. Records nothing. */
export async function invoiceForDownload(deps: InvoicePublicDeps, token: string) {
  const link = await deps.links.invoiceLink(token);
  if (!link || link.revokedAt) return null;
  return deps.data.transaction(link.organizationId, async (tenant) => {
    const invoice = await tenant.invoice.findUnique({ where: { id: link.invoiceId }, include: { items: { orderBy: { position: "asc" } } } });
    if (!invoice || invoice.status === "draft") return null;
    return { invoice, seller: link.organization };
  });
}
