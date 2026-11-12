import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { InputValidationError } from "@/lib/errors";
import type { TenantData } from "@/lib/tenant/core";
import { fieldErrors, text } from "@/lib/validation/fields";

/** Workspace invoice defaults. Read by invoices:write; changed with settings:write. */

export const DEFAULT_INVOICE_SETTINGS = { paymentInstructions: null as string | null, defaultDueDays: 14 };

export async function invoiceSettings(data: TenantData, organizationId: string) {
  const row = await data.scoped(organizationId).invoiceSettings.findFirst();
  return row ? { paymentInstructions: row.paymentInstructions, defaultDueDays: row.defaultDueDays } : DEFAULT_INVOICE_SETTINGS;
}

const schema = z.strictObject({
  paymentInstructions: text(2000),
  defaultDueDays: z.coerce.number({ error: "must be a whole number" }).int({ error: "must be a whole number" }).min(0).max(365, { error: "must be at most 365" }),
});

export async function updateInvoiceSettings(data: TenantData, actor: { organizationId: string; userId: string }, input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new InputValidationError(fieldErrors(parsed.error));
  await data.transaction(actor.organizationId, async (tenant) => {
    const existing = await tenant.invoiceSettings.findFirst();
    if (existing) await tenant.invoiceSettings.updateMany({ where: {}, data: parsed.data });
    else await tenant.invoiceSettings.create({ data: parsed.data });
    await recordAudit(tenant, {
      action: "invoice.settings_updated",
      actorUserId: actor.userId,
      targetType: "organization",
      targetId: actor.organizationId,
      metadata: { fields: Object.keys(parsed.data), defaultDueDays: parsed.data.defaultDueDays },
    });
  });
}
