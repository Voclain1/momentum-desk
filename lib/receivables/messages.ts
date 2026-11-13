import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import type { EmailSender } from "@/lib/email";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { invoicePath } from "@/lib/invoices/sharing";
import type { TenantData } from "@/lib/tenant/core";
import { hashToken } from "@/lib/tenant/public";

/**
 * A person emails a customer about an invoice (collections:write), usually
 * after editing an AI draft (spec §7.8: people approve external messages).
 * A link to view and pay the invoice is added under the message. Recorded
 * as a collection note and in the audit log; a failed email changes nothing.
 */

const messageSchema = z.strictObject({
  subject: z.string().trim().min(3, { error: "is required" }).max(150, { error: "must be at most 150 characters" }),
  body: z.string().trim().min(10, { error: "is required" }).max(5000, { error: "must be at most 5,000 characters" }),
  aiDrafted: z.boolean(),
});

export async function sendCollectionMessage(
  data: TenantData,
  actor: { organizationId: string; userId: string },
  invoiceId: string,
  input: unknown,
  deps: { email: EmailSender; appUrl: string },
) {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) throw new InputValidationError(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const { subject, body, aiDrafted } = parsed.data;
  const token = randomBytes(32).toString("base64url");
  return data.transaction(actor.organizationId, async (tenant) => {
    const invoice = await tenant.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.status === "draft") throw new RecordNotFoundError("Invoice");
    if (invoice.status !== "issued" || invoice.outstandingMinor <= 0n) throw new RecordConflictError("Nothing is owed on this invoice now.");
    if (!invoice.recipientEmail) throw new RecordConflictError("This invoice has no email address to send to.");
    await tenant.invoiceLink.create({ data: { invoiceId: invoice.id, tokenHash: hashToken(token) } });
    await tenant.collectionNote.create({
      data: { invoiceId: invoice.id, authorUserId: actor.userId, body: `Emailed ${invoice.recipientEmail}: ${subject}` },
    });
    await recordAudit(tenant, {
      action: "collection.message_sent", actorUserId: actor.userId, targetType: "invoice", targetId: invoice.id,
      metadata: { aiDrafted },
    });
    const link = new URL(invoicePath(token), deps.appUrl).toString();
    await deps.email.send({
      to: invoice.recipientEmail,
      subject,
      text: `${body}\n\nView the invoice, pay or download it: ${link}`,
      idempotencyKey: `collection-message-${randomUUID()}`,
    });
    return { sentTo: invoice.recipientEmail };
  });
}
