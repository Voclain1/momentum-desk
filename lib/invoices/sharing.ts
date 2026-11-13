import { randomBytes } from "node:crypto";
import { recordAudit } from "@/lib/audit";
import type { EmailSender } from "@/lib/email";
import { RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { formatMoney, money } from "@/lib/money";
import type { TenantData } from "@/lib/tenant/core";
import { hashToken } from "@/lib/tenant/public";
import type { Actor } from "./service";

/**
 * Sharing an issued invoice with the customer (decision D16, as for quotes):
 * links shown once and stored only as a hash, revocation, emailing a link.
 * Callers check invoices:write (invoices:read to list).
 */

export const invoicePath = (token: string) => `/i/${token}`;

async function shareable(tenant: Parameters<Parameters<TenantData["transaction"]>[1]>[0], invoiceId: string) {
  const invoice = await tenant.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new RecordNotFoundError("Invoice");
  if (invoice.status !== "issued") {
    throw new RecordConflictError(invoice.status === "draft" ? "This invoice is still a draft, so it" : "This invoice is void, so it");
  }
  return invoice;
}

export async function createInvoiceLink(data: TenantData, actor: Actor, invoiceId: string) {
  const token = randomBytes(32).toString("base64url");
  await data.transaction(actor.organizationId, async (tenant) => {
    await shareable(tenant, invoiceId);
    await tenant.invoiceLink.create({ data: { invoiceId, tokenHash: hashToken(token), createdById: actor.userId } });
    await recordAudit(tenant, { action: "invoice.link_created", actorUserId: actor.userId, targetType: "invoice", targetId: invoiceId });
  });
  return { token };
}

export async function revokeInvoiceLinks(data: TenantData, actor: Actor, invoiceId: string) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const invoice = await tenant.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new RecordNotFoundError("Invoice");
    const { count } = await tenant.invoiceLink.updateMany({ where: { invoiceId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count) {
      await recordAudit(tenant, { action: "invoice.links_revoked", actorUserId: actor.userId, targetType: "invoice", targetId: invoiceId, metadata: { count } });
    }
    return { revoked: count };
  });
}

/** Emails a fresh link to the invoice's recipient; a failed email keeps nothing. */
export async function emailInvoice(
  data: TenantData,
  actor: Actor,
  invoiceId: string,
  { appUrl, seller, locale, email }: { appUrl: string; seller: string; locale: string; email: EmailSender },
) {
  const token = randomBytes(32).toString("base64url");
  return data.transaction(actor.organizationId, async (tenant) => {
    const invoice = await shareable(tenant, invoiceId);
    if (!invoice.recipientEmail) throw new RecordConflictError("This invoice has no recipient email, so it");
    await tenant.invoiceLink.create({ data: { invoiceId, tokenHash: hashToken(token), createdById: actor.userId } });
    await recordAudit(tenant, { action: "invoice.emailed", actorUserId: actor.userId, targetType: "invoice", targetId: invoiceId });
    const owed = formatMoney(money(invoice.totalMinor - invoice.paidMinor, invoice.currency), locale);
    const due = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(invoice.dueOn);
    await email.send({
      to: invoice.recipientEmail,
      subject: `Invoice ${invoice.number} from ${seller}`,
      text: [
        `Hello${invoice.recipientName ? ` ${invoice.recipientName}` : ""},`,
        "",
        `${seller} has sent you invoice ${invoice.number} for ${owed}, due ${due}.`,
        "",
        `View or download it here: ${new URL(invoicePath(token), appUrl).toString()}`,
        "",
        "This link is private to you; anyone who has it can see the invoice.",
      ].join("\n"),
      idempotencyKey: `invoice-${invoiceId}-${hashToken(token).slice(0, 16)}`,
    });
    return { sentTo: invoice.recipientEmail };
  });
}

/** Links (without tokens) and views, for the invoice page. */
export async function invoiceActivity(data: TenantData, organizationId: string, invoiceId: string) {
  const tenant = data.scoped(organizationId);
  const [links, events] = await Promise.all([
    tenant.invoiceLink.findMany({ where: { invoiceId }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, revokedAt: true } }),
    tenant.invoiceEvent.findMany({ where: { invoiceId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return { links, events };
}
