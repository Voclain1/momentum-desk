import { z } from "zod";
import { isCurrencyCode } from "@/lib/money";

/**
 * Validation for an organization's global settings (docs/product-spec.md
 * §5.1). Each setting is chosen explicitly and never inferred from another:
 * a company can be registered in one country, report in a second currency
 * and invoice in several.
 *
 * The database enforces formats with CHECK constraints; this module enforces
 * the full rules, so run every settings mutation through it.
 */

const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
const languageNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });

const currencyCode = z.string().refine(isCurrencyCode, {
  error: "must be a supported ISO 4217 currency code",
});

/** ISO 3166-1 alpha-2, upper case. "ZZ" (unknown region) is rejected. */
const countryCode = z
  .string()
  .refine(
    (code) => /^[A-Z]{2}$/.test(code) && code !== "ZZ" && regionNames.of(code) !== undefined,
    { error: "must be a known upper-case ISO 3166-1 alpha-2 code, e.g. GB" },
  );

/** A canonical BCP 47 tag the runtime can format numbers and dates with. */
const locale = z.string().refine(
  (tag) => {
    try {
      return (
        Intl.getCanonicalLocales(tag)[0] === tag &&
        Intl.NumberFormat.supportedLocalesOf([tag]).length === 1
      );
    } catch {
      return false;
    }
  },
  { error: "must be a supported BCP 47 locale in canonical form, e.g. en-GB" },
);

/** A canonical BCP 47 language tag the runtime recognises, e.g. "en", "fr", "pt-BR". */
const language = z.string().refine(
  (tag) => {
    try {
      return Intl.getCanonicalLocales(tag)[0] === tag && languageNames.of(tag) !== undefined;
    } catch {
      return false;
    }
  },
  { error: "must be a known BCP 47 language tag in canonical form, e.g. en" },
);

/**
 * An IANA zone name such as "Europe/London" or "UTC". Fixed offsets like
 * "+01:00" are rejected: they ignore daylight saving, so reminders scheduled
 * in local time would drift.
 */
const timezone = z.string().refine(
  (zone) => {
    if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(zone)) return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  },
  { error: "must be an IANA timezone name, e.g. Europe/London" },
);

export const organizationSettingsSchema = z.object({
  baseCurrency: currencyCode,
  countryCode,
  locale,
  timezone,
  defaultLanguage: language,
  defaultInvoiceCurrency: currencyCode.nullable().default(null),
});

export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;
export type OrganizationSettingsInput = z.input<typeof organizationSettingsSchema>;
