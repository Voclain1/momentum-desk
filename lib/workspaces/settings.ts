import { isCurrencyCode, type CurrencyCode } from "../money/currencies";

// ISO 3166-1 alpha-2 assignments. Country never determines currency or locale.
const COUNTRIES = new Set(`
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL
BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV
CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD
GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM
IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK
LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW
MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR
PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS
ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY
UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/));

export type OrganizationSettings = Readonly<{
  baseCurrency: CurrencyCode;
  countryCode: string;
  locale: string;
  timezone: string;
  defaultLanguage: string;
  defaultInvoiceCurrency: CurrencyCode | null;
}>;

export class WorkspaceValidationError extends Error {
  constructor(readonly fields: readonly string[]) {
    super(`Invalid workspace fields: ${fields.join(", ")}`);
    this.name = "WorkspaceValidationError";
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WorkspaceValidationError(["input"]);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" && value.trim().length <= maxLength ? value.trim() : "";
}

function supportedLocale(value: string): string | null {
  if (!value) return null;
  try {
    const [canonical] = Intl.getCanonicalLocales(value);
    return Intl.NumberFormat.supportedLocalesOf([canonical]).length ? canonical : null;
  } catch {
    return null;
  }
}

export function parseOrganizationSettings(input: unknown): OrganizationSettings {
  const value = object(input);
  const allowed = ["baseCurrency", "countryCode", "locale", "timezone", "defaultLanguage", "defaultInvoiceCurrency"];
  const invalid = Object.keys(value).filter((key) => !allowed.includes(key));
  const baseCurrency = text(value.baseCurrency, 3);
  const countryCode = text(value.countryCode, 2).toUpperCase();
  const locale = supportedLocale(text(value.locale, 100));
  const defaultLanguage = supportedLocale(text(value.defaultLanguage, 100));
  const timezone = text(value.timezone, 100);
  const invoiceCurrency = value.defaultInvoiceCurrency == null ? null : text(value.defaultInvoiceCurrency, 3);

  if (!isCurrencyCode(baseCurrency)) invalid.push("baseCurrency");
  if (!COUNTRIES.has(countryCode)) invalid.push("countryCode");
  if (!locale) invalid.push("locale");
  if (!defaultLanguage) invalid.push("defaultLanguage");
  try {
    if (!timezone) throw new Error("Missing timezone");
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    invalid.push("timezone");
  }
  if (invoiceCurrency !== null && !isCurrencyCode(invoiceCurrency)) invalid.push("defaultInvoiceCurrency");
  if (invalid.length) throw new WorkspaceValidationError(invalid);

  return Object.freeze({
    baseCurrency: baseCurrency as CurrencyCode,
    countryCode,
    locale: locale!,
    timezone,
    defaultLanguage: defaultLanguage!,
    defaultInvoiceCurrency: invoiceCurrency as CurrencyCode | null,
  });
}

export type NewWorkspace = Readonly<{
  name: string;
  slug: string;
  settings: OrganizationSettings;
}>;

export function parseNewWorkspace(input: unknown): NewWorkspace {
  const value = object(input);
  const invalid = Object.keys(value).filter((key) => !["name", "slug", "settings"].includes(key));
  const name = text(value.name, 120);
  const slug = text(value.slug, 63);
  if (!name) invalid.push("name");
  if (slug.length < 3 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) invalid.push("slug");
  if (invalid.length) throw new WorkspaceValidationError(invalid);
  return Object.freeze({ name, slug, settings: parseOrganizationSettings(value.settings) });
}
