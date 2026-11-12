import { dateText, discountText, partyLines, quantityText, taxLineLabel, taxLinesOf, taxText } from "@/lib/documents/present";
import { formatMoney, money } from "@/lib/money";

export interface QuoteDocumentData {
  number: string;
  revision: number;
  currency: string;
  taxMode: string;
  issuedOn: Date;
  expiresOn: Date;
  recipientName: string | null;
  recipientEmail: string | null;
  customerSnapshot: unknown;
  notes: string | null;
  terms: string | null;
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  taxLines: unknown;
  items: {
    id: string;
    description: string;
    quantityMilli: bigint;
    unit: string | null;
    unitPriceMinor: bigint;
    discountKind: string;
    discountValue: bigint;
    taxName: string | null;
    taxMilliPercent: number | null;
    netMinor: bigint;
  }[];
}

/**
 * A quote as the customer sees it: the copied snapshot, never live customer
 * or catalogue data. Amounts are shown in the quote's currency only, in the
 * given locale (spec §5.5).
 */
export function QuoteDocument({ quote, seller, locale }: { quote: QuoteDocumentData; seller: string; locale: string }) {
  const show = (minor: bigint) => formatMoney(money(minor, quote.currency), locale);
  const date = (value: Date) => dateText(value, locale);
  const customer = partyLines(quote.customerSnapshot, locale);
  const taxLines = taxLinesOf(quote.taxLines);
  const inclusive = quote.taxMode === "inclusive";

  return (
    <article className="quote-document" aria-label={`Quote ${quote.number}`}>
      <header className="quote-document-head">
        <div>
          <p className="quote-seller">{seller}</p>
          <h2>Quote {quote.number}{quote.revision > 1 ? ` (revision ${quote.revision})` : ""}</h2>
        </div>
        <dl>
          <div><dt>Issued</dt><dd>{date(quote.issuedOn)}</dd></div>
          <div><dt>Valid until</dt><dd>{date(quote.expiresOn)}</dd></div>
          <div><dt>Currency</dt><dd>{quote.currency}</dd></div>
        </dl>
      </header>
      <section className="quote-parties">
        <div>
          <h3>For</h3>
          <p><strong>{customer.name}</strong></p>
          {customer.address.map((line, index) => <p key={index}>{line}</p>)}
          {customer.taxId ? <p>Tax ID: {customer.taxId}</p> : null}
        </div>
        {quote.recipientName && quote.recipientName !== customer.displayName ? (
          <div>
            <h3>Attention</h3>
            <p>{quote.recipientName}</p>
            {quote.recipientEmail ? <p>{quote.recipientEmail}</p> : null}
          </div>
        ) : null}
      </section>
      <table className="quote-items">
        <thead>
          <tr>
            <th>Description</th>
            <th className="num">Qty</th>
            <th className="num">Unit price</th>
            <th className="num">Discount</th>
            <th>Tax</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {quote.items.map((item) => (
            <tr key={item.id}>
              <td className="description">{item.description}</td>
              <td className="num">{quantityText(item.quantityMilli, item.unit)}</td>
              <td className="num">{show(item.unitPriceMinor)}</td>
              <td className="num">{discountText(item, show)}</td>
              <td>{taxText(item)}</td>
              <td className="num">{show(item.netMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="quote-totals">
        <div><dt>Subtotal{inclusive ? " (including tax)" : ""}</dt><dd>{show(quote.subtotalMinor)}</dd></div>
        {quote.discountMinor > 0n ? <div><dt>Discounts included</dt><dd>{show(quote.discountMinor)}</dd></div> : null}
        {taxLines.map((tax) => (
          <div key={tax.taxRateId}>
            <dt>{taxLineLabel(tax, inclusive, show)}</dt>
            <dd>{show(BigInt(tax.taxMinor))}</dd>
          </div>
        ))}
        <div className="grand-total"><dt>Total ({quote.currency})</dt><dd>{show(quote.totalMinor)}</dd></div>
      </dl>
      {quote.notes ? <section className="quote-text"><h3>Notes</h3><p>{quote.notes}</p></section> : null}
      {quote.terms ? <section className="quote-text"><h3>Terms</h3><p>{quote.terms}</p></section> : null}
    </article>
  );
}
