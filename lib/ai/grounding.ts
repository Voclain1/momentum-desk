/**
 * The figure check that keeps AI output from inventing financial facts
 * (spec §7.8): every number in the AI's text must already appear in the
 * facts it was given. "₦60,000" and "60,000.00" count as the same figure.
 */

const NUMBER = /\d+(?:[.,]\d+)*/g;

function normalize(token: string): string[] {
  // A comma is a thousands separator, a dot a decimal point (en formatting);
  // also accept the other way round, as some locales write it.
  const variants = [token.replace(/,/g, ""), token.replace(/\./g, "").replace(/,/g, ".")];
  return variants.map((v) => (v.includes(".") ? v.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1") : v).replace(/^0+(?=\d)/, ""));
}

function figures(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(NUMBER)) {
    for (const value of normalize(match[0])) {
      found.add(value);
      // "60000.50" also allows "60000" written without its fraction.
      found.add(value.split(".")[0]);
    }
  }
  return found;
}

/** The figures in `texts` that do not appear in `facts`. */
export function ungroundedFigures(texts: string[], facts: string): string[] {
  const allowed = figures(facts);
  const missing = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(NUMBER)) {
      if (!normalize(match[0]).some((value) => allowed.has(value))) missing.add(match[0]);
    }
  }
  return [...missing];
}
