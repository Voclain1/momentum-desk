import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { InvoiceDocument } from "@/app/_documents/invoice-document";
import { dateText } from "@/lib/documents/present";
import { openInvoice } from "@/lib/invoices/public";
import { formatMoney, money } from "@/lib/money";
import { confirmReturn, payOptions } from "@/lib/payments/online";
import { onlineDeps } from "@/lib/payments/server";
import { publicLinks, tenantData } from "@/lib/tenant";
import { payAction } from "./actions";
import { PayPanel } from "./pay";

// Private by token: never indexed, and the token is not sent onward as a referrer.
export const metadata: Metadata = {
  title: "Invoice",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const RETURN_MESSAGES: Record<string, { tone: string; text: string }> = {
  recorded: { tone: "saved", text: "Payment received. Thank you." },
  already_recorded: { tone: "saved", text: "Payment received. Thank you." },
  pending: { tone: "saved", text: "Your payment is being confirmed by the provider. This page will show it once it is." },
  failed: { tone: "error", text: "The payment did not go through. You can try again." },
  refused: { tone: "error", text: "We could not confirm this payment automatically; the business will check it." },
};

export default async function PublicInvoicePage({ params, searchParams }: PageProps<"/i/[token]">) {
  const { token } = await params;
  const attempt = (await searchParams).attempt;
  // Back from checkout: ask the provider's API (server to server). The redirect itself proves nothing.
  const returned = typeof attempt === "string" ? await confirmReturn(onlineDeps, token, attempt) : null;
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
  const options = status === "void" || status === "paid" ? [] : await payOptions(onlineDeps, token);
  const notice = returned && returned !== "invalid" ? RETURN_MESSAGES[returned] : null;
  return (
    <main className="public-page">
      {notice && !(status === "paid" && notice.tone === "saved") ? (
        <p role="status" className={`settings-message ${notice.tone} public-banner`}>{notice.text}</p>
      ) : null}
      <p role="status" className={`settings-message ${banner.tone} public-banner`}>{banner.text}</p>
      {options.length ? (
        <PayPanel
          amount={owed}
          choices={options.map((option) => ({ ...option, action: payAction.bind(null, token, option.connectionId) }))}
        />
      ) : null}
      <InvoiceDocument invoice={invoice} seller={seller.name} locale={seller.locale} />
      <p className="public-download">
        <a href={`/i/${token}/pdf`} className="link-button" download>Download PDF</a>
      </p>
    </main>
  );
}
