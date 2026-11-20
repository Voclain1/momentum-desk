"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/lib/auth/authorization";
import { MAX_LOGO_BYTES, removeLogo, setAccentColor, setLogo } from "@/lib/branding/service";
import { InputValidationError } from "@/lib/errors";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";

export type BrandingState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

async function write(work: (actor: { organizationId: string; userId: string }) => Promise<string>): Promise<BrandingState> {
  let tenant;
  try {
    tenant = await requireTenant("settings:write");
  } catch (error) {
    if (error instanceof AuthorizationError) return { status: "error", message: "Your role cannot change branding." };
    throw error;
  }
  try {
    const message = await work({ organizationId: tenant.organization.id, userId: tenant.user.id });
    revalidatePath("/app", "layout");
    return { status: "saved", message };
  } catch (error) {
    if (error instanceof InputValidationError) return { status: "error", message: Object.entries(error.fields).map(([f, m]) => `${f === "logo" ? "The logo" : "The colour"} ${m}.`).join(" ") };
    throw error;
  }
}

export async function uploadLogoAction(_: BrandingState, form: FormData): Promise<BrandingState> {
  return write(async (actor) => {
    const file = form.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new InputValidationError({ logo: "choose a PNG or JPEG file" });
    if (file.size > MAX_LOGO_BYTES) throw new InputValidationError({ logo: "must be at most 256 KB" });
    await setLogo(tenantData, actor, new Uint8Array(await file.arrayBuffer()));
    return "Logo saved. It appears on new and existing documents.";
  });
}

export async function removeLogoAction(): Promise<BrandingState> {
  return write(async (actor) => {
    await removeLogo(tenantData, actor);
    return "Logo removed.";
  });
}

export async function setAccentAction(_: BrandingState, form: FormData): Promise<BrandingState> {
  return write(async (actor) => {
    await setAccentColor(tenantData, actor, form.get("clear") === "1" ? "" : String(form.get("accentColor") ?? ""));
    return "Colour saved.";
  });
}
