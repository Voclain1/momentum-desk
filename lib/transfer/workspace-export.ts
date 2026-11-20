import { strToU8, zipSync } from "fflate";
import { recordAudit } from "@/lib/audit";
import { pdfSeller } from "@/lib/branding/service";
import { toCsv } from "@/lib/csv";
import { renderInvoicePdf } from "@/lib/documents/invoice-pdf";
import { renderQuotePdf } from "@/lib/documents/quote-pdf";
import { money, toDecimalString } from "@/lib/money";
import type { TenantData } from "@/lib/tenant/core";

/**
 * Everything a workspace holds, in one ZIP of CSV files plus the PDFs of
 * its issued documents (spec §12 data export; the privacy policy's export
 * promise). For owners and admins (data:export). Secrets, token hashes and
 * visitors' addresses are left out. Amounts are given both as decimals and
 * in minor units, always next to their currency.
 */

type Row = Record<string, unknown>;
interface Table {
  file: string;
  rows: Row[];
  /** Amount fields (minor units) and the field holding their currency. */
  money?: Record<string, string>;
  /** Fields never exported. */
  omit?: string[];
}

function cell(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.join("; ");
  if (value && typeof value === "object") return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  return value;
}

function csvOf({ rows, money: amounts = {}, omit = [] }: Table): string {
  const columns = rows.length ? Object.keys(rows[0]).filter((key) => !omit.includes(key) && key !== "organizationId") : ["(no records)"];
  const header = columns.flatMap((key) => (key in amounts ? [key.replace(/Minor$/, ""), key] : [key]));
  const body = rows.map((row) =>
    columns.flatMap((key) => {
      const value = row[key];
      if (!(key in amounts)) return [cell(value)];
      const currency = String(row[amounts[key]] ?? "");
      return [typeof value === "bigint" && currency ? toDecimalString(money(value, currency)) : "", cell(value)];
    }),
  );
  return toCsv(header, body);
}

const README = (name: string, at: Date) => `MomentumDesk export of ${name}, made ${at.toISOString()}.

Each CSV file has a header row and is UTF-8 (with a byte order mark, so Excel reads it).
Ids link the files: e.g. invoice-items.csv invoiceId refers to invoices.csv id.
Amounts appear twice: as a decimal in the record's currency (e.g. "amount")
and as an integer in minor units (e.g. "amountMinor"). Currencies are never
converted or added together. Dates are ISO 8601 in UTC; "...On" fields are
calendar dates in the workspace's timezone.

Not included: payment provider keys, sign-in data, link tokens and the
addresses of people who opened document links.
pdf/ holds a PDF of every issued quote revision and invoice.
`;

