/** Builder state, shared by the server pages that fill it and the client builder. */

export interface LineValues {
  key: string;
  productId: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountKind: "none" | "percent" | "fixed";
  discount: string;
  taxRateId: string;
}

export interface QuoteValues {
  customerId: string;
  recipientContactId: string;
  leadId: string;
  currency: string;
  taxMode: "exclusive" | "inclusive";
  issuedOn: string;
  expiresOn: string;
  notes: string;
  terms: string;
  lines: LineValues[];
}

let nextKey = 0;
export const newLine = (values: Partial<LineValues> = {}): LineValues => ({
  key: `line-${nextKey++}`,
  productId: "", description: "", quantity: "1", unit: "", unitPrice: "", discountKind: "none", discount: "", taxRateId: "",
  ...values,
});

