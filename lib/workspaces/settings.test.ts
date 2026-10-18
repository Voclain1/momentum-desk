import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseNewWorkspace, parseOrganizationSettings, WorkspaceValidationError } from "./settings";

const settings = {
  baseCurrency: "GBP", countryCode: "NG", locale: "de-DE", timezone: "Asia/Tokyo",
  defaultLanguage: "fr", defaultInvoiceCurrency: "USD",
};

describe("global organization settings", () => {
  it("keeps country, currency, locale, timezone and language independent", () => {
    assert.deepEqual(parseOrganizationSettings(settings), settings);
  });

  it("canonicalizes locale tags and country without inferring currency", () => {
    const result = parseOrganizationSettings({ ...settings, countryCode: " gb ", locale: "EN-us" });
    assert.equal(result.countryCode, "GB");
    assert.equal(result.locale, "en-US");
    assert.equal(result.baseCurrency, "GBP");
    assert.ok(Object.isFrozen(result));
  });

  it("permits a distinct optional invoice currency and explicit clearing", () => {
    for (const defaultInvoiceCurrency of [undefined, null]) {
      assert.equal(parseOrganizationSettings({ ...settings, defaultInvoiceCurrency }).defaultInvoiceCurrency, null);
    }
    assert.equal(parseOrganizationSettings({ ...settings, baseCurrency: "JPY", defaultInvoiceCurrency: "KWD" }).defaultInvoiceCurrency, "KWD");
  });

  it("requires every global setting rather than using location defaults", () => {
    for (const key of ["baseCurrency", "countryCode", "locale", "timezone", "defaultLanguage"]) {
      const input: Record<string, unknown> = { ...settings };
      delete input[key];
      assert.throws(() => parseOrganizationSettings(input), WorkspaceValidationError, key);
    }
  });

  it("rejects unknown currencies, countries, invalid locales and timezones", () => {
    for (const [key, value] of [
      ["baseCurrency", "usd"], ["baseCurrency", "XYZ"], ["countryCode", "ZZ"],
      ["countryCode", "EU"], ["locale", "en_US"], ["locale", "zz-ZZ"],
      ["defaultLanguage", ""], ["timezone", "Mars/Olympus"], ["timezone", ""],
      ["defaultInvoiceCurrency", ""], ["defaultInvoiceCurrency", "XYZ"],
    ]) {
      assert.throws(() => parseOrganizationSettings({ ...settings, [key]: value }), WorkspaceValidationError, `${key}: ${value}`);
    }
  });

  it("rejects malformed bodies, injected tenant fields and oversized input", () => {
    for (const value of [null, [], "settings", 42]) {
      assert.throws(() => parseOrganizationSettings(value), WorkspaceValidationError);
    }
    assert.throws(() => parseOrganizationSettings({ ...settings, organizationId: "org-b" }), WorkspaceValidationError);
    assert.throws(() => parseOrganizationSettings({ ...settings, locale: "e".repeat(101) }), WorkspaceValidationError);
  });

  it("reports field names without copying raw input into errors", () => {
    const sensitive = "do-not-log-this-input";
    assert.throws(() => parseOrganizationSettings({ ...settings, timezone: sensitive }), (error) => {
      assert.ok(error instanceof WorkspaceValidationError);
      assert.deepEqual(error.fields, ["timezone"]);
      assert.ok(!error.message.includes(sensitive));
      return true;
    });
  });
});

describe("workspace creation input", () => {
  it("trims business name while keeping settings explicit", () => {
    assert.deepEqual(parseNewWorkspace({ name: "  Acme Studio  ", slug: "acme-studio", settings }), {
      name: "Acme Studio", slug: "acme-studio", settings,
    });
  });

  it("rejects invalid names, slugs and injected ownership", () => {
    for (const patch of [
      { name: " " }, { name: "a".repeat(121) }, { slug: "a" },
      { slug: "Acme" }, { slug: "-acme" }, { slug: "acme--studio" },
      { slug: "../acme" }, { slug: "a".repeat(64) },
      { userId: "bob" }, { role: "owner" }, { organizationId: "org-b" },
    ]) {
      assert.throws(() => parseNewWorkspace({ name: "Acme", slug: "acme", settings, ...patch }), WorkspaceValidationError);
    }
  });
});
