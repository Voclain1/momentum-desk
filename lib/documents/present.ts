import { formatScaled } from "./calc";

/**
 * How a document's copied data is presented, shared by the web view
 * (app/_documents) and the PDF (lib/documents/quote-pdf.ts) so they never
 * disagree. Everything comes from the document's snapshot, never live data.
 */

export interface PartySnapshot {
  name?: string;
  legalName?: string | null;
  taxId?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
}

export interface TaxLineSnapshot {
  taxRateId: string;
  name: string;
  milliPercent: number;
  baseMinor: string;
  taxMinor: string;
}

export const percentText = (milliPercent: number | bigint) => `${formatScaled(BigInt(milliPercent), 3)}%`;

/** The customer's name and address lines, as copied onto the document. */
export function partyLines(snapshot: unknown, locale: string) {
  const party = (snapshot ?? {}) as PartySnapshot;
  const country = party.countryCode ? (new Intl.DisplayNames([locale], { type: "region" }).of(party.countryCode) ?? party.countryCode) : null;
  return {
    name: party.legalName ?? party.name ?? "",
    displayName: party.name ?? "",
    address: [party.addressLine1, party.addressLine2, [party.city, party.region, party.postalCode].filter(Boolean).join(", "), country].filter(
      (line): line is string => Boolean(line),
    ),
    taxId: party.taxId ?? null,
  };
}

export const taxLinesOf = (value: unknown) => (Array.isArray(value) ? value : []) as TaxLineSnapshot[];

export function quantityText(quantityMilli: bigint, unit: string | null) {
  return `${formatScaled(quantityMilli, 3)}${unit ? ` ${unit}` : ""}`;
}

export function discountText(item: { discountKind: string; discountValue: bigint }, money: (minor: bigint) => string) {
  if (item.discountKind === "percent") return percentText(item.discountValue);
  if (item.discountKind === "fixed") return money(item.discountValue);
  return "—";
}

export function taxText(item: { taxName: string | null; taxMilliPercent: number | null }) {
  return item.taxName ? `${item.taxName} ${percentText(item.taxMilliPercent ?? 0)}` : "—";
}

export function taxLineLabel(tax: TaxLineSnapshot, inclusive: boolean, money: (minor: bigint) => string) {
  return `${tax.name} ${percentText(tax.milliPercent)}${inclusive ? " included" : ""} on ${money(BigInt(tax.baseMinor))}`;
}

/** Calendar dates are stored as UTC midnight; show them without shifting. */
export const dateText = (date: Date, locale: string) => new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date);
