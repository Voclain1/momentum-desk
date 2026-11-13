import { describe, expect, it } from "vitest";
import { ungroundedFigures } from "./grounding";

const facts = "Outstanding: ₦60,000.00\nDue: 20 November 2026 (2026-11-20)\nInvoice: INV-0007\nDays past due: 12";

describe("the figure check", () => {
  it("accepts figures from the facts however they are written", () => {
    expect(ungroundedFigures(["₦60,000.00 on INV-0007, due 20 November 2026, 12 days late", "60000 and 60,000 and 2026-11-20"], facts)).toEqual([]);
  });

  it("names every invented figure", () => {
    expect(ungroundedFigures(["Pay ₦65,000 by 30 November with a 5% fee", "Ref 0007"], facts)).toEqual(["65,000", "30", "5"]);
  });

  it("does not accept a fraction that changes the amount", () => {
    expect(ungroundedFigures(["₦60,000.50"], facts)).toEqual(["60,000.50"]);
  });
});
