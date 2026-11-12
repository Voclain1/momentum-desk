import { describe, expect, it } from "vitest";
import {
  calculateDocument,
  calculateLine,
  CalculationError,
  divRound,
  formatScaled,
  type LineInput,
  parseScaled,
} from "./calc";

const none = { kind: "none" } as const;
const vat = { key: "vat", name: "VAT 7.5%", milliPercent: 7500n };
const line = (quantity: string, unitPriceMinor: bigint, extra: Partial<LineInput> = {}): LineInput => ({
  quantityMilli: parseScaled(quantity, 3)!,
  unitPriceMinor,
  discount: none,
  tax: null,
  ...extra,
});

describe("divRound", () => {
  it("rounds half away from zero", () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(divRound(5n, 3n)).toBe(2n);
    expect(divRound(0n, 7n)).toBe(0n);
  });

  it("refuses a non-positive divisor", () => {
    expect(() => divRound(1n, 0n)).toThrow(CalculationError);
  });
});

describe("parseScaled and formatScaled", () => {
  it("parses without rounding and formats the shortest form", () => {
    expect(parseScaled("1.5", 3)).toBe(1500n);
    expect(parseScaled("2", 3)).toBe(2000n);
    expect(parseScaled("1,000.125", 3)).toBe(1000125n);
    expect(parseScaled("1.2345", 3)).toBeNull();
    expect(parseScaled("-1", 3)).toBeNull();
    expect(parseScaled("abc", 3)).toBeNull();
    expect(formatScaled(1500n, 3)).toBe("1.5");
    expect(formatScaled(2000n, 3)).toBe("2");
    expect(formatScaled(7500n, 3)).toBe("7.5");
    expect(formatScaled(5n, 3)).toBe("0.005");
  });
});

describe("calculateLine", () => {
  it("multiplies quantity by unit price, rounding the gross once", () => {
    // 1.5 × 3.33 USD = 4.995 → 5.00
    expect(calculateLine(line("1.5", 333n))).toEqual({ grossMinor: 500n, discountMinor: 0n, netMinor: 500n });
    // 0.333 × 1 JPY = 0.333 → 0
    expect(calculateLine(line("0.333", 1n)).grossMinor).toBe(0n);
    // 2.5 × 1.235 KWD (1235 fils) = 3.0875 → 3.088
    expect(calculateLine(line("2.5", 1235n)).grossMinor).toBe(3088n);
  });

  it("applies percentage and fixed discounts", () => {
    // 10% of 99.99 = 9.999 → 10.00
    expect(calculateLine(line("1", 9999n, { discount: { kind: "percent", milliPercent: 10000n } }))).toEqual({
      grossMinor: 9999n, discountMinor: 1000n, netMinor: 8999n,
    });
    expect(calculateLine(line("3", 1000n, { discount: { kind: "fixed", amountMinor: 500n } })).netMinor).toBe(2500n);
    expect(calculateLine(line("1", 1000n, { discount: { kind: "percent", milliPercent: 100000n } })).netMinor).toBe(0n);
  });

  it("rejects impossible lines", () => {
    expect(() => calculateLine(line("0", 100n))).toThrow("quantity must be more than zero");
    expect(() => calculateLine(line("1", -1n))).toThrow("unit price cannot be negative");
    expect(() => calculateLine(line("1", 100n, { discount: { kind: "fixed", amountMinor: 101n } }))).toThrow(
      "discount is more than the line amount",
    );
    expect(() => calculateLine(line("1", 100n, { discount: { kind: "percent", milliPercent: 100001n } }))).toThrow(
      "between 0% and 100%",
    );
    expect(() => calculateLine(line("1", 100n, { tax: { ...vat, milliPercent: -1n } }))).toThrow("tax rate");
  });
});

