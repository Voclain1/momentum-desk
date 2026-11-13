import { describe, expect, it } from "vitest";
import { crossRate } from "./provider";
import { convertMinor, formatRate, parseRate } from "./rates";

describe("exchange rate arithmetic", () => {
  it("parses rates exactly and refuses nonsense", () => {
    expect(formatRate(parseRate("1580.25")!)).toBe("1580.25");
    expect(parseRate("0.000000000001")).toBe(1n);
    expect(parseRate("0")).toBeNull();
    expect(parseRate("-1")).toBeNull();
    expect(parseRate("1.0000000000001")).toBeNull();
    expect(parseRate("abc")).toBeNull();
  });

  it("converts between currencies with different minor units, rounding once", () => {
    // 1 USD = 1,580.25 NGN: $1,234.56 → ₦1,950,913.44
    expect(convertMinor(123456n, "USD", "NGN", parseRate("1580.25")!)).toBe(195091344n);
    // 1 JPY = 0.0068 USD: ¥10,000 → $68.00
    expect(convertMinor(10000n, "JPY", "USD", parseRate("0.0068")!)).toBe(6800n);
    // 1 KWD = 3.25 USD: 1.234 KWD → $4.0105 → $4.01
    expect(convertMinor(1234n, "KWD", "USD", parseRate("3.25")!)).toBe(401n);
    // Half away from zero: 1 GHS = 0.0625 USD, GH₵0.10 → $0.00625 → $0.01
    expect(convertMinor(10n, "GHS", "USD", parseRate("0.0625")!)).toBe(1n);
  });

  it("derives cross rates from per-dollar tables", () => {
    const table = { perUsd: { USD: "1", NGN: "1580.25", GHS: "15.5", JPY: "150" } };
    // 1 GHS in NGN = 1580.25 / 15.5 = 101.951612903225806…
    expect(formatRate(crossRate(table, "NGN", "GHS")!)).toBe("101.951612903226");
    expect(formatRate(crossRate(table, "USD", "JPY")!)).toBe("0.006666666667");
    expect(crossRate(table, "NGN", "XAF")).toBeNull();
  });
});
