import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import { formatMoney, money } from "@/lib/money";
import {
  dateText,
  discountText,
  partyLines,
  quantityText,
  taxLineLabel,
  taxLinesOf,
  taxText,
} from "./present";

/**
 * A quote as a PDF (spec §7.5), drawn from the same copied snapshot as the
 * web view (lib/documents/present.ts). Plain layout for now; the design
 * system comes later. DejaVu Sans is embedded (subset) so every currency
 * sign prints (₦, ₵, ₹, ₸ …). Right-to-left and complex scripts are not
 * shaped yet.
 */

export interface QuotePdfData {
  number: string;
  revision: number;
  status: string;
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
  acceptedAt: Date | null;
  items: {
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

const FONT_DIR = join(process.cwd(), "lib/documents/fonts");
let fonts: Promise<[Uint8Array, Uint8Array]> | null = null;
const loadFonts = () =>
  (fonts ??= Promise.all([readFile(join(FONT_DIR, "DejaVuSans.ttf")), readFile(join(FONT_DIR, "DejaVuSans-Bold.ttf"))]));

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const INK = rgb(0.1, 0.13, 0.14);
const MUTED = rgb(0.45, 0.5, 0.52);
const RULE = rgb(0.85, 0.88, 0.87);

/** Splits text into lines that fit `width`, keeping the author's line breaks; very long words are cut. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

/** What a document's PDF shows besides the shared parts (lines, totals, notes, terms). */
export interface PdfLayout {
  title: string;
  /** A warning in the top right, e.g. "DRAFT — not sent to the customer". */
  stamp?: string;
  facts: [string, string][];
  /** Rows after the total, e.g. paid and balance due; the flag marks a grand row. */
  extraTotals?: [string, string, boolean][];
  /** Sections before notes and terms, e.g. how to pay. */
  sections?: [string, string | null][];
  /** A closing line, e.g. "Accepted on …". */
  closing?: string;
}

export type DocumentPdfData = Omit<QuotePdfData, "number" | "revision" | "status" | "expiresOn" | "acceptedAt" | "issuedOn">;

export async function renderQuotePdf(quote: QuotePdfData, options: { seller: string; locale: string }): Promise<Uint8Array> {
  const { locale } = options;
  return renderDocumentPdf(quote, {
    title: `Quote ${quote.number}${quote.revision > 1 ? ` (revision ${quote.revision})` : ""}`,
    stamp: quote.status === "draft" ? "DRAFT — not sent to the customer" : undefined,
    facts: [["Issued", dateText(quote.issuedOn, locale)], ["Valid until", dateText(quote.expiresOn, locale)]],
    closing: quote.status === "accepted" && quote.acceptedAt ? `Accepted on ${dateText(quote.acceptedAt, locale)}.` : undefined,
  }, options);
}

export async function renderDocumentPdf(quote: DocumentPdfData, layout: PdfLayout, { seller, locale }: { seller: string; locale: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await loadFonts();
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  const { title } = layout;
  pdf.setTitle(`${title} — ${seller}`);
  pdf.setAuthor(seller);
  pdf.setCreator("MomentumDesk");
  pdf.setProducer("MomentumDesk");
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));

  const show = (minor: bigint) => formatMoney(money(minor, quote.currency), locale);
  const customer = partyLines(quote.customerSnapshot, locale);
  const inclusive = quote.taxMode === "inclusive";
  const contentWidth = A4.width - 2 * MARGIN;

  let page: PDFPage = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;

  const text = (value: string, x: number, at: number, { size = 9, font = regular, color = INK, align = "left" as "left" | "right" } = {}) => {
    const drawX = align === "right" ? x - font.widthOfTextAtSize(value, size) : x;
    page.drawText(value, { x: drawX, y: at, size, font, color });
  };
  const rule = (at: number) => page.drawLine({ start: { x: MARGIN, y: at }, end: { x: A4.width - MARGIN, y: at }, thickness: 0.6, color: RULE });
  /** Starts a new page when `height` does not fit; returns whether it did. */
  const ensure = (height: number) => {
    if (y - height >= MARGIN + 24) return false;
    page = pdf.addPage([A4.width, A4.height]);
    y = A4.height - MARGIN;
    return true;
  };

  // Header: seller and title on the left, dates on the right.
  if (layout.stamp) {
    text(layout.stamp, A4.width - MARGIN, y, { size: 8, font: bold, color: rgb(0.75, 0.33, 0.33), align: "right" });
  }
  text(seller, MARGIN, y, { size: 11, font: bold });
  y -= 22;
  text(title, MARGIN, y, { size: 16, font: bold });
  const facts: [string, string][] = [...layout.facts, ["Currency", quote.currency]];
  // Labels right-aligned against the widest value, so long dates never collide.
  const valueWidth = Math.max(...facts.map(([, value]) => bold.widthOfTextAtSize(value, 9)));
  facts.forEach(([label, value], index) => {
    const at = y + 14 - index * 13;
    text(label, A4.width - MARGIN - valueWidth - 10, at, { color: MUTED, align: "right" });
    text(value, A4.width - MARGIN, at, { font: bold, align: "right" });
  });
  y -= 30;
  rule(y);
  y -= 18;

  // Parties.
  const partyTop = y;
  text("FOR", MARGIN, y, { size: 7, color: MUTED });
  y -= 13;
  text(customer.name, MARGIN, y, { font: bold });
  for (const line of [...customer.address, ...(customer.taxId ? [`Tax ID: ${customer.taxId}`] : [])]) {
    for (const part of wrap(line, regular, 9, contentWidth / 2 - 10)) {
      y -= 12;
      text(part, MARGIN, y);
    }
  }
  if (quote.recipientName && quote.recipientName !== customer.displayName) {
    let right = partyTop;
    text("ATTENTION", MARGIN + contentWidth / 2, right, { size: 7, color: MUTED });
    right -= 13;
    text(quote.recipientName, MARGIN + contentWidth / 2, right);
    if (quote.recipientEmail) text(quote.recipientEmail, MARGIN + contentWidth / 2, right - 12);
    y = Math.min(y, right - 12);
  }
  y -= 24;

  // Lines table.
  // Number columns are as wide as their widest value; the description takes
  // what is left, so large amounts never overlap.
  const gap = 10;
  const taxWidth = 60;
  const widest = (header: string, values: string[]) =>
    Math.max(bold.widthOfTextAtSize(header, 7.5), ...values.map((value) => regular.widthOfTextAtSize(value, 9)));
  const amountWidth = widest("Amount", quote.items.map((item) => show(item.netMinor)));
  const discountWidth = widest("Discount", quote.items.map((item) => discountText(item, show)));
  const unitPriceWidth = widest("Unit price", quote.items.map((item) => show(item.unitPriceMinor)));
  const quantityWidth = widest("Qty", quote.items.map((item) => quantityText(item.quantityMilli, item.unit)));
  const amountRight = A4.width - MARGIN;
  const taxLeft = amountRight - amountWidth - gap - taxWidth;
  const discountRight = taxLeft - gap;
  const unitPriceRight = discountRight - discountWidth - gap;
  const quantityRight = unitPriceRight - unitPriceWidth - gap;
  const columns = {
    description: MARGIN,
    quantity: quantityRight,
    unitPrice: unitPriceRight,
    discount: discountRight,
    tax: taxLeft,
    amount: amountRight,
  };
  const descriptionWidth = Math.max(90, quantityRight - quantityWidth - gap - MARGIN);
  const tableHeader = () => {
    text("Description", columns.description, y, { size: 7.5, font: bold, color: MUTED });
    text("Qty", columns.quantity, y, { size: 7.5, font: bold, color: MUTED, align: "right" });
    text("Unit price", columns.unitPrice, y, { size: 7.5, font: bold, color: MUTED, align: "right" });
    text("Discount", columns.discount, y, { size: 7.5, font: bold, color: MUTED, align: "right" });
    text("Tax", columns.tax, y, { size: 7.5, font: bold, color: MUTED });
    text("Amount", columns.amount, y, { size: 7.5, font: bold, color: MUTED, align: "right" });
    y -= 6;
    rule(y);
    y -= 13;
  };
  tableHeader();
  for (const item of quote.items) {
    const description = wrap(item.description, regular, 9, descriptionWidth);
    const tax = wrap(taxText(item), regular, 8, taxWidth);
    const height = Math.max(description.length, tax.length) * 11 + 8;
    if (ensure(height)) tableHeader();
    description.forEach((line, index) => text(line, columns.description, y - index * 11));
    text(quantityText(item.quantityMilli, item.unit), columns.quantity, y, { align: "right" });
    text(show(item.unitPriceMinor), columns.unitPrice, y, { align: "right" });
    text(discountText(item, show), columns.discount, y, { align: "right" });
    tax.forEach((line, index) => text(line, columns.tax, y - index * 11, { size: 8 }));
    text(show(item.netMinor), columns.amount, y, { align: "right" });
    y -= height - 3;
    rule(y + 8);
    y -= 3;
  }

  // Totals.
  const totals: [string, string, boolean][] = [
    [`Subtotal${inclusive ? " (including tax)" : ""}`, show(quote.subtotalMinor), false],
    ...(quote.discountMinor > 0n ? [["Discounts included", show(quote.discountMinor), false] as [string, string, boolean]] : []),
    ...taxLinesOf(quote.taxLines).map((tax) => [taxLineLabel(tax, inclusive, show), show(BigInt(tax.taxMinor)), false] as [string, string, boolean]),
    [`Total (${quote.currency})`, show(quote.totalMinor), true],
    ...(layout.extraTotals ?? []),
  ];
  ensure(totals.length * 15 + 20);
  y -= 8;
  for (const [label, value, grand] of totals) {
    if (grand) {
      page.drawLine({ start: { x: A4.width - MARGIN - 250, y: y + 10 }, end: { x: A4.width - MARGIN, y: y + 10 }, thickness: 0.6, color: RULE });
      y -= 4;
    }
    text(label, A4.width - MARGIN - 250, y, { size: grand ? 11 : 9, font: grand ? bold : regular, color: grand ? INK : MUTED });
    text(value, A4.width - MARGIN, y, { size: grand ? 11 : 9, font: grand ? bold : regular, align: "right" });
    y -= grand ? 18 : 14;
  }

  // Notes and terms.
  for (const [heading, body] of [...(layout.sections ?? []), ["NOTES", quote.notes], ["TERMS", quote.terms]] as [string, string | null][]) {
    if (!body) continue;
    y -= 10;
    ensure(30);
    text(heading, MARGIN, y, { size: 7, color: MUTED });
    y -= 13;
    for (const line of wrap(body, regular, 9, contentWidth)) {
      ensure(12);
      text(line, MARGIN, y);
      y -= 12;
    }
  }

  if (layout.closing) {
    y -= 10;
    ensure(20);
    text(layout.closing, MARGIN, y, { font: bold, color: rgb(0.15, 0.51, 0.41) });
  }

  // Footer on every page.
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    const footer = `${title} · ${seller} · page ${index + 1} of ${pages.length}`;
    p.drawText(footer, { x: MARGIN, y: MARGIN - 20, size: 7, font: regular, color: MUTED });
  });

  return pdf.save();
}
