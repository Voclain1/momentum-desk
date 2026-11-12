import { formatMoney, money } from "@/lib/money";
import { DocumentView, type DocumentData } from "./document-view";

export interface InvoiceDocumentData extends DocumentData {
  number: string | null;
  issuedOn: Date;
  dueOn: Date;
  paidMinor: bigint;
  paymentInstructions: string | null;
}

/** An invoice as the customer sees it (spec §7.6), with what is still owed. */
export function InvoiceDocument({ invoice, seller, locale }: { invoice: InvoiceDocumentData; seller: string; locale: string }) {
  const show = (minor: bigint) => formatMoney(money(minor, invoice.currency), locale);
  const name = invoice.number ? `Invoice ${invoice.number}` : "Draft invoice";
  const outstanding = invoice.totalMinor - invoice.paidMinor;
  return (
    <DocumentView
      label={name}
      title={name}
      facts={[["Issued", invoice.issuedOn], ["Due", invoice.dueOn]]}
      document={invoice}
      seller={seller}
      locale={locale}
      after={
        <>
          {invoice.paidMinor > 0n ? (
            <dl className="quote-totals balance">
              <div><dt>Paid</dt><dd>{show(invoice.paidMinor)}</dd></div>
              <div className="grand-total"><dt>Balance due ({invoice.currency})</dt><dd>{show(outstanding)}</dd></div>
            </dl>
          ) : null}
          {invoice.paymentInstructions ? (
            <section className="quote-text"><h3>How to pay</h3><p>{invoice.paymentInstructions}</p></section>
          ) : null}
        </>
      }
    />
  );
}
