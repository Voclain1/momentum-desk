/**
 * ISO 4217 minor-unit exponents.
 *
 * This table is the authoritative source for how many minor units a currency
 * has. Do not infer precision from `Intl` or a locale: CLDR display digits do
 * not always match ISO 4217, and stored amounts must follow ISO 4217.
 *
 * Add currencies here deliberately. Being listed means MomentumDesk can store
 * and display the currency; it says nothing about payment-provider support.
 */
export const CURRENCY_EXPONENTS = {
  // Americas
  USD: 2,
  CAD: 2,
  MXN: 2,
  BRL: 2,
  CLP: 0,
  // Europe
  EUR: 2,
  GBP: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  CZK: 2,
  HUF: 2,
  ISK: 0,
  // Middle East
  AED: 2,
  SAR: 2,
  QAR: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
  // Africa
  NGN: 2,
  GHS: 2,
  KES: 2,
  ZAR: 2,
  EGP: 2,
  MAD: 2,
  TND: 3,
  TZS: 2,
  UGX: 0,
  RWF: 0,
  XOF: 0,
  XAF: 0,
  // Asia-Pacific
  INR: 2,
  CNY: 2,
  HKD: 2,
  SGD: 2,
  JPY: 0,
  KRW: 0,
  VND: 0,
  AUD: 2,
  NZD: 2,
} as const satisfies Record<string, number>;

export type CurrencyCode = keyof typeof CURRENCY_EXPONENTS;

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.hasOwn(CURRENCY_EXPONENTS, value);
}

export function assertCurrencyCode(value: string): CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new UnsupportedCurrencyError(value);
  }
  return value;
}

export function currencyExponent(currency: CurrencyCode): number {
  return CURRENCY_EXPONENTS[currency];
}

export class UnsupportedCurrencyError extends Error {
  constructor(readonly currency: string) {
    super(`Unsupported or unknown currency code: "${currency}"`);
    this.name = "UnsupportedCurrencyError";
  }
}
