import { bachs } from "./bachs";
import { paystack } from "./paystack";
import { stripe } from "./stripe";
import type { PaymentProvider, ProviderKey } from "./types";

export * from "./types";

/** The adapters (decision D19). */
export const PROVIDERS: Record<ProviderKey, PaymentProvider> = { paystack, stripe, bachs };

export function providerFor(key: string): PaymentProvider | null {
  return Object.hasOwn(PROVIDERS, key) ? PROVIDERS[key as ProviderKey] : null;
}
