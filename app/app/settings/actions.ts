"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/lib/auth/authorization";
import { requireTenant } from "@/lib/tenant/server";
import { updateWorkspaceSettings, WorkspaceConflictError, WorkspaceValidationError } from "@/lib/workspaces";

export type SettingsState =
  | { status: "idle" }
  | { status: "saved"; version: number }
  | { status: "error"; message: string; fields?: Record<string, string> };

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function saveWorkspaceSettings(_: SettingsState, form: FormData): Promise<SettingsState> {
  // Outside the try: a missing session redirects to sign-in.
  let tenant;
  try {
    tenant = await requireTenant("settings:write");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { status: "error", message: "Only owners and admins can change workspace settings." };
    }
    throw error;
  }

  try {
    const saved = await updateWorkspaceSettings({
      userId: tenant.user.id,
      organizationId: tenant.organization.id,
      expectedVersion: Number(field(form, "version")),
      input: {
        name: field(form, "name"),
        countryCode: field(form, "countryCode"),
        locale: field(form, "locale"),
        timezone: field(form, "timezone"),
        defaultLanguage: field(form, "defaultLanguage"),
        defaultInvoiceCurrency: field(form, "defaultInvoiceCurrency") || null,
      },
    });
    revalidatePath("/app", "layout");
    return { status: "saved", version: saved.settingsVersion };
  } catch (error) {
    if (error instanceof WorkspaceValidationError) {
      return { status: "error", message: "Some settings need fixing.", fields: { ...error.fields } };
    }
    if (error instanceof WorkspaceConflictError) {
      return { status: "error", message: error.message };
    }
    if (error instanceof AuthorizationError) {
      return { status: "error", message: "Only owners and admins can change workspace settings." };
    }
    throw error;
  }
}
