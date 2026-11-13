import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import type { ProviderConnection } from "@/lib/generated/prisma/client";
import type { TenantData } from "@/lib/tenant/core";
import { fieldErrors } from "@/lib/validation/fields";
import { PROVIDER_KEYS, providerFor, type ProviderCredentials } from "./providers";
import { decryptSecret, encryptSecret, maskKey } from "./secrets";

/**
 * A workspace's own payment provider accounts (decisions D19, D35). Keys are
 * encrypted before they reach the database and never returned. Callers check
 * providers:manage.
 */

export interface Actor {
  organizationId: string;
  userId: string;
}

const connectSchema = z.strictObject({
  provider: z.enum(PROVIDER_KEYS, { error: "must be Paystack, Stripe or Bachs" }),
  secretKey: z.string().trim().min(10, { error: "is required" }).max(300).regex(/^\S+$/, { error: "cannot contain spaces" }),
  webhookSecret: z.string().trim().max(300).optional().transform((value) => value || null),
  currencies: z.array(z.string()).min(1, { error: "choose at least one currency" }),
});

/** What the settings page shows: never a key. */
export async function listConnections(data: TenantData, organizationId: string) {
  const rows = await data.scoped(organizationId).providerConnection.findMany({
    where: { disconnectedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, provider: true, mode: true, keyHint: true, currencies: true, createdAt: true, webhookSecretEnc: true },
  });
  return rows.map(({ webhookSecretEnc, ...row }) => ({ ...row, hasWebhookSecret: webhookSecretEnc !== null }));
}

export async function connectProvider(data: TenantData, actor: Actor, input: unknown, { secretsKey }: { secretsKey: string | undefined }) {
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) throw new InputValidationError(fieldErrors(parsed.error));
  const { provider: key, secretKey, webhookSecret, currencies } = parsed.data;
  const provider = providerFor(key)!;
  const errors: Record<string, string> = {};
  const mode = provider.modeOf(secretKey);
  if (mode === "unknown") errors.secretKey = `does not look like a ${provider.name} secret key`;
  if (key !== "paystack" && !webhookSecret) errors.webhookSecret = `is required: ${provider.name} signs webhooks with it`;
  const unsupported = currencies.filter((currency) => !provider.currencies.includes(currency));
  if (unsupported.length) errors.currencies = `${provider.name} cannot take ${unsupported.join(", ")}`;
  if (Object.keys(errors).length) throw new InputValidationError(errors);

  return data.transaction(actor.organizationId, async (tenant) => {
    const active = await tenant.providerConnection.findFirst({ where: { provider: key, disconnectedAt: null } });
    if (active) throw new RecordConflictError(`${provider.name} is already connected; disconnect it first, so it`);
    const connection = await tenant.providerConnection.create({
      data: {
        provider: key,
        mode,
        secretKeyEnc: encryptSecret(secretKey, secretsKey),
        webhookSecretEnc: webhookSecret ? encryptSecret(webhookSecret, secretsKey) : null,
        keyHint: maskKey(secretKey),
        currencies: [...new Set(currencies)],
        connectedById: actor.userId,
      },
    });
    await recordAudit(tenant, {
      action: "provider.connected",
      actorUserId: actor.userId,
      targetType: "provider",
      targetId: connection.id,
      metadata: { provider: key, mode, currencies },
    });
    return { id: connection.id };
  });
}

export async function disconnectProvider(data: TenantData, actor: Actor, connectionId: string) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const connection = await tenant.providerConnection.findUnique({ where: { id: connectionId } });
    if (!connection || connection.disconnectedAt) throw new RecordNotFoundError("Provider connection");
    await tenant.providerConnection.updateMany({ where: { id: connectionId, disconnectedAt: null }, data: { disconnectedAt: new Date() } });
    await recordAudit(tenant, {
      action: "provider.disconnected",
      actorUserId: actor.userId,
      targetType: "provider",
      targetId: connectionId,
      metadata: { provider: connection.provider },
    });
  });
}

/** Decrypts a connection's keys for one provider call. */
export function credentialsOf(
  connection: Pick<ProviderConnection, "secretKeyEnc" | "webhookSecretEnc">,
  secretsKey: string | undefined,
): ProviderCredentials {
  return {
    secretKey: decryptSecret(connection.secretKeyEnc, secretsKey),
    webhookSecret: connection.webhookSecretEnc ? decryptSecret(connection.webhookSecretEnc, secretsKey) : null,
  };
}
