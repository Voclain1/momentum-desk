import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskKey, SecretsKeyMissingError } from "./secrets";

const key = randomBytes(32).toString("base64");

describe("provider secrets", () => {
  it("round-trips, with a fresh IV each time", () => {
    const a = encryptSecret("sk_test_123", key);
    const b = encryptSecret("sk_test_123", key);
    expect(a).not.toBe(b);
    expect(a).not.toContain("sk_test_123");
    expect(decryptSecret(a, key)).toBe("sk_test_123");
  });

  it("refuses a wrong key, tampering and a missing key", () => {
    const sealed = encryptSecret("sk_live_abc", key);
    expect(() => decryptSecret(sealed, randomBytes(32).toString("base64"))).toThrow();
    const [v, iv, tag, data] = sealed.split(".");
    expect(() => decryptSecret([v, iv, tag, data.slice(0, -2) + "AA"].join("."), key)).toThrow();
    expect(() => encryptSecret("x", undefined)).toThrow(SecretsKeyMissingError);
    expect(() => encryptSecret("x", "too-short")).toThrow(SecretsKeyMissingError);
  });

  it("masks keys for display", () => {
    expect(maskKey("sk_live_51HxYzABCDEFGH1234")).toBe("sk_live_…1234");
    expect(maskKey("abcd")).toBe("…abcd");
  });
});
