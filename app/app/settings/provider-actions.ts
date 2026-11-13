"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/lib/auth/authorization";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { connectProvider, disconnectProvider } from "@/lib/payments/connections";
import { SecretsKeyMissingError } from "@/lib/payments/secrets";
import { onlineDeps } from "@/lib/payments/server";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";

export type ProviderFormState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string; fields?: Record<string, string> };

async function manage(work: (actor: { organizationId: string; userId: string }) => Promise<ProviderFormState>): Promise<ProviderFormState> {
  let tenant;
  try {
    tenant = await requireTenant("providers:manage");
  } catch (error) {
    if (error instanceof AuthorizationError) return { status: "error", message: "Only owners and admins can manage payment providers." };
    throw error;
  }
  try {
    return await work({ organizationId: tenant.organization.id, userId: tenant.user.id });
  } catch (error) {
    if (error instanceof InputValidationError) return { status: "error", message: "Some fields need fixing.", fields: { ...error.fields } };
    if (error instanceof RecordConflictError || error instanceof RecordNotFoundError) return { status: "error", message: error.message };
    if (error instanceof SecretsKeyMissingError) {
      return { status: "error", message: "Payment providers cannot be connected until PROVIDER_SECRETS_KEY is set on the server (docs/go-live.md)." };
    }
    throw error;
  }
}

export async function connectProviderAction(_: ProviderFormState, form: FormData): Promise<ProviderFormState> {
  return manage(async (actor) => {
    await connectProvider(
      tenantData,
      actor,
      {
        provider: String(form.get("provider") ?? ""),
        secretKey: String(form.get("secretKey") ?? ""),
        webhookSecret: String(form.get("webhookSecret") ?? ""),
        currencies: form.getAll("currencies").map(String),
      },
      { secretsKey: onlineDeps.secretsKey },
    );
    revalidatePath("/app/settings");
    return { status: "saved", message: "Provider connected. Add its webhook URL in the provider's dashboard." };
  });
}

export async function disconnectProviderAction(connectionId: string): Promise<ProviderFormState> {
  return manage(async (actor) => {
    await disconnectProvider(tenantData, actor, connectionId);
    revalidatePath("/app/settings");
    return { status: "saved", message: "Provider disconnected." };
  });
}
