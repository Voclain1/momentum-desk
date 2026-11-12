import { DocumentView, type DocumentData } from "./document-view";

export interface QuoteDocumentData extends DocumentData {
  number: string;
  revision: number;
  issuedOn: Date;
  expiresOn: Date;
}

/** A quote as the customer sees it (spec §7.5). */
export function QuoteDocument({ quote, seller, locale }: { quote: QuoteDocumentData; seller: string; locale: string }) {
  const name = `Quote ${quote.number}`;
  return (
    <DocumentView
      label={name}
      title={`${name}${quote.revision > 1 ? ` (revision ${quote.revision})` : ""}`}
      facts={[["Issued", quote.issuedOn], ["Valid until", quote.expiresOn]]}
      document={quote}
      seller={seller}
      locale={locale}
    />
  );
}
