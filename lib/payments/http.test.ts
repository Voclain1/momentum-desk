import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";
import { providerHttp } from "./http";

function recorder() {
  const urls: string[] = [];
  const base = (async (url: string) => {
    urls.push(url);
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { urls, base };
}

describe("providerHttp", () => {
  it("uses the local stand-in only for a localhost app", async () => {
    const local = recorder();
    await providerHttp({ APP_URL: "http://localhost:3100", PAYMENTS_TEST_API: "http://localhost:3200" }, local.base)(
      "https://api.paystack.co/transaction/verify/abc", { method: "GET", headers: {} },
    );
    expect(local.urls).toEqual(["http://localhost:3200/api.paystack.co/transaction/verify/abc"]);

    const real = recorder();
    await providerHttp({ APP_URL: "https://momentumdesk.app", PAYMENTS_TEST_API: "http://localhost:3200" }, real.base)(
      "https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: {}, body: "" },
    );
    expect(real.urls).toEqual(["https://api.stripe.com/v1/checkout/sessions"]);
  });

  it("is refused at startup outside localhost", () => {
    const required = { DATABASE_URL: "postgresql://u:p@localhost:5432/db", BETTER_AUTH_SECRET: "a".repeat(32) };
    expect(() => parseEnv({ ...required, APP_URL: "https://momentumdesk.app", PAYMENTS_TEST_API: "http://localhost:3200" })).toThrow(/PAYMENTS_TEST_API/);
    expect(() => parseEnv({ ...required, APP_URL: "http://localhost:3100", PAYMENTS_TEST_API: "https://evil.example" })).toThrow(/PAYMENTS_TEST_API/);
    expect(() => parseEnv({ ...required, PROVIDER_SECRETS_KEY: "short" })).toThrow(/PROVIDER_SECRETS_KEY/);
  });
});
