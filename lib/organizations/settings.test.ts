import { describe, expect, it } from "vitest";
import { organizationSettingsSchema } from "./settings";

const valid = {
  baseCurrency: "USD",
  countryCode: "NG",
  locale: "en-NG",
  timezone: "Africa/Lagos",
  defaultLanguage: "en",
};

function errorPaths(input: unknown) {
  const result = organizationSettingsSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("organizationSettingsSchema", () => {
  it("accepts settings where country, currency and locale differ", () => {
    // A Nigerian company reporting in USD and invoicing in GBP is valid.
    expect(
      organizationSettingsSchema.parse({ ...valid, defaultInvoiceCurrency: "GBP" }),
    ).toEqual({ ...valid, defaultInvoiceCurrency: "GBP" });
  });

  it("defaults the invoice currency to none rather than inferring it", () => {
    expect(organizationSettingsSchema.parse(valid).defaultInvoiceCurrency).toBeNull();
  });

  it.each(["JPY", "KWD", "NGN", "GHS", "KES", "ZAR", "INR", "EUR"])(
    "accepts %s as a base currency",
    (baseCurrency) => {
      expect(errorPaths({ ...valid, baseCurrency })).toEqual([]);
    },
  );

  it.each(["usd", "US", "XXX", "ABC", ""])("rejects currency %j", (code) => {
    expect(errorPaths({ ...valid, baseCurrency: code })).toEqual(["baseCurrency"]);
    expect(errorPaths({ ...valid, defaultInvoiceCurrency: code })).toEqual([
      "defaultInvoiceCurrency",
    ]);
  });

  it.each(["GB", "KE", "IN", "JP", "KW", "ZA"])("accepts country %s", (countryCode) => {
    expect(errorPaths({ ...valid, countryCode })).toEqual([]);
  });

  it.each(["gb", "GBR", "ZZ", "QQ", ""])("rejects country %j", (countryCode) => {
    expect(errorPaths({ ...valid, countryCode })).toEqual(["countryCode"]);
  });

  it.each(["en-GB", "fr-FR", "sw-KE", "ja-JP", "ar-KW", "en"])("accepts locale %s", (locale) => {
    expect(errorPaths({ ...valid, locale })).toEqual([]);
  });

  it.each(["en_GB", "EN-gb", "not a locale", ""])("rejects locale %j", (locale) => {
    expect(errorPaths({ ...valid, locale })).toEqual(["locale"]);
  });

  it.each(["Europe/London", "America/Argentina/Buenos_Aires", "Asia/Kolkata", "UTC", "Etc/GMT+1"])(
    "accepts timezone %s",
    (timezone) => {
      expect(errorPaths({ ...valid, timezone })).toEqual([]);
    },
  );

  it.each(["+01:00", "GMT+1 ", "Mars/Olympus", ""])("rejects timezone %j", (timezone) => {
    expect(errorPaths({ ...valid, timezone })).toEqual(["timezone"]);
  });

  it.each(["en", "fr", "pt-BR", "yo"])("accepts language %s", (defaultLanguage) => {
    expect(errorPaths({ ...valid, defaultLanguage })).toEqual([]);
  });

  it.each(["EN", "qq", "english", ""])("rejects language %j", (defaultLanguage) => {
    expect(errorPaths({ ...valid, defaultLanguage })).toEqual(["defaultLanguage"]);
  });

  it("requires every setting except the invoice currency", () => {
    expect(errorPaths({}).sort()).toEqual(
      ["baseCurrency", "countryCode", "defaultLanguage", "locale", "timezone"].sort(),
    );
  });
});
