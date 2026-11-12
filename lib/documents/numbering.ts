import { recordAudit } from "@/lib/audit";
import { InputValidationError, RecordConflictError } from "@/lib/errors";
import type { TenantData, TenantDb } from "@/lib/tenant/core";
import { fieldErrors } from "@/lib/validation/fields";
import { numberingInputSchema } from "@/lib/quotes/schema";

/**
 * Display numbers for quotes and invoices (spec §9: numbers are display
 * identifiers, never keys). One sequence per workspace and kind, configurable
 * in Settings.
 */

export type DocumentKind = "quote" | "invoice";

export const DEFAULT_NUMBERING: Record<DocumentKind, { prefix: string; nextNumber: number; padding: number }> = {
  quote: { prefix: "Q-", nextNumber: 1, padding: 4 },
  invoice: { prefix: "INV-", nextNumber: 1, padding: 4 },
};

export async function documentNumbering(data: TenantData, organizationId: string, kind: DocumentKind) {
  const row = await data.scoped(organizationId).documentSequence.findFirst({ where: { kind } });
  return row ? { prefix: row.prefix, nextNumber: row.nextNumber, padding: row.padding } : DEFAULT_NUMBERING[kind];
}

export async function updateDocumentNumbering(
  data: TenantData,
  actor: { organizationId: string; userId: string },
  kind: DocumentKind,
  input: unknown,
) {
  const result = numberingInputSchema.safeParse(input);
  if (!result.success) throw new InputValidationError(fieldErrors(result.error));
  const values = result.data;
  await data.transaction(actor.organizationId, async (tenant) => {
    const existing = await tenant.documentSequence.findFirst({ where: { kind } });
    if (existing) await tenant.documentSequence.updateMany({ where: { kind }, data: values });
    else await tenant.documentSequence.create({ data: { kind, ...values } });
    await recordAudit(tenant, {
      action: kind === "quote" ? "quote.numbering_updated" : "invoice.numbering_updated",
      actorUserId: actor.userId,
      targetType: "organization",
      targetId: actor.organizationId,
      metadata: { ...values },
    });
  });
}

export const formatNumber = (n: { prefix: string; padding: number }, value: number) => `${n.prefix}${String(value).padStart(n.padding, "0")}`;

/**
 * The next free number, by compare-and-set on the sequence, inside the
 * caller's transaction: if that transaction fails, the number is not used
 * (no gap, decision D30). Numbers already taken (after the sequence was moved
 * back in Settings) are skipped.
 */
export async function allocateNumber(tenant: TenantDb, kind: DocumentKind, taken: (number: string) => Promise<boolean>): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    let row = await tenant.documentSequence.findFirst({ where: { kind } });
    if (!row) {
      await tenant.documentSequence.createMany({ data: [{ kind, ...DEFAULT_NUMBERING[kind] }], skipDuplicates: true });
      row = await tenant.documentSequence.findFirstOrThrow({ where: { kind } });
    }
    const { count } = await tenant.documentSequence.updateMany({
      where: { kind, nextNumber: row.nextNumber },
      data: { nextNumber: { increment: 1 } },
    });
    if (count !== 1) continue;
    const number = formatNumber(row, row.nextNumber);
    if (!(await taken(number))) return number;
  }
  throw new RecordConflictError(`${kind === "quote" ? "Quote" : "Invoice"} numbering`);
}
