import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuoteDocument } from "@/app/_documents/quote-document";
import { emailSender } from "@/lib/email/server";
import { openQuote } from "@/lib/quotes/public";
import { publicLinks, tenantData } from "@/lib/tenant";
import { confirmCodeAction, rejectAction, requestCodeAction, visitorFrom } from "./actions";
import { Respond } from "./respond";

// Private by token: never indexed, and the token is not sent onward as a referrer.
export const metadata: Metadata = {
  title: "Quote",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PublicQuotePage({ params }: PageProps<"/q/[token]">) {
  const { token } = await params;
  const view = await openQuote({ data: tenantData, links: publicLinks, email: emailSender }, token, await visitorFrom());
  // Unknown, revoked and draft links all look the same.
  if (view.state === "invalid") notFound();
  if (view.state === "superseded") {
    return (
      <main className="public-page">
        <section className="panel no-access" role="note">
          <strong>This quote was replaced by a newer version.</strong>
          <p>Ask {view.seller} for the link to the latest version.</p>
        </section>
      </main>
    );
  }

  const { quote, seller } = view;
  const date = new Intl.DateTimeFormat(seller.locale, { dateStyle: "long" });
  return (
    <main className="public-page">
      {quote.status === "accepted" && view.acceptance ? (
        <p role="status" className="settings-message saved public-banner">
          Accepted{view.acceptance.name ? ` by ${view.acceptance.name}` : ""} on {date.format(view.acceptance.at)}. Thank you; {seller.name} has
          your acceptance of this version.
        </p>
      ) : null}
      {quote.status === "rejected" ? <p role="status" className="settings-message error public-banner">You declined this quote. Your answer has been recorded for {seller.name}.</p> : null}
      {view.expired ? (
        <p role="status" className="settings-message error public-banner">This quote has expired. Contact {seller.name} for a new one.</p>
      ) : null}
      <QuoteDocument quote={quote} seller={seller.name} locale={seller.locale} />
      {view.open ? (
        <Respond
          requestCode={requestCodeAction.bind(null, token)}
          confirmCode={confirmCodeAction.bind(null, token)}
          reject={rejectAction.bind(null, token)}
          recipientEmail={view.recipientEmail}
          pendingCode={view.pendingCode}
        />
      ) : null}
    </main>
  );
}
