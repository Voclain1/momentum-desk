import { COUNTRY_CODES } from "@/lib/geo/countries";
import { CURRENCY_EXPONENTS } from "@/lib/money";

export interface Option {
  value: string;
  label: string;
}

/** Languages offered for customer documents. The interface itself is English for now. */
const DOCUMENT_LANGUAGES = ["en", "fr", "pt", "es", "de", "ar", "sw", "yo", "ha", "ig", "zu", "hi", "zh", "ja"];

function options(codes: readonly string[], type: "region" | "currency" | "language"): Option[] {
  const names = new Intl.DisplayNames(["en"], { type });
  return codes
    .map((value) => ({ value, label: `${names.of(value) ?? value} (${value})` }))
    .sort((a, b) => a.label.localeCompare(b.label, "en"));
}

/** Choices for workspace settings forms (onboarding and the settings page). */
export function settingsOptions() {
  return {
    countries: options(COUNTRY_CODES, "region"),
    currencies: options(Object.keys(CURRENCY_EXPONENTS), "currency"),
    languages: options(DOCUMENT_LANGUAGES, "language"),
    timezones: ["UTC", ...Intl.supportedValuesOf("timeZone")],
  };
}
