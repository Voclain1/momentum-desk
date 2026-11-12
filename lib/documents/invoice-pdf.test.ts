import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { type InvoicePdfData, renderInvoicePdf } from "./invoice-pdf";

async function text(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({ data: bytes, useSystemFonts: false }).promise;
  const parts: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    parts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return parts.join(" ").replace(/\s+/g, " ");
}

const base: InvoicePdfData = {
  number: "INV-0007", status: "issued", currency: "GHS", taxMode: "exclusive",
  issuedOn: new Date("2026-11-12T00:00:00Z"), dueOn: new Date("2026-12-12T00:00:00Z"),
  recipientName: null, recipientEmail: null, customerSnapshot: { name: "Mensah Traders", city: "Accra", countryCode: "GH" },
  notes: null, terms: "Net 30", paymentInstructions: "GCB Bank · Sun Power · 1234567890",
  subtotalMinor: 100000n, discountMinor: 0n, taxMinor: 0n, totalMinor: 100000n, taxLines: [], paidMinor: 0n, voidedAt: null,
  items: [{ description: "Solar lantern", quantityMilli: 10000n, unit: "unit", unitPriceMinor: 10000n, discountKind: "none", discountValue: 0n, taxName: null, taxMilliPercent: null, netMinor: 100000n }],
};
const options = { seller: "Sun Power", locale: "en-GH" };

describe("renderInvoicePdf", () => {
  it("prints the invoice with the cedi sign, due date and how to pay", async () => {
    const out = await text(await renderInvoicePdf(base, options));
    for (const expected of ["Invoice INV-0007", "Due", "12 December 2026", "Mensah Traders", "GH₵1,000.00", "HOW TO PAY", "GCB Bank · Sun Power · 1234567890", "Net 30"]) {
      expect(out).toContain(expected);
    }
    expect(out).not.toContain("Balance due");
  });

  it("shows paid and balance due, paid in full, drafts and void invoices", async () => {
    expect(await text(await renderInvoicePdf({ ...base, paidMinor: 40000n }, options))).toMatch(/Paid GH₵400\.00 Balance due \(GHS\) GH₵600\.00/);
    expect(await text(await renderInvoicePdf({ ...base, paidMinor: 100000n }, options))).toContain("Paid in full. Thank you.");
    expect(await text(await renderInvoicePdf({ ...base, number: null, status: "draft" }, options))).toContain("DRAFT — not issued");
    const cancelled = await text(await renderInvoicePdf({ ...base, status: "void", voidedAt: new Date("2026-11-20T10:00:00Z") }, options));
    expect(cancelled).toContain("VOID — cancelled, nothing is owed");
    expect(cancelled).toContain("Cancelled on 20 November 2026.");
    expect(cancelled).not.toContain("HOW TO PAY");
  });
});
