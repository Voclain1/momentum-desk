"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthorizationError, type Permission } from "@/lib/auth/authorization";
import {
  createProduct,
  createTaxRate,
  setProductActive,
  setTaxRateArchived,
  updateProduct,
  updateTaxRate,
} from "@/lib/catalogue/service";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";

export type FormState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string; fields?: Record<string, string> };

type Actor = { organizationId: string; userId: string };

/** Permission check on the server, then domain errors mapped to form state. */
async function write(permission: Permission, denied: string, work: (actor: Actor) => Promise<FormState>): Promise<FormState> {
  let tenant;
  try {
    tenant = await requireTenant(permission);
  } catch (error) {
    if (error instanceof AuthorizationError) return { status: "error", message: denied };
    throw error;
  }
  try {
    return await work({ organizationId: tenant.organization.id, userId: tenant.user.id });
  } catch (error) {
    if (error instanceof InputValidationError) {
      return { status: "error", message: "Some fields need fixing.", fields: { ...error.fields } };
    }
    if (error instanceof RecordConflictError || error instanceof RecordNotFoundError) {
      return { status: "error", message: error.message };
    }
    throw error;
  }
}

const PRODUCT_FIELDS = ["name", "description", "sku", "unit", "category", "taxRateId"] as const;

/** Known fields only; prices arrive as parallel priceCurrency / priceAmount lists. */
function productInput(form: FormData) {
  const currencies = form.getAll("priceCurrency").map(String);
  const amounts = form.getAll("priceAmount").map(String);
  return {
    ...Object.fromEntries(PRODUCT_FIELDS.map((field) => [field, String(form.get(field) ?? "")])),
    prices: currencies
      .map((currency, index) => ({ currency, unitPrice: amounts[index] ?? "" }))
      .filter((price) => price.currency !== "" || price.unitPrice.trim() !== ""),
  };
}

const productWrite = (work: (actor: Actor) => Promise<FormState>) =>
  write("catalogue:write", "Your role cannot change the catalogue.", work);

function refresh(id?: string) {
  revalidatePath("/app/catalogue");
  if (id) revalidatePath(`/app/catalogue/${id}`);
}

export async function createProductAction(_: FormState, form: FormData): Promise<FormState> {
  let id: string | undefined;
  const state = await productWrite(async (actor) => {
    id = (await createProduct(tenantData, actor, productInput(form))).id;
    refresh();
    return { status: "saved", message: "Product added." };
  });
  if (id) redirect(`/app/catalogue/${id}`);
  return state;
}

export async function updateProductAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  return productWrite(async (actor) => {
    await updateProduct(tenantData, actor, id, Number(form.get("version")), productInput(form));
    refresh(id);
    return { status: "saved", message: "Product saved." };
  });
}

export async function setProductActiveAction(id: string, active: boolean): Promise<FormState> {
  return productWrite(async (actor) => {
    await setProductActive(tenantData, actor, id, active);
    refresh(id);
    return { status: "saved", message: active ? "Product reactivated." : "Product deactivated." };
  });
}

const taxWrite = (work: (actor: Actor) => Promise<FormState>) =>
  write("settings:write", "Only owners and admins can change tax rates.", work);

const taxInput = (form: FormData) => ({ name: String(form.get("name") ?? ""), rate: String(form.get("rate") ?? "") });

export async function saveTaxRateAction(id: string | null, _: FormState, form: FormData): Promise<FormState> {
  return taxWrite(async (actor) => {
    if (id) await updateTaxRate(tenantData, actor, id, taxInput(form));
    else await createTaxRate(tenantData, actor, taxInput(form));
    revalidatePath("/app/settings");
    return { status: "saved", message: id ? "Tax rate saved." : "Tax rate added." };
  });
}

export async function setTaxRateArchivedAction(id: string, archived: boolean): Promise<FormState> {
  return taxWrite(async (actor) => {
    await setTaxRateArchived(tenantData, actor, id, archived);
    revalidatePath("/app/settings");
    return { status: "saved", message: archived ? "Tax rate archived." : "Tax rate restored." };
  });
}