export async function exportWorkspace(
  data: TenantData,
  actor: { organizationId: string; userId: string },
  seller: { name: string; locale: string },
  now: Date = new Date(),
): Promise<Uint8Array> {
  const t = data.scoped(actor.organizationId);
  const [
    customers, contacts, leads, stages, activities, tasks, taxRates, products, prices, quotes, quoteItems,
    invoices, invoiceItems, payments, allocations, refunds, promises, notes, collections, reminders, rates, audit,
  ] = await Promise.all([
    t.customer.findMany({ orderBy: { createdAt: "asc" } }),
    t.contact.findMany({ orderBy: { createdAt: "asc" } }),
    t.lead.findMany({ orderBy: { createdAt: "asc" } }),
    t.pipelineStage.findMany({ orderBy: { position: "asc" } }),
    t.activity.findMany({ orderBy: { occurredAt: "asc" } }),
    t.task.findMany({ orderBy: { createdAt: "asc" } }),
    t.taxRate.findMany({ orderBy: { createdAt: "asc" } }),
    t.product.findMany({ orderBy: { createdAt: "asc" } }),
    t.productPrice.findMany(),
    t.quote.findMany({ orderBy: { createdAt: "asc" } }),
    t.quoteItem.findMany({ include: { quote: { select: { currency: true } } } }),
    t.invoice.findMany({ orderBy: { createdAt: "asc" } }),
    t.invoiceItem.findMany({ include: { invoice: { select: { currency: true } } } }),
    t.payment.findMany({ orderBy: { receivedOn: "asc" } }),
    t.paymentAllocation.findMany({ include: { invoice: { select: { currency: true } } } }),
    t.refund.findMany({ orderBy: { createdAt: "asc" } }),
    t.promiseToPay.findMany({ orderBy: { createdAt: "asc" } }),
    t.collectionNote.findMany({ orderBy: { createdAt: "asc" } }),
    t.invoiceCollection.findMany(),
    t.reminderExecution.findMany({ orderBy: { createdAt: "asc" } }),
    t.exchangeRate.findMany({ orderBy: { effectiveOn: "asc" } }),
    t.auditLog.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  const withCurrency = <T extends Row>(rows: (T & { quote?: { currency: string }; invoice?: { currency: string } })[]) =>
    rows.map(({ quote, invoice, ...rest }) => ({ ...rest, currency: quote?.currency ?? invoice?.currency }));

  const tables: Table[] = [
    { file: "customers.csv", rows: customers },
    { file: "contacts.csv", rows: contacts },
    { file: "pipeline-stages.csv", rows: stages },
    { file: "leads.csv", rows: leads, money: { estimatedValueMinor: "currency" } },
    { file: "activities.csv", rows: activities },
    { file: "tasks.csv", rows: tasks },
    { file: "tax-rates.csv", rows: taxRates },
    { file: "products.csv", rows: products },
    { file: "product-prices.csv", rows: prices, money: { unitPriceMinor: "currency" } },
    { file: "quotes.csv", rows: quotes, money: { subtotalMinor: "currency", discountMinor: "currency", taxMinor: "currency", totalMinor: "currency" } },
    { file: "quote-items.csv", rows: withCurrency(quoteItems), money: { unitPriceMinor: "currency", netMinor: "currency" } },
    { file: "invoices.csv", rows: invoices, money: { subtotalMinor: "currency", discountMinor: "currency", taxMinor: "currency", totalMinor: "currency", paidMinor: "currency", outstandingMinor: "currency" } },
    { file: "invoice-items.csv", rows: withCurrency(invoiceItems), money: { unitPriceMinor: "currency", netMinor: "currency" } },
    { file: "payments.csv", rows: payments, money: { amountMinor: "currency" } },
    { file: "payment-allocations.csv", rows: withCurrency(allocations), money: { amountMinor: "currency" } },
    { file: "refunds.csv", rows: refunds, money: { amountMinor: "currency" } },
    { file: "promises-to-pay.csv", rows: promises, money: { amountMinor: "currency", paidAtStartMinor: "currency" } },
    { file: "collections.csv", rows: collections },
    { file: "collection-notes.csv", rows: notes },
    { file: "reminders.csv", rows: reminders, omit: ["sentTo"] },
    { file: "exchange-rates.csv", rows: rates },
    { file: "audit-log.csv", rows: audit },
  ];

  const files: Record<string, Uint8Array> = { "README.txt": strToU8(README(seller.name, now)) };
  for (const table of tables) files[table.file] = strToU8(csvOf(table));

  // PDFs of what customers received: issued quote revisions and invoices.
  const branding = await pdfSeller(data, actor.organizationId, seller);
  const items = (id: string, list: { quoteId?: string; invoiceId?: string }[], key: "quoteId" | "invoiceId") => list.filter((i) => i[key] === id);
  for (const quote of quotes.filter((q) => q.status !== "draft")) {
    const bytes = await renderQuotePdf({ ...quote, items: items(quote.id, quoteItems, "quoteId") } as never, branding);
    files[`pdf/quotes/${quote.number}${quote.revision > 1 ? `-r${quote.revision}` : ""}.pdf`] = bytes;
  }
  for (const invoice of invoices.filter((i) => i.status !== "draft" && i.number)) {
    const bytes = await renderInvoicePdf({ ...invoice, items: items(invoice.id, invoiceItems, "invoiceId") } as never, branding);
    files[`pdf/invoices/${invoice.number}.pdf`] = bytes;
  }

  await data.transaction(actor.organizationId, (tenant) =>
    recordAudit(tenant, { action: "workspace.exported", actorUserId: actor.userId, targetType: "organization", targetId: actor.organizationId }),
  );
  return zipSync(files, { level: 6, mtime: now });
}
