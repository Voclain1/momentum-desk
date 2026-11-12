import { describe, expect, it } from "vitest";
import { fieldErrors, leadInputSchema } from "./schema";

const minimal = { contactName: "Ada Obi", stageId: "stage_new" };

function errorsFor(input: unknown) {
  const result = leadInputSchema.safeParse(input);
  return result.success ? {} : fieldErrors(result.error);
}

describe("leadInputSchema", () => {
  it("needs a name or company and a stage", () => {
    expect(leadInputSchema.parse(minimal)).toMatchObject({
      contactName: "Ada Obi",
      companyName: null,
      stageId: "stage_new",
      estimatedValueMinor: null,
      currency: null,
      nextFollowUpOn: null,
      tags: [],
    });
    expect(leadInputSchema.parse({ companyName: "Acme Solar", stageId: "s" }).companyName).toBe("Acme Solar");
    expect(errorsFor({ stageId: "s" })).toEqual({ contactName: "or a company name is required" });
    expect(errorsFor({ contactName: "Ada" })).toHaveProperty("stageId");
  });

  it.each([
    ["1500", "USD", BigInt(150000)],
    ["1,500.50", "USD", BigInt(150050)],
    ["250000", "NGN", BigInt(25000000)],
    ["1500", "JPY", BigInt(1500)],
    ["12.345", "KWD", BigInt(12345)],
    ["0", "GBP", BigInt(0)],
  ])("stores %s %s exactly as %s minor units", (estimatedValue, currency, minor) => {
    expect(leadInputSchema.parse({ ...minimal, estimatedValue, currency })).toMatchObject({
      estimatedValueMinor: minor,
      currency,
    });
  });

  it.each([
    [{ estimatedValue: "1500" }, "currency"],
    [{ estimatedValue: "10.5", currency: "JPY" }, "estimatedValue"],
    [{ estimatedValue: "1.2345", currency: "KWD" }, "estimatedValue"],
    [{ estimatedValue: "-5", currency: "USD" }, "estimatedValue"],
    [{ estimatedValue: "1e5", currency: "USD" }, "estimatedValue"],
    [{ estimatedValue: "lots", currency: "USD" }, "estimatedValue"],
    [{ estimatedValue: "10", currency: "usd" }, "currency"],
  ])("rejects %j", (patch, field) => {
    expect(Object.keys(errorsFor({ ...minimal, ...patch }))).toEqual([field]);
  });

  it("keeps a currency without a value as no value", () => {
    expect(leadInputSchema.parse({ ...minimal, currency: "USD" })).toMatchObject({ estimatedValueMinor: null, currency: null });
  });

  it("explains a decimal-places error in the currency's terms", () => {
    expect(errorsFor({ ...minimal, estimatedValue: "10.5", currency: "JPY" })).toEqual({
      estimatedValue: "has too many decimal places for JPY",
    });
  });

  it("accepts real calendar dates only", () => {
    expect(leadInputSchema.parse({ ...minimal, nextFollowUpOn: "2026-11-20" }).nextFollowUpOn?.toISOString()).toBe(
      "2026-11-20T00:00:00.000Z",
    );
    expect(errorsFor({ ...minimal, nextFollowUpOn: "2026-02-31" })).toHaveProperty("nextFollowUpOn");
    expect(errorsFor({ ...minimal, nextFollowUpOn: "next week" })).toHaveProperty("nextFollowUpOn");
  });

  it("accepts known sources only and rejects unknown fields", () => {
    expect(leadInputSchema.parse({ ...minimal, source: "referral" }).source).toBe("referral");
    expect(errorsFor({ ...minimal, source: "billboard" })).toHaveProperty("source");
    expect(errorsFor({ ...minimal, organizationId: "org_b" })).toEqual({ organizationId: "is not a known field" });
  });
});
