/**
 * Quote and invoice arithmetic (decision D12). Exact bigint arithmetic on
 * integer minor units; nothing here touches floating point.
 *
 * Scales:
 * - quantities in thousandths (1.5 → 1500n), up to 3 decimals;
 * - percentages in thousandths of a percent (7.5% → 7500n, 100% → 100000n).
 *
 * Rounding is half away from zero, to the currency's minor unit, at fixed
 * points only:
 * 1. each line's gross: quantity × unit price;
 * 2. each line's percentage discount;
 * 3. each tax line, once per rate, on the sum of the lines with that rate.
 * The total is the sum of those rounded parts, so a document always adds up.
 *
 * Tax-exclusive: tax = base × rate, added on top.
 * Tax-inclusive: line amounts already include tax; tax = gross × rate ÷
 * (100% + rate) is extracted, and the total is the sum of the lines.
 */

export const QUANTITY_SCALE = 1000n;
export const PERCENT_SCALE = 1000n;
/** 100% in thousandths of a percent. */
export const HUNDRED_PERCENT = 100n * PERCENT_SCALE;

export class CalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculationError";
  }
}

export type TaxMode = "exclusive" | "inclusive";

export type Discount =
  | { kind: "none" }
  | { kind: "percent"; milliPercent: bigint }
  | { kind: "fixed"; amountMinor: bigint };

export interface LineTax {
  /** Groups lines into one tax line, e.g. the tax rate's id. */
  key: string;
  name: string;
  milliPercent: bigint;
}

export interface LineInput {
  quantityMilli: bigint;
  unitPriceMinor: bigint;
  discount: Discount;
  tax: LineTax | null;
}

export interface LineResult {
  grossMinor: bigint;
  discountMinor: bigint;
  /** Gross minus discount: excludes tax on exclusive documents, includes it on inclusive ones. */
  netMinor: bigint;
}

export interface TaxLine {
  key: string;
  name: string;
  milliPercent: bigint;
  /** The amount the tax is charged on, excluding the tax. */
  baseMinor: bigint;
  taxMinor: bigint;
}

export interface DocumentTotals {
  lines: LineResult[];
  /** Sum of line nets. */
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxes: TaxLine[];
  taxMinor: bigint;
  totalMinor: bigint;
}

/** numerator ÷ denominator, rounded half away from zero. Denominator > 0. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new CalculationError("Division by a non-positive number");
  const negative = numerator < 0n;
  const n = negative ? -numerator : numerator;
  const quotient = n / denominator;
  const rounded = (n % denominator) * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function checkLine(line: LineInput, index: number) {
  const at = `Line ${index + 1}`;
  if (line.quantityMilli <= 0n) throw new CalculationError(`${at}: quantity must be more than zero`);
  if (line.unitPriceMinor < 0n) throw new CalculationError(`${at}: unit price cannot be negative`);
  if (line.discount.kind === "percent" && (line.discount.milliPercent < 0n || line.discount.milliPercent > HUNDRED_PERCENT)) {
    throw new CalculationError(`${at}: discount must be between 0% and 100%`);
  }
  if (line.discount.kind === "fixed" && line.discount.amountMinor < 0n) {
    throw new CalculationError(`${at}: discount cannot be negative`);
  }
  if (line.tax && (line.tax.milliPercent < 0n || line.tax.milliPercent > HUNDRED_PERCENT)) {
    throw new CalculationError(`${at}: tax rate must be between 0% and 100%`);
  }
}

export function calculateLine(line: LineInput, index = 0): LineResult {
  checkLine(line, index);
  const grossMinor = divRound(line.quantityMilli * line.unitPriceMinor, QUANTITY_SCALE);
  let discountMinor = 0n;
  if (line.discount.kind === "percent") discountMinor = divRound(grossMinor * line.discount.milliPercent, HUNDRED_PERCENT);
  if (line.discount.kind === "fixed") {
    if (line.discount.amountMinor > grossMinor) {
      throw new CalculationError(`Line ${index + 1}: discount is more than the line amount`);
    }
    discountMinor = line.discount.amountMinor;
  }
  return { grossMinor, discountMinor, netMinor: grossMinor - discountMinor };
}

export function calculateDocument(inputs: readonly LineInput[], mode: TaxMode): DocumentTotals {
  const lines = inputs.map(calculateLine);
  const subtotalMinor = lines.reduce((total, line) => total + line.netMinor, 0n);
  const discountMinor = lines.reduce((total, line) => total + line.discountMinor, 0n);

  // One tax line per rate, in the order the rates first appear.
  const groups = new Map<string, { tax: LineTax; amountMinor: bigint }>();
  inputs.forEach((input, index) => {
    if (!input.tax) return;
    const group = groups.get(input.tax.key);
    if (group && group.tax.milliPercent !== input.tax.milliPercent) {
      throw new CalculationError(`Tax "${input.tax.name}" has two different rates on one document`);
    }
    if (group) group.amountMinor += lines[index].netMinor;
    else groups.set(input.tax.key, { tax: input.tax, amountMinor: lines[index].netMinor });
  });

  const taxes: TaxLine[] = [...groups.values()].map(({ tax, amountMinor }) => {
    const taxMinor =
      mode === "exclusive"
        ? divRound(amountMinor * tax.milliPercent, HUNDRED_PERCENT)
        : divRound(amountMinor * tax.milliPercent, HUNDRED_PERCENT + tax.milliPercent);
    return {
      key: tax.key,
      name: tax.name,
      milliPercent: tax.milliPercent,
      baseMinor: mode === "exclusive" ? amountMinor : amountMinor - taxMinor,
      taxMinor,
    };
  });
  const taxMinor = taxes.reduce((total, tax) => total + tax.taxMinor, 0n);
  return {
    lines,
    subtotalMinor,
    discountMinor,
    taxes,
    taxMinor,
    totalMinor: mode === "exclusive" ? subtotalMinor + taxMinor : subtotalMinor,
  };
}

const SCALED = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parses a non-negative decimal string with at most `decimals` decimal places
 * into an integer scaled by 10^decimals: ("1.5", 3) → 1500n. Never rounds.
 */
export function parseScaled(value: string, decimals: number): bigint | null {
  const match = SCALED.exec(value.trim().replaceAll(",", ""));
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  if (fraction.length > decimals) return null;
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** The shortest decimal string for a scaled integer: (1500n, 3) → "1.5", (2000n, 3) → "2". */
export function formatScaled(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
