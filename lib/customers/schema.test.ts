import { describe, expect, it } from "vitest";
import { contactInputSchema, customerInputSchema, fieldErrors } from "./schema";

const minimal = { type: "organization", displayName: "Acme Solar" };

function errorsFor(input: unknown) {
  const result = customerInputSchema.safeParse(input);
  return result.success ? {} : fieldErrors(result.error);
}

describe("customerInputSchema", () => {
  it("needs only a type and a name, and stores blanks as null", () => {
    expect(customerInputSchema.parse({ ...minimal, email: "", phone: "  ", countryCode: "" })).toMatchObject({
      type: "organization",
      displayName: "Acme Solar",
      email: null,
      phone: null,
      countryCode: null,
      preferredCurrency: null,
      tags: [],
      notes: null,
    });
  });

  it("normalises what it can", () => {
    expect(
      customerInputSchema.parse({
        ...minimal,
        displayName: "  Acme Solar  ",
        email: " Billing@Acme.NG ",
        website: "acme.ng",
        countryCode: "ng",
        preferredLocale: "EN-ng",
        tags: "solar, Solar,  lagos ,",
      }),
    ).toMatchObject({
      displayName: "Acme Solar",
      email: "billing@acme.ng",
      website: "https://acme.ng",
      countryCode: "NG",
      preferredLocale: "en-NG",
      tags: ["solar", "lagos"],
    });
  });

  it("keeps currency independent of country", () => {
    expect(customerInputSchema.parse({ ...minimal, countryCode: "NG", preferredCurrency: "USD" })).toMatchObject({
      countryCode: "NG",
      preferredCurrency: "USD",
    });
  });

  it.each([
    ["type", "company"],
    ["displayName", "   "],
    ["email", "not-an-email"],
    ["phone", "call me"],
    ["website", "ftp://acme.ng"],
    ["countryCode", "EU"],
    ["preferredCurrency", "usd"],
    ["preferredLocale", "en_GB"],
    ["preferredLanguage", "english"],
    ["notes", "x".repeat(5001)],
  ])("rejects an invalid %s", (field, value) => {
    expect(Object.keys(errorsFor({ ...minimal, [field]: value }))).toEqual([field]);
  });

  it("limits tags", () => {
    expect(errorsFor({ ...minimal, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).toHaveProperty("tags");
    expect(errorsFor({ ...minimal, tags: ["x".repeat(41)] })).toHaveProperty("tags");
  });

  it("rejects unknown fields such as an organization id", () => {
    expect(errorsFor({ ...minimal, organizationId: "org_b" })).toEqual({ organizationId: "is not a known field" });
  });
});

describe("contactInputSchema", () => {
  it("parses a contact from form values", () => {
    expect(contactInputSchema.parse({ name: " Ada Obi ", email: "ADA@acme.ng", phone: "", jobTitle: "", isPrimary: "on" })).toEqual({
      name: "Ada Obi",
      email: "ada@acme.ng",
      phone: null,
      jobTitle: null,
      isPrimary: true,
    });
    expect(contactInputSchema.parse({ name: "Ada" }).isPrimary).toBe(false);
  });
});
