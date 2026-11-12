import type { z } from "zod";
import { InputValidationError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import { fromDecimalString, InvalidAmountError } from "@/lib/money";
import { lineInputSchema } from "@/lib/quotes/schema";
import type { TenantDb } from "@/lib/tenant/core";
import { fieldErrors } from "@/lib/validation/fields";
import { calculateDocument, CalculationError, type Discount, HUNDRED_PERCENT, type LineInput as CalcLine, parseScaled } from "./calc";

/**
 * Turns builder input into a document's header and lines, shared by quotes
 * and invoices: checks the customer, lead, contact, products and tax rates
 * are this workspace's, parses every amount exactly in the document's
 * currency and computes totals (decision D12). Errors are keyed
 * "lines.N.field" (N from 1) for the builder.
 */

export interface DocumentInput {
  customerId: string;
  leadId: string | null;
  recipientContactId: string | null;
  currency: string;
  taxMode: "exclusive" | "inclusive";
  notes: string | null;
  terms: string | null;
  lines: unknown[];
}

/** The customer's billing details, as copied onto a document. */
export function snapshotOf(customer: Prisma.CustomerGetPayload<object>) {
  return {
    name: customer.displayName,
    legalName: customer.legalName,
    taxId: customer.taxId,
    email: customer.email,
    phone: customer.phone,
    addressLine1: customer.addressLine1,
    addressLine2: customer.addressLine2,
    city: customer.city,
    region: customer.region,
    postalCode: customer.postalCode,
    countryCode: customer.countryCode,
  };
}

export type ExistingItems = { productId: string | null; taxRateId: string | null; taxName: string | null; taxMilliPercent: number | null }[];

interface ResolvedLine {
  productId: string | null;
  description: string;
  quantityMilli: bigint;
  unit: string | null;
  unitPriceMinor: bigint;
  discountKind: "none" | "percent" | "fixed";
  discountValue: bigint;
  tax: { taxRateId: string; taxName: string; taxMilliPercent: number } | null;
}

/**
 * Checks references and parses every line exactly in the quote's currency.
 * Errors are keyed "lines.N.field" (N from 1) for the builder.
 */
export async function resolveDocument(tenant: TenantDb, values: DocumentInput, existing: ExistingItems = []) {
  const errors: Record<string, string> = {};
  const customer = await tenant.customer.findUnique({ where: { id: values.customerId }, include: { contacts: true } });
  if (!customer) errors.customerId = "is not a customer of this workspace";
  else if (customer.archivedAt) errors.customerId = "is archived";

  if (values.leadId) {
    const lead = await tenant.lead.findUnique({ where: { id: values.leadId } });
    if (!lead) errors.leadId = "is not a lead of this workspace";
    else if (lead.customerId && lead.customerId !== values.customerId) errors.leadId = "belongs to another customer";
  }
  const contact = values.recipientContactId ? customer?.contacts.find((c) => c.id === values.recipientContactId) : undefined;
  if (values.recipientContactId && customer && !contact) errors.recipientContactId = "is not a contact of this customer";

  const [rates, products] = await Promise.all([
    tenant.taxRate.findMany({ where: { archivedAt: null } }),
    tenant.product.findMany({ where: { active: true }, select: { id: true } }),
  ]);
  const activeRates = new Map(rates.map((rate) => [rate.id, rate]));
  const knownProducts = new Set([...products.map((p) => p.id), ...existing.flatMap((i) => (i.productId ? [i.productId] : []))]);
  // A rate archived since it was put on this draft keeps its copied value.
  const keptRates = new Map(
    existing.flatMap((item) =>
      item.taxRateId && item.taxName !== null && item.taxMilliPercent !== null
        ? [[item.taxRateId, { name: item.taxName, milliPercent: item.taxMilliPercent }] as const]
        : [],
    ),
  );

  const lines: ResolvedLine[] = [];
  values.lines.forEach((raw, index) => {
    const at = (field: string) => `lines.${index + 1}.${field}`;
    const parsed = lineInputSchema.safeParse(raw);
    if (!parsed.success) {
      for (const [field, message] of Object.entries(fieldErrors(parsed.error as z.ZodError))) errors[at(field)] = message;
      return;
    }
    const line = parsed.data;
    const quantityMilli = parseScaled(line.quantity, 3);
    if (quantityMilli === null || quantityMilli <= 0n) errors[at("quantity")] = "must be a number above zero with up to 3 decimals";

    let unitPriceMinor: bigint | null = null;
    try {
      unitPriceMinor = fromDecimalString(line.unitPrice.replaceAll(",", ""), values.currency).amountMinor;
      if (unitPriceMinor < 0n) errors[at("unitPrice")] = "cannot be negative";
    } catch (error) {
      if (!(error instanceof InvalidAmountError)) throw error;
      errors[at("unitPrice")] = /decimal place/.test(error.message)
        ? `has too many decimal places for ${values.currency}`
        : "must be an amount such as 1500 or 1500.50";
    }

    let discountValue = 0n;
    if (line.discountKind === "percent") {
      const value = parseScaled(line.discount.replace(/%$/, ""), 3);
      if (value === null || value > HUNDRED_PERCENT) errors[at("discount")] = "must be a percentage from 0 to 100";
      else discountValue = value;
    } else if (line.discountKind === "fixed") {
      try {
        discountValue = fromDecimalString(line.discount.replaceAll(",", "") || "0", values.currency).amountMinor;
        if (discountValue < 0n) errors[at("discount")] = "cannot be negative";
      } catch (error) {
        if (!(error instanceof InvalidAmountError)) throw error;
        errors[at("discount")] = `must be an amount in ${values.currency}`;
      }
    }

    let tax: ResolvedLine["tax"] = null;
    if (line.taxRateId) {
      const rate = activeRates.get(line.taxRateId);
      const kept = keptRates.get(line.taxRateId);
      if (rate) tax = { taxRateId: rate.id, taxName: rate.name, taxMilliPercent: rate.milliPercent };
      else if (kept) tax = { taxRateId: line.taxRateId, taxName: kept.name, taxMilliPercent: kept.milliPercent };
      else errors[at("taxRateId")] = "is not an active tax rate";
    }
    if (line.productId && !knownProducts.has(line.productId)) errors[at("productId")] = "is not an active product";

    lines.push({
      productId: line.productId,
      description: line.description,
      quantityMilli: quantityMilli ?? 1n,
      unit: line.unit,
      unitPriceMinor: unitPriceMinor ?? 0n,
      discountKind: line.discountKind,
      discountValue,
      tax,
    });
  });

  let totals: ReturnType<typeof calculateDocument> | null = null;
  if (Object.keys(errors).length === 0) {
    const calcLines: CalcLine[] = lines.map((line) => ({
      quantityMilli: line.quantityMilli,
      unitPriceMinor: line.unitPriceMinor,
      discount: (line.discountKind === "none"
        ? { kind: "none" }
        : line.discountKind === "percent"
          ? { kind: "percent", milliPercent: line.discountValue }
          : { kind: "fixed", amountMinor: line.discountValue }) satisfies Discount,
      tax: line.tax ? { key: line.tax.taxRateId, name: line.tax.taxName, milliPercent: BigInt(line.tax.taxMilliPercent) } : null,
    }));
    try {
      totals = calculateDocument(calcLines, values.taxMode);
    } catch (error) {
      if (!(error instanceof CalculationError)) throw error;
      const match = /^Line (\d+): (.*)$/.exec(error.message);
      if (match && /discount/.test(match[2])) errors[`lines.${match[1]}.discount`] = match[2].replace(/^discount /, "");
      else errors.lines = error.message;
    }
  }
  if (Object.keys(errors).length || !customer || !totals) throw new InputValidationError(errors);

  return {
    quote: {
      customerId: customer.id,
      leadId: values.leadId,
      currency: values.currency,
      taxMode: values.taxMode,
      recipientName: contact?.name ?? customer.displayName,
      recipientEmail: contact?.email ?? customer.email,
      customerSnapshot: snapshotOf(customer),
      notes: values.notes,
      terms: values.terms,
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      taxLines: totals.taxes.map((t) => ({
        taxRateId: t.key, name: t.name, milliPercent: Number(t.milliPercent),
        baseMinor: t.baseMinor.toString(), taxMinor: t.taxMinor.toString(),
      })),
    },
    items: lines.map((line, index) => ({
      position: index + 1,
      productId: line.productId,
      description: line.description,
      quantityMilli: line.quantityMilli,
      unit: line.unit,
      unitPriceMinor: line.unitPriceMinor,
      discountKind: line.discountKind,
      discountValue: line.discountValue,
      taxRateId: line.tax?.taxRateId ?? null,
      taxName: line.tax?.taxName ?? null,
      taxMilliPercent: line.tax?.taxMilliPercent ?? null,
      grossMinor: totals.lines[index].grossMinor,
      discountMinor: totals.lines[index].discountMinor,
      netMinor: totals.lines[index].netMinor,
    })),
  };
}

