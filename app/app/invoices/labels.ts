import type { InvoiceStatus } from "@/lib/invoices/service";
import type { PaymentMethod } from "@/lib/payments/service";

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  viewed: "Viewed",
  partially_paid: "Partly paid",
  paid: "Paid",
  overdue: "Overdue",
  disputed: "Disputed",
  void: "Void",
};

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  cash: "Cash",
  card: "Card",
  mobile_money: "Mobile money",
  cheque: "Cheque",
  other: "Other",
};
