import { describe, expect, it } from "vitest";
import {
  add,
  CurrencyMismatchError,
  currencyExponent,
  formatMoney,
  fromDecimalString,
  InvalidAmountError,
  isCurrencyCode,
  money,
  subtract,
  sum,
  toDecimalString,
  UnsupportedCurrencyError,
} from ".";

// Intl uses non-breaking and narrow no-break spaces in some locales.
const normalizeSpaces = (value: string) => value.replace(/[  ]/g, " ");

describe("currency metadata", () => {
  it.each([
    ["USD", 2],
    ["GBP", 2],
    ["EUR", 2],
    ["NGN", 2],
    ["GHS", 2],
    ["KES", 2],
    ["ZAR", 2],
    ["INR", 2],
    ["JPY", 0],
    ["KWD", 3],
  ] as const)("%s has %i minor-unit digits", (code, exponent) => {
    expect(currencyExponent(code)).toBe(exponent);
  });

  it("rejects unknown and lower-case codes", () => {
    expect(isCurrencyCode("usd")).toBe(false);
    expect(isCurrencyCode("XYZ")).toBe(false);
    expect(isCurrencyCode("toString")).toBe(false);
    expect(() => money(BigInt(100), "XYZ")).toThrow(UnsupportedCurrencyError);
  });
});

describe("fromDecimalString / toDecimalString", () => {
  it.each([
    ["1234.56", "USD", BigInt(123456)],
    ["0.05", "GBP", BigInt(5)],
    ["-12.5", "EUR", BigInt(-1250)],
    ["1500", "JPY", BigInt(1500)],
    ["1.234", "KWD", BigInt(1234)],
    ["7", "KWD", BigInt(7000)],
  ] as const)("parses %s %s exactly", (input, currency, expected) => {
    expect(fromDecimalString(input, currency).amountMinor).toBe(expected);
  });

  it("rejects more decimal places than the currency allows", () => {
    expect(() => fromDecimalString("10.5", "JPY")).toThrow(InvalidAmountError);
    expect(() => fromDecimalString("1.2345", "KWD")).toThrow(InvalidAmountError);
    expect(() => fromDecimalString("1.001", "USD")).toThrow(InvalidAmountError);
  });

  it("rejects non-decimal input", () => {
    for (const bad of ["", "1,000.00", "1e3", "$5", "1.", ".5", "NaN"]) {
      expect(() => fromDecimalString(bad, "USD")).toThrow(InvalidAmountError);
    }
  });

  it("round-trips values beyond the safe float range", () => {
    const value = "123456789012345678.91";
    expect(toDecimalString(fromDecimalString(value, "USD"))).toBe(value);
  });

  it.each([
    [BigInt(5), "USD", "0.05"],
    [BigInt(-5), "USD", "-0.05"],
    [BigInt(1500), "JPY", "1500"],
    [BigInt(1), "KWD", "0.001"],
    [BigInt(0), "KWD", "0.000"],
  ] as const)("renders %s %s as %s", (minor, currency, expected) => {
    expect(toDecimalString(money(minor, currency))).toBe(expected);
  });
});

describe("arithmetic", () => {
  it("adds and subtracts within one currency without float error", () => {
    const a = fromDecimalString("0.10", "USD");
    const b = fromDecimalString("0.20", "USD");
    expect(toDecimalString(add(a, b))).toBe("0.30");
    expect(toDecimalString(subtract(a, b))).toBe("-0.10");
  });

  it("never combines different currencies", () => {
    expect(() => add(money(BigInt(100), "USD"), money(BigInt(100), "EUR"))).toThrow(
      CurrencyMismatchError,
    );
    expect(() =>
      sum([money(BigInt(100), "GBP"), money(BigInt(100), "USD")], "GBP"),
    ).toThrow(CurrencyMismatchError);
  });

  it("sums an empty list to zero in the requested currency", () => {
    expect(sum([], "KWD")).toEqual(money(BigInt(0), "KWD"));
  });
});

describe("formatMoney", () => {
  it("formats the same currency differently per locale", () => {
    const value = fromDecimalString("1234.5", "EUR");
    expect(normalizeSpaces(formatMoney(value, "en-IE"))).toBe("€1,234.50");
    expect(normalizeSpaces(formatMoney(value, "de-DE"))).toBe("1.234,50 €");
    expect(normalizeSpaces(formatMoney(value, "fr-FR"))).toBe("1 234,50 €");
  });

  it("uses Indian digit grouping for en-IN", () => {
    expect(formatMoney(fromDecimalString("1234567.89", "INR"), "en-IN")).toBe(
      "₹12,34,567.89",
    );
  });

  it("shows no decimals for a zero-decimal currency", () => {
    expect(formatMoney(fromDecimalString("1234", "JPY"), "en-US")).toBe("¥1,234");
  });

  it("shows three decimals for a three-decimal currency", () => {
    expect(
      normalizeSpaces(
        formatMoney(fromDecimalString("1.5", "KWD"), "en-US", { currencyDisplay: "code" }),
      ),
    ).toBe("KWD 1.500");
  });

  it.each([
    ["NGN", "en-NG", "₦1,500.00"],
    ["GHS", "en-GH", "GH₵1,500.00"],
    ["KES", "en-KE", "Ksh 1,500.00"],
    ["ZAR", "en-ZA", "R 1 500,00"],
    ["GBP", "en-GB", "£1,500.00"],
  ] as const)("formats %s in %s", (currency, locale, expected) => {
    expect(normalizeSpaces(formatMoney(fromDecimalString("1500", currency), locale))).toBe(
      expected,
    );
  });

  it("formats large amounts exactly", () => {
    expect(formatMoney(fromDecimalString("123456789012345678.91", "USD"), "en-US")).toBe(
      "$123,456,789,012,345,678.91",
    );
  });

  it("supports a compact dashboard form", () => {
    expect(formatMoney(fromDecimalString("286000", "USD"), "en-US", { compact: true })).toBe(
      "$286K",
    );
  });
});
