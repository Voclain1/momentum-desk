import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { InvoiceDocument } from "@/app/_documents/invoice-document";
import { dateText } from "@/lib/documents/present";
import { openInvoice } from "@/lib/invoices/public";
import { formatMoney, money } from "@/lib/money";
import { publicLinks, tenantData } from "@/lib/tenant";

// Private by token: never indexed, and the token is not sent onward as a referrer.
export const metadata: Metadata = {
  title: "Invoice",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PublicInvoicePage({ params }: PageProps<"/i/[token]">) {
  const { token } = await params;
  const h = await headers();
  const view = await openInvoice({ data: tenantData, links: publicLinks }, token, {
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent"),
  });
  // Unknown, revoked and draft links all look the same.
  if (view.state === "invalid") notFound();
  const { invoice, seller, status } = view;
  const owed = formatMoney(money(invoice.totalMinor - invoice.paidMinor, invoice.currency), seller.locale);
  const banner =
    status === "void"
      ? { tone: "error", text: `This invoice was cancelled${invoice.voidedAt ? ` on ${dateText(invoice.voidedAt, seller.locale)}` : ""}. Nothing is owed on it.` }
      : status === "paid"
        ? { tone: "saved", text: "Paid in full. Thank you." }
        : status === "overdue"
          ? { tone: "error", text: `${owed} was due on ${dateText(invoice.dueOn, seller.locale)}.` }
          : { tone: "saved", text: `${owed} due by ${dateText(invoice.dueOn, seller.locale)}.` };
  return (
    <main className="public-page">
      <p role="status" className={`settings-message ${banner.tone} public-banner`}>{banner.text}</p>
      <InvoiceDocument invoice={invoice} seller={seller.name} locale={seller.locale} />
      <p className="public-download">
        <a href={`/i/${token}/pdf`} className="link-button" download>Download PDF</a>
      </p>
    </main>
  );
}
