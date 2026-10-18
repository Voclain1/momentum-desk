import { z } from "zod";
import { isCountryCode } from "@/lib/geo/countries";
import { isCurrencyCode } from "@/lib/money";

/**
 * Validation for an organization's global settings (docs/product-spec.md
 * §5.1). Each setting is chosen explicitly and never inferred from another:
 * a company can be registered in one country, report in a second currency
 * and invoice in several.
 *
 * The database enforces formats with CHECK constraints; this module enforces
 * the full rules, so run every settings mutation through it. Input is
 * normalised where the intent is unambiguous ("gb" → "GB", "EN-gb" → "en-GB")
 * and unknown fields are rejected rather than dropped (from the Codex
 * workspace-foundations work).
 */

/** Longest tag we accept; real BCP 47 tags are far shorter. */
const MAX_TAG_LENGTH = 35;

/** The canonical BCP 47 form of a tag, or the trimmed input if it is not one. */
function canonicalTag(tag: string): string {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? tag;
  } catch {
    return tag;
  }
}

const tagInput = z.string().trim().max(MAX_TAG_LENGTH).transform(canonicalTag);

const languageNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });

const currencyCode = z.string().refine(isCurrencyCode, {
  error: "must be a supported ISO 4217 currency code",
});

/** An assigned ISO 3166-1 alpha-2 code, upper case (lib/geo/countries.ts). */
const countryCode = z.string().trim().toUpperCase().refine(isCountryCode, {
  error: "must be an assigned upper-case ISO 3166-1 alpha-2 code, e.g. GB",
});

/** A canonical BCP 47 tag the runtime can format numbers and dates with. */
const locale = tagInput.refine(
  (tag) => {
    try {
      return Intl.getCanonicalLocales(tag)[0] === tag && Intl.NumberFormat.supportedLocalesOf([tag]).length === 1;
    } catch {
      return false;
    }
  },
  { error: "must be a supported BCP 47 locale, e.g. en-GB" },
);

/** A canonical BCP 47 language tag the runtime recognises, e.g. "en", "fr", "pt-BR". */
const language = tagInput.refine(
  (tag) => {
    try {
      return Intl.getCanonicalLocales(tag)[0] === tag && languageNames.of(tag) !== undefined;
    } catch {
      return false;
    }
  },
  { error: "must be a known BCP 47 language tag, e.g. en" },
);

/**
 * An IANA zone name such as "Europe/London" or "UTC". Fixed offsets like
 * "+01:00" are rejected: they ignore daylight saving, so reminders scheduled
 * in local time would drift.
 */
const timezone = z.string().trim().max(64, { abort: true }).refine(
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

export const organizationSettingsSchema = z.strictObject({
  baseCurrency: currencyCode,
  countryCode,
  locale,
  timezone,
  defaultLanguage: language,
  defaultInvoiceCurrency: currencyCode.nullable().default(null),
});

export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;
export type OrganizationSettingsInput = z.input<typeof organizationSettingsSchema>;
