import type { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { CsvError, parseCsv, toCsv } from "@/lib/csv";
import { customerInputSchema, type CustomerInput } from "@/lib/customers/schema";
import { leadInputSchema, type LeadInput } from "@/lib/leads/schema";
import { listStages } from "@/lib/leads/service";
import { money, toDecimalString } from "@/lib/money";
import type { TenantData } from "@/lib/tenant/core";
import { fieldErrors } from "@/lib/validation/fields";

/**
 * CSV import and export of customers and leads (spec §7.3). Callers check
 * data:export, plus customers:write or sales:write to import.
 *
 * Imports are all-or-nothing: every row is validated with the same rules as
 * the forms, and if any row fails nothing is saved and every error is
 * returned with its line number. Each import is one audit entry with the
 * row count, never the data.
 */

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 1024 * 1024;

export const CUSTOMER_COLUMNS = [
  "type", "displayName", "legalName", "email", "phone", "website", "taxId", "countryCode",
  "addressLine1", "addressLine2", "city", "region", "postalCode",
  "preferredLocale", "preferredLanguage", "preferredCurrency", "tags", "notes",
] as const;

export const LEAD_COLUMNS = [
  "contactName", "companyName", "email", "phone", "source", "stage",
  "estimatedValue", "currency", "nextFollowUpOn", "summary", "tags", "notes",
] as const;

export interface Actor {
  organizationId: string;
  userId: string;
}

/** A problem with one line of the file (line 1 is the header). */
export interface RowError {
  line: number;
  field: string;
  message: string;
}

export type ImportResult = { ok: true; imported: number } | { ok: false; errors: RowError[] };

const date = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "");

export async function exportCustomers(data: TenantData, organizationId: string): Promise<string> {
  const customers = await data.scoped(organizationId).customer.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return toCsv(
    [...CUSTOMER_COLUMNS, "archived", "createdAt"],
    customers.map((customer) => [
      ...CUSTOMER_COLUMNS.map((column) => (column === "tags" ? customer.tags.join(", ") : customer[column])),
      customer.archivedAt ? "yes" : "",
      customer.createdAt.toISOString(),
    ]),
  );
}

export async function exportLeads(data: TenantData, organizationId: string): Promise<string> {
  const leads = await data.scoped(organizationId).lead.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      stage: { select: { name: true, kind: true } },
      owner: { select: { name: true } },
      customer: { select: { displayName: true } },
    },
  });
  return toCsv(
    [...LEAD_COLUMNS, "owner", "status", "customer", "archived", "createdAt"],
    leads.map((lead) => [
      lead.contactName,
      lead.companyName,
      lead.email,
      lead.phone,
      lead.source,
      lead.stage.name,
      lead.estimatedValueMinor !== null && lead.currency ? toDecimalString(money(lead.estimatedValueMinor, lead.currency)) : "",
      lead.currency,
      date(lead.nextFollowUpOn),
      lead.summary,
      lead.tags.join(", "),
      lead.notes,
      lead.owner?.name ?? "",
      lead.stage.kind,
      lead.customer?.displayName ?? "",
      lead.archivedAt ? "yes" : "",
      lead.createdAt.toISOString(),
    ]),
  );
}

/** Undoes the export's formula guard: "'+234 801" back to "+234 801". */
const unguard = (cell: string) => (/^'[=+\-@]/.test(cell) ? cell.slice(1) : cell);

/** Reads the file into one record per row, keyed by the known column names. */
function readRows(
  text: string,
  columns: readonly string[],
): { ok: true; rows: Record<string, string>[] } | { ok: false; errors: RowError[] } {
  const fail = (message: string, line = 1, field = "file") => ({ ok: false as const, errors: [{ line, field, message }] });
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) return fail("is larger than 1 MB");

  let cells: string[][];
  try {
    cells = parseCsv(text);
  } catch (error) {
    if (error instanceof CsvError) return fail(`is not a valid CSV file: ${error.message}`);
    throw error;
  }
  if (cells.length === 0) return fail("is empty");

  const byLowerName = new Map(columns.map((column) => [column.toLowerCase(), column]));
  const header = cells[0].map((cell) => cell.trim());
  const unknown = header.filter((cell) => !byLowerName.has(cell.toLowerCase()));
  if (unknown.length) return fail(`has unknown columns: ${unknown.join(", ")}`, 1, "header");
  if (cells.length === 1) return fail("has no rows");
  if (cells.length - 1 > MAX_IMPORT_ROWS) return fail(`has more than ${MAX_IMPORT_ROWS} rows`);

  const names = header.map((cell) => byLowerName.get(cell.toLowerCase())!);
  const rows = cells.slice(1).map((row) => {
    const record: Record<string, string> = {};
    names.forEach((name, index) => (record[name] = unguard(row[index] ?? "")));
    return record;
  });
  return { ok: true, rows };
}

