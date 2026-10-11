import { currencyExponent } from "./currencies";
import { toDecimalString, type Money } from "./money";

export type FormatMoneyOptions = {
  /** Short form for dashboards, e.g. "$286K". Not for documents. */
  compact?: boolean;
  /** How to show the currency: "symbol" ($), "narrowSymbol", "code" (USD) or "name". */
  currencyDisplay?: Intl.NumberFormatOptions["currencyDisplay"];
};

/**
 * Formats `Money` for display in an explicit locale.
 *
 * The amount is handed to `Intl.NumberFormat` as an exact decimal string, so
 * no precision is lost to floating point. Full (non-compact) output always
 * shows the ISO 4217 number of decimal places for the currency.
 */
export function formatMoney(
  value: Money,
  locale: string,
  options: FormatMoneyOptions = {},
): string {
  const exponent = currencyExponent(value.currency);
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currency,
    currencyDisplay: options.currencyDisplay ?? "symbol",
    ...(options.compact
      ? { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }
      : { minimumFractionDigits: exponent, maximumFractionDigits: exponent }),
  });
  return formatter.format(toDecimalString(value) as Intl.StringNumericLiteral);
}
