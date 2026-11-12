import { dateText, discountText, partyLines, quantityText, taxLineLabel, taxLinesOf, taxText } from "@/lib/documents/present";
import { formatMoney, money } from "@/lib/money";

/** What a quote and an invoice share: the copied snapshot, never live data. */
export interface DocumentData {
  currency: string;
  taxMode: string;
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
 * A document as the customer sees it. Amounts are in the document's own
 * currency only, in the given locale (spec §5.5). `facts` are the dated
 * lines in the header; `after` follows the totals (e.g. payment details).
 */
export function DocumentView({
  label,
  title,
  facts,
  document,
  seller,
  locale,
  after,
}: {
  label: string;
  title: string;
  facts: [string, Date | string][];
  document: DocumentData;
  seller: string;
  locale: string;
  after?: React.ReactNode;
}) {
  const show = (minor: bigint) => formatMoney(money(minor, document.currency), locale);
  const customer = partyLines(document.customerSnapshot, locale);
  const taxLines = taxLinesOf(document.taxLines);
  const inclusive = document.taxMode === "inclusive";

  return (
    <article className="quote-document" aria-label={label}>
      <header className="quote-document-head">
        <div>
          <p className="quote-seller">{seller}</p>
          <h2>{title}</h2>
        </div>
        <dl>
          {facts.map(([name, value]) => (
            <div key={name}><dt>{name}</dt><dd>{value instanceof Date ? dateText(value, locale) : value}</dd></div>
          ))}
          <div><dt>Currency</dt><dd>{document.currency}</dd></div>
        </dl>
      </header>
      <section className="quote-parties">
        <div>
          <h3>For</h3>
          <p><strong>{customer.name}</strong></p>
          {customer.address.map((line, index) => <p key={index}>{line}</p>)}
          {customer.taxId ? <p>Tax ID: {customer.taxId}</p> : null}
        </div>
        {document.recipientName && document.recipientName !== customer.displayName ? (
          <div>
            <h3>Attention</h3>
            <p>{document.recipientName}</p>
            {document.recipientEmail ? <p>{document.recipientEmail}</p> : null}
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
          {document.items.map((item) => (
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
        <div><dt>Subtotal{inclusive ? " (including tax)" : ""}</dt><dd>{show(document.subtotalMinor)}</dd></div>
        {document.discountMinor > 0n ? <div><dt>Discounts included</dt><dd>{show(document.discountMinor)}</dd></div> : null}
        {taxLines.map((tax) => (
          <div key={tax.taxRateId}>
            <dt>{taxLineLabel(tax, inclusive, show)}</dt>
            <dd>{show(BigInt(tax.taxMinor))}</dd>
          </div>
        ))}
        <div className="grand-total"><dt>Total ({document.currency})</dt><dd>{show(document.totalMinor)}</dd></div>
      </dl>
      {after}
      {document.notes ? <section className="quote-text"><h3>Notes</h3><p>{document.notes}</p></section> : null}
      {document.terms ? <section className="quote-text"><h3>Terms</h3><p>{document.terms}</p></section> : null}
    </article>
  );
}
