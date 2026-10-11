import {
  assertCurrencyCode,
  currencyExponent,
  type CurrencyCode,
} from "./currencies";

/**
 * A monetary amount in integer minor units, always paired with its currency.
 *
 * `amountMinor` is a `bigint` so arithmetic is exact and never touches IEEE
 * floating point. 12.34 USD is `{ amountMinor: 1234n, currency: "USD" }`,
 * 1,500 JPY is `{ amountMinor: 1500n, currency: "JPY" }` and 1.234 KWD is
 * `{ amountMinor: 1234n, currency: "KWD" }`.
 */
export type Money = {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
};

export class CurrencyMismatchError extends Error {
  constructor(
    readonly left: CurrencyCode,
    readonly right: CurrencyCode,
  ) {
    super(`Cannot combine amounts in different currencies: ${left} and ${right}`);
    this.name = "CurrencyMismatchError";
  }
}

export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAmountError";
  }
}

export function money(amountMinor: bigint, currency: string): Money {
  return { amountMinor, currency: assertCurrencyCode(currency) };
}

export function zero(currency: string): Money {
  return money(BigInt(0), currency);
}

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Parses a decimal string in major units ("1234.50") into `Money`.
 *
 * Rejects input with more fractional digits than the currency allows rather
 * than rounding silently: "10.5" JPY and "1.2345" KWD are errors.
 */
export function fromDecimalString(value: string, currency: string): Money {
  const code = assertCurrencyCode(currency);
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) {
    throw new InvalidAmountError(`Not a decimal amount: "${value}"`);
  }
  const [, sign, whole, fraction = ""] = match;
  const exponent = currencyExponent(code);
  if (fraction.length > exponent) {
    throw new InvalidAmountError(
      `${code} allows ${exponent} decimal place(s); got "${value}"`,
    );
  }
  const digits = whole + fraction.padEnd(exponent, "0");
  const amountMinor = BigInt(digits) * (sign ? BigInt(-1) : BigInt(1));
  return { amountMinor, currency: code };
}

/** Exact decimal string in major units, e.g. 123456n USD -> "1234.56". */
export function toDecimalString({ amountMinor, currency }: Money): string {
  const exponent = currencyExponent(currency);
  const negative = amountMinor < BigInt(0);
  const digits = (negative ? -amountMinor : amountMinor).toString();
  if (exponent === 0) {
    return (negative ? "-" : "") + digits;
  }
  const padded = digits.padStart(exponent + 1, "0");
  const whole = padded.slice(0, -exponent);
  const fraction = padded.slice(-exponent);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

/**
 * Sums amounts that must all share `currency`. Throws on any other currency:
 * raw amounts in different currencies are never added together.
 */
export function sum(amounts: readonly Money[], currency: string): Money {
  return amounts.reduce(add, zero(currency));
}

export function isZero(value: Money): boolean {
  return value.amountMinor === BigInt(0);
}

export function isNegative(value: Money): boolean {
  return value.amountMinor < BigInt(0);
}
