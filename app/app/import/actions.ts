"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/lib/auth/authorization";
import { importCustomers, importLeads, MAX_IMPORT_BYTES, type RowError } from "@/lib/transfer/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";

export type ImportKind = "customers" | "leads";

export type ImportState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string; errors?: RowError[] };

/** Importing needs data:export and the record type's write permission. */
export async function importAction(kind: ImportKind, _: ImportState, form: FormData): Promise<ImportState> {
  let tenant;
  try {
    tenant = await requireTenant("data:export");
    if (!tenant.can(kind === "customers" ? "customers:write" : "sales:write")) throw new AuthorizationError(403);
  } catch (error) {
    if (error instanceof AuthorizationError) return { status: "error", message: `Your role cannot import ${kind}.` };
    throw error;
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose a CSV file to import." };
  if (file.size > MAX_IMPORT_BYTES) return { status: "error", message: "The file is larger than 1 MB." };

  const actor = { organizationId: tenant.organization.id, userId: tenant.user.id };
  const text = await file.text();
  const result = kind === "customers" ? await importCustomers(tenantData, actor, text) : await importLeads(tenantData, actor, text);
  if (!result.ok) {
    return { status: "error", message: "Nothing was imported. Fix these rows and try again.", errors: result.errors };
  }
  revalidatePath(kind === "customers" ? "/app/customers" : "/app/leads");
  if (kind === "leads") revalidatePath("/app/pipeline");
  return { status: "saved", message: `Imported ${result.imported} ${kind === "customers" ? "customer" : "lead"}${result.imported === 1 ? "" : "s"}.` };
}
