"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthorizationError } from "@/lib/auth/authorization";
import {
  addContact,
  createCustomer,
  removeContact,
  setCustomerArchived,
  updateContact,
  updateCustomer,
} from "@/lib/customers/service";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";

export type FormState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string; fields?: Record<string, string> };

const CUSTOMER_FIELDS = [
  "type", "displayName", "legalName", "email", "phone", "website", "taxId", "countryCode",
  "addressLine1", "addressLine2", "city", "region", "postalCode",
  "preferredLocale", "preferredLanguage", "preferredCurrency", "tags", "notes",
] as const;

/** Only the known fields, as submitted; validation happens in the service. */
function customerInput(form: FormData) {
  return Object.fromEntries(CUSTOMER_FIELDS.map((field) => [field, String(form.get(field) ?? "")]));
}

function contactInput(form: FormData) {
  return {
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? ""),
    phone: String(form.get("phone") ?? ""),
    jobTitle: String(form.get("jobTitle") ?? ""),
    isPrimary: form.get("isPrimary") === "on",
  };
}

/** Runs a write after the server-side permission check, mapping domain errors to form state. */
async function write(work: (actor: { organizationId: string; userId: string }) => Promise<FormState>): Promise<FormState> {
  let tenant;
  try {
    tenant = await requireTenant("customers:write");
  } catch (error) {
    if (error instanceof AuthorizationError) return { status: "error", message: "Your role cannot change customers." };
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

export async function createCustomerAction(_: FormState, form: FormData): Promise<FormState> {
  let id: string | undefined;
  const state = await write(async (actor) => {
    id = (await createCustomer(tenantData, actor, customerInput(form))).id;
    return { status: "saved", message: "Customer added." };
  });
  // Outside the try: redirect works by throwing.
  if (id) redirect(`/app/customers/${id}`);
  return state;
}

export async function updateCustomerAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  return write(async (actor) => {
    await updateCustomer(tenantData, actor, id, Number(form.get("version")), customerInput(form));
    revalidatePath(`/app/customers/${id}`);
    return { status: "saved", message: "Customer saved." };
  });
}

export async function setArchivedAction(id: string, archived: boolean): Promise<FormState> {
  return write(async (actor) => {
    await setCustomerArchived(tenantData, actor, id, archived);
    revalidatePath(`/app/customers/${id}`);
    revalidatePath("/app/customers");
    return { status: "saved", message: archived ? "Customer archived." : "Customer restored." };
  });
}

export async function saveContactAction(
  customerId: string,
  contactId: string | null,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return write(async (actor) => {
    if (contactId) await updateContact(tenantData, actor, contactId, contactInput(form));
    else await addContact(tenantData, actor, customerId, contactInput(form));
    revalidatePath(`/app/customers/${customerId}`);
    return { status: "saved", message: contactId ? "Contact saved." : "Contact added." };
  });
}

export async function removeContactAction(customerId: string, contactId: string): Promise<FormState> {
  return write(async (actor) => {
    await removeContact(tenantData, actor, contactId);
    revalidatePath(`/app/customers/${customerId}`);
    return { status: "saved", message: "Contact removed." };
  });
}