/** Validates every row; line numbers count the header as line 1. */
function validateRows<S extends z.ZodType>(schema: S, rows: Record<string, unknown>[]) {
  const values: z.output<S>[] = [];
  const errors: RowError[] = [];
  rows.forEach((row, index) => {
    const result = schema.safeParse(row);
    if (result.success) values.push(result.data);
    else {
      for (const [field, message] of Object.entries(fieldErrors(result.error))) errors.push({ line: index + 2, field, message });
    }
  });
  return { values, errors };
}

export async function importCustomers(data: TenantData, actor: Actor, text: string): Promise<ImportResult> {
  const read = readRows(text, CUSTOMER_COLUMNS);
  if (!read.ok) return read;
  const { values, errors } = validateRows(
    customerInputSchema,
    read.rows.map((row) => ({ ...row, type: row.type?.trim() ? row.type.trim().toLowerCase() : "organization" })),
  );
  if (errors.length) return { ok: false, errors };

  await data.transaction(actor.organizationId, async (tenant) => {
    await tenant.customer.createMany({
      data: (values as CustomerInput[]).map((value) => ({ ...value, createdById: actor.userId })),
    });
    await recordAudit(tenant, {
      action: "customer.imported",
      actorUserId: actor.userId,
      targetType: "customer",
      metadata: { count: values.length },
    });
  });
  return { ok: true, imported: values.length };
}

export async function importLeads(data: TenantData, actor: Actor, text: string): Promise<ImportResult> {
  const read = readRows(text, LEAD_COLUMNS);
  if (!read.ok) return read;

  const stages = await listStages(data, actor.organizationId);
  const findStage = (name: string | undefined) => {
    const wanted = name?.trim().toLowerCase();
    if (!wanted) return stages[0];
    return stages.find((stage) => stage.name.toLowerCase() === wanted || stage.key.toLowerCase() === wanted);
  };

  const unknownStage: RowError[] = [];
  const inputs = read.rows.map(({ stage: stageName, ...row }, index) => {
    const stage = findStage(stageName);
    if (!stage) {
      unknownStage.push({
        line: index + 2,
        field: "stage",
        message: `is not a stage (${stages.map((s) => s.name).join(", ")})`,
      });
    }
    return { ...row, stageId: stage?.id ?? "" };
  });
  const validated = validateRows(leadInputSchema, inputs);
  const errors = [
    // An unknown stage replaces the generic stageId message.
    ...validated.errors.filter((error) => !(error.field === "stageId" && unknownStage.some((s) => s.line === error.line))),
    ...unknownStage,
  ].sort((a, b) => a.line - b.line);
  if (errors.length) return { ok: false, errors };

  const kinds = new Map(stages.map((stage) => [stage.id, stage.kind]));
  const now = new Date();
  await data.transaction(actor.organizationId, async (tenant) => {
    await tenant.lead.createMany({
      data: (validated.values as LeadInput[]).map((value) => ({
        ...value,
        ownerUserId: null,
        lostReason: null,
        closedAt: kinds.get(value.stageId) === "open" ? null : now,
        createdById: actor.userId,
      })),
    });
    await recordAudit(tenant, {
      action: "lead.imported",
      actorUserId: actor.userId,
      targetType: "lead",
      metadata: { count: validated.values.length },
    });
  });
  return { ok: true, imported: validated.values.length };
}
