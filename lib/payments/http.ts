import { isLocalUrl } from "@/lib/env";
import type { Http } from "./providers";

/**
 * Calls to payment providers. In end-to-end tests (PAYMENTS_TEST_API set and
 * the app on localhost) the providers' API hosts are replaced by a local
 * stand-in; nowhere else.
 */
const PROVIDER_HOSTS = ["https://api.paystack.co", "https://api.stripe.com", "https://api.bachs.io", "https://sandbox-api.bachs.io"];

export function providerHttp(env: { APP_URL?: string; PAYMENTS_TEST_API?: string }, base: typeof fetch = fetch): Http {
  const standIn = env.PAYMENTS_TEST_API && isLocalUrl(env.APP_URL) && isLocalUrl(env.PAYMENTS_TEST_API) ? env.PAYMENTS_TEST_API.replace(/\/$/, "") : null;
  return async (url, init) => {
    const host = PROVIDER_HOSTS.find((h) => url.startsWith(h));
    const target = standIn && host ? `${standIn}/${new URL(host).hostname}${url.slice(host.length)}` : url;
    const response = await base(target, { method: init.method, headers: init.headers, body: init.body, signal: AbortSignal.timeout(15_000) });
    return { status: response.status, json: () => response.json() };
  };
}