describe("calculateDocument", () => {
  it("adds exclusive tax once per rate on the sum of its lines", () => {
    // Three lines of 0.10 NGN at 7.5%: per-line tax would round to 0.01 each
    // (0.03); per rate it is 0.0225 → 0.02.
    const totals = calculateDocument([line("1", 10n, { tax: vat }), line("1", 10n, { tax: vat }), line("1", 10n, { tax: vat })], "exclusive");
    expect(totals.taxes).toEqual([{ key: "vat", name: "VAT 7.5%", milliPercent: 7500n, baseMinor: 30n, taxMinor: 2n }]);
    expect(totals.totalMinor).toBe(32n);
  });

  it("keeps separate tax lines per rate and leaves untaxed lines out", () => {
    const reduced = { key: "reduced", name: "Reduced 5%", milliPercent: 5000n };
    const totals = calculateDocument(
      [
        line("2", 50000n, { tax: vat, discount: { kind: "percent", milliPercent: 10000n } }), // 1000.00 - 100.00
        line("1", 20000n, { tax: reduced }),
        line("1", 5000n),
      ],
      "exclusive",
    );
    expect(totals.subtotalMinor).toBe(90000n + 20000n + 5000n);
    expect(totals.discountMinor).toBe(10000n);
    expect(totals.taxes.map((t) => [t.key, t.baseMinor, t.taxMinor])).toEqual([
      ["vat", 90000n, 6750n],
      ["reduced", 20000n, 1000n],
    ]);
    expect(totals.taxMinor).toBe(7750n);
    expect(totals.totalMinor).toBe(115000n + 7750n);
  });

  it("extracts inclusive tax and keeps the total equal to the lines", () => {
    // 107.50 including 7.5% VAT is 100.00 + 7.50.
    const totals = calculateDocument([line("1", 10750n, { tax: vat })], "inclusive");
    expect(totals.taxes[0]).toMatchObject({ baseMinor: 10000n, taxMinor: 750n });
    expect(totals.totalMinor).toBe(10750n);
    // 100.00 including 20%: tax 16.666… → 16.67, base 83.33.
    const uk = calculateDocument([line("1", 10000n, { tax: { key: "uk", name: "VAT 20%", milliPercent: 20000n } })], "inclusive");
    expect(uk.taxes[0]).toMatchObject({ baseMinor: 8333n, taxMinor: 1667n });
    expect(uk.totalMinor).toBe(10000n);
  });

  it("handles zero- and three-decimal currencies", () => {
    // JPY: 3 × ¥333 with 10% tax = 999 + 99.9 → 100.
    const jpy = calculateDocument([line("3", 333n, { tax: { key: "c", name: "Consumption tax", milliPercent: 10000n } })], "exclusive");
    expect([jpy.subtotalMinor, jpy.taxMinor, jpy.totalMinor]).toEqual([999n, 100n, 1099n]);
    // KWD: 1.5 × 2.345 KWD = 3.5175 → 3.518; 5% tax 0.1759 → 0.176.
    const kwd = calculateDocument([line("1.5", 2345n, { tax: { key: "k", name: "Tax 5%", milliPercent: 5000n } })], "exclusive");
    expect([kwd.subtotalMinor, kwd.taxMinor, kwd.totalMinor]).toEqual([3518n, 176n, 3694n]);
  });

  it("supports fractional tax rates", () => {
    // 8.875% of 100.00 = 8.875 → 8.88
    const totals = calculateDocument([line("1", 10000n, { tax: { key: "ny", name: "Sales tax", milliPercent: 8875n } })], "exclusive");
    expect(totals.taxMinor).toBe(888n);
  });

  it("is empty for no lines and refuses one tax with two rates", () => {
    expect(calculateDocument([], "exclusive")).toMatchObject({ subtotalMinor: 0n, taxMinor: 0n, totalMinor: 0n, taxes: [] });
    expect(() =>
      calculateDocument([line("1", 100n, { tax: vat }), line("1", 100n, { tax: { ...vat, milliPercent: 5000n } })], "exclusive"),
    ).toThrow("two different rates");
  });

  it("always adds up: total = subtotal + tax (exclusive) and subtotal (inclusive)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const lines = Array.from({ length: (seed % 5) + 1 }, (_, i) =>
        line(String(((seed * (i + 3)) % 997) / 100), BigInt((seed * 7919 * (i + 1)) % 100000), {
          tax: i % 2 ? vat : { key: "b", name: "B", milliPercent: BigInt((seed % 30) * 1000) },
          discount: i % 3 === 0 ? { kind: "percent", milliPercent: BigInt((seed % 50) * 1000) } : none,
        }),
      ).filter((l) => l.quantityMilli > 0n);
      for (const mode of ["exclusive", "inclusive"] as const) {
        const totals = calculateDocument(lines, mode);
        const taxSum = totals.taxes.reduce((t, x) => t + x.taxMinor, 0n);
        const baseSum = totals.taxes.reduce((t, x) => t + x.baseMinor, 0n);
        expect(totals.taxMinor).toBe(taxSum);
        if (mode === "exclusive") expect(totals.totalMinor).toBe(totals.subtotalMinor + taxSum);
        else expect(baseSum + taxSum).toBe(totals.subtotalMinor);
      }
    }
  });
});
