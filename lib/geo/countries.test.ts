import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, isCountryCode } from "./countries";

describe("COUNTRY_CODES", () => {
  it("lists the 249 assigned ISO 3166-1 codes plus Kosovo, without duplicates", () => {
    expect(COUNTRY_CODES).toHaveLength(250);
    expect(new Set(COUNTRY_CODES).size).toBe(250);
  });

  it("has a display name for every code", () => {
    const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
    expect(COUNTRY_CODES.filter((code) => !names.of(code) || names.of(code) === code)).toEqual([]);
  });

  it.each(["NG", "GB", "US", "KE", "XK"])("accepts %s", (code) => {
    expect(isCountryCode(code)).toBe(true);
  });

  it.each(["EU", "UN", "YU", "ZR", "ZZ", "XA", "gb", "GBR", ""])("rejects %j", (code) => {
    expect(isCountryCode(code)).toBe(false);
  });
});
