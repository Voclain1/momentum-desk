import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption of payment providers' secret keys at rest (decision D35):
 * AES-256-GCM with a random IV per value, so a leaked database alone does
 * not reveal any key. Format: "v1.<iv>.<tag>.<ciphertext>" (base64url).
 */

export class SecretsKeyMissingError extends Error {
  constructor() {
    super("PROVIDER_SECRETS_KEY is not set, so payment provider keys cannot be stored or read.");
    this.name = "SecretsKeyMissingError";
  }
}

function key(secretsKey: string | undefined): Buffer {
  if (!secretsKey) throw new SecretsKeyMissingError();
  const bytes = Buffer.from(secretsKey, "base64");
  if (bytes.length !== 32) throw new SecretsKeyMissingError();
  return bytes;
}

export function encryptSecret(plain: string, secretsKey: string | undefined): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secretsKey), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(sealed: string, secretsKey: string | undefined): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Unreadable stored secret");
  const decipher = createDecipheriv("aes-256-gcm", key(secretsKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** "sk_live_…abcd": enough to recognise a key, never enough to use it. */
export const maskKey = (value: string) => `${value.slice(0, Math.min(8, Math.max(0, value.length - 4)))}…${value.slice(-4)}`;
