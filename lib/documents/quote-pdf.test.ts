import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { renderQuotePdf, type QuotePdfData } from "./quote-pdf";

/** The text on each page, in reading order. */
async function pagesText(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: bytes, useSystemFonts: false }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages;
}

const base: QuotePdfData = {
  number: "Q-0042", revision: 2, status: "sent", currency: "NGN", taxMode: "exclusive",
  issuedOn: new Date("2026-11-12T00:00:00Z"), expiresOn: new Date("2026-12-12T00:00:00Z"),
  recipientName: "Chidi Okafor", recipientEmail: "chidi@okafor.ng",
  customerSnapshot: { name: "Okafor Farms", legalName: "Okafor Farms Ltd", taxId: "TIN-123", addressLine1: "1 Farm Road", city: "Ibadan", countryCode: "NG" },
  notes: "Installation within two weeks of acceptance.", terms: "50% deposit, balance on completion.",
  subtotalMinor: 38175325n, discountMinor: 3700000n, taxMinor: 2863149n, totalMinor: 41038474n,
  taxLines: [{ taxRateId: "vat", name: "VAT", milliPercent: 7500, baseMinor: "38175325", taxMinor: "2863149" }],
  acceptedAt: null,
  items: [
    { description: "Solar panel 400W", quantityMilli: 2000n, unit: "unit", unitPriceMinor: 18500000n, discountKind: "percent", discountValue: 10000n, taxName: "VAT", taxMilliPercent: 7500, netMinor: 33300000n },
    { description: "Installation", quantityMilli: 6500n, unit: "hour", unitPriceMinor: 750050n, discountKind: "none", discountValue: 0n, taxName: "VAT", taxMilliPercent: 7500, netMinor: 4875325n },
  ],
};

describe("renderQuotePdf", () => {
  it("prints the copied snapshot with exact amounts and the naira sign", async () => {
    const bytes = await renderQuotePdf(base, { seller: "Bright Solar", locale: "en-NG" });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const [text] = await pagesText(bytes);
    for (const expected of [
      "Bright Solar", "Quote Q-0042 (revision 2)", "12 November 2026", "12 December 2026",
      "Okafor Farms Ltd", "1 Farm Road", "Ibadan", "Nigeria", "Tax ID: TIN-123", "Chidi Okafor",
      "Solar panel 400W", "2 unit", "₦185,000.00", "10%", "₦333,000.00", "6.5 hour", "₦7,500.50", "₦48,753.25",
      "VAT 7.5% on ₦381,753.25", "₦28,631.49", "Total (NGN)", "₦410,384.74",
      "Installation within two weeks of acceptance.", "50% deposit, balance on completion.", "page 1 of 1",
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain("DRAFT");
  });

  it("marks drafts and acceptance, and prints zero- and three-decimal currencies", async () => {
    const draft = (await pagesText(await renderQuotePdf({ ...base, status: "draft" }, { seller: "S", locale: "en-NG" })))[0];
    expect(draft).toContain("DRAFT — not sent to the customer");
    const accepted = (await pagesText(await renderQuotePdf({ ...base, status: "accepted", acceptedAt: new Date("2026-11-20T09:00:00Z") }, { seller: "S", locale: "en-NG" })))[0];
    expect(accepted).toContain("Accepted on 20 November 2026.");

    const kwd = { ...base, currency: "KWD", taxLines: [], items: [{ ...base.items[1], unitPriceMinor: 1235n, netMinor: 8028n }], totalMinor: 8028n, subtotalMinor: 8028n, discountMinor: 0n };
    expect((await pagesText(await renderQuotePdf(kwd, { seller: "S", locale: "en-GB" })))[0]).toContain("KWD 8.028");
    const jpy = { ...kwd, currency: "JPY", items: [{ ...base.items[1], unitPriceMinor: 333n, netMinor: 999n }], totalMinor: 999n };
    expect((await pagesText(await renderQuotePdf(jpy, { seller: "S", locale: "ja-JP" })))[0]).toContain("999");
  });

  it("wraps long text and continues the table on new pages", async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      ...base.items[1],
      description: `Line ${i + 1}: ${"supply and fit of mounting rail with clamps ".repeat(i % 3 === 0 ? 4 : 1)}`,
    }));
    const pages = await pagesText(await renderQuotePdf({ ...base, items }, { seller: "S", locale: "en-NG" }));
    expect(pages.length).toBeGreaterThan(2);
    // Every page carrying table rows repeats the column headings.
    const withRows = pages.filter((page) => page.includes("Line "));
    expect(withRows.length).toBeGreaterThan(1);
    expect(withRows.every((page) => page.includes("Description") && page.includes("Amount"))).toBe(true);
    expect(pages.at(-1)).toContain(`page ${pages.length} of ${pages.length}`);
    expect(pages.join(" ")).toContain("Line 60:");
    expect(pages.join(" ")).toMatch(/Total \(NGN\)\s+₦410,384\.74/);
  });
});
