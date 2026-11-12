import { formatMoney, money } from "@/lib/money";
import { dateText } from "./present";
import { type DocumentPdfData, renderDocumentPdf } from "./quote-pdf";

/** An invoice as a PDF (spec §7.6): the shared layout plus paid, balance due and how to pay. */

export interface InvoicePdfData extends DocumentPdfData {
  number: string | null;
  status: string;
  issuedOn: Date;
  dueOn: Date;
  paidMinor: bigint;
  paymentInstructions: string | null;
  voidedAt: Date | null;
}

export async function renderInvoicePdf(invoice: InvoicePdfData, options: { seller: string; locale: string }): Promise<Uint8Array> {
  const { locale } = options;
  const show = (minor: bigint) => formatMoney(money(minor, invoice.currency), locale);
  const outstanding = invoice.totalMinor - invoice.paidMinor;
  const isVoid = invoice.status === "void";
  return renderDocumentPdf(invoice, {
    title: invoice.number ? `Invoice ${invoice.number}` : "Draft invoice",
    stamp: invoice.status === "draft" ? "DRAFT — not issued" : isVoid ? "VOID — cancelled, nothing is owed" : undefined,
    facts: [["Issued", dateText(invoice.issuedOn, locale)], ["Due", dateText(invoice.dueOn, locale)]],
    extraTotals:
      !isVoid && invoice.paidMinor > 0n
        ? [["Paid", show(invoice.paidMinor), false], [`Balance due (${invoice.currency})`, show(outstanding), true]]
        : [],
    sections: isVoid ? [] : [["HOW TO PAY", invoice.paymentInstructions]],
    closing: isVoid
      ? `Cancelled${invoice.voidedAt ? ` on ${dateText(invoice.voidedAt, locale)}` : ""}.`
      : invoice.status === "issued" && outstanding === 0n
        ? "Paid in full. Thank you."
        : undefined,
  }, options);
}
