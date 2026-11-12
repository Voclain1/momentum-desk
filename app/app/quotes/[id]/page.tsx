import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QuoteDocument } from "@/app/_documents/quote-document";
import { todayIn } from "@/lib/dates";
import { formatScaled } from "@/lib/documents/calc";
import { RecordNotFoundError } from "@/lib/errors";
import { leadName } from "@/lib/leads/labels";
import { formatMoney, money, toDecimalString } from "@/lib/money";
import { displayStatus, getQuote } from "@/lib/quotes/service";
import { invoiceForQuote } from "@/lib/invoices/service";
import { quoteActivity } from "@/lib/quotes/sharing";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../../_components/no-access";
import {
  createLinkAction,
  deleteDraftAction,
  duplicateQuoteAction,
  emailQuoteAction,
  revokeLinksAction,
  reviseQuoteAction,
  sendQuoteAction,
  updateDraftAction,
} from "../actions";
import { newLine } from "../builder-values";
import { STATUS_LABELS } from "../labels";
import { builderOptions } from "../page-data";
import { QuoteActions } from "../quote-actions";
import { invoiceQuoteAction } from "../../invoices/actions";
import { StepButton } from "../../invoices/panels";
import { SharePanel } from "../share-panel";
import { QuoteBuilder } from "../quote-builder";

export const metadata: Metadata = { title: "Quote — MomentumDesk" };

export default async function QuotePage({ params }: PageProps<"/app/quotes/[id]">) {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("quotes:read")) return <NoAccess title="Quote" />;
  const { id } = await params;
  const { organization } = tenant;
  let quote;
  try {
    quote = await getQuote(tenantData, organization.id, id);
  } catch (error) {
    if (error instanceof RecordNotFoundError) notFound();
    throw error;
  }
  const canEdit = tenant.can("quotes:write");
  const today = todayIn(organization.timezone);
  const shown = displayStatus(quote, today);
  const isDraft = quote.status === "draft";
  const latest = quote.revisions[0];
  const isLatest = latest.id === quote.id;
  const date = new Intl.DateTimeFormat(organization.locale, { dateStyle: "medium", timeZone: organization.timezone });
  const day = new Intl.DateTimeFormat(organization.locale, { dateStyle: "medium", timeZone: "UTC" });
  const time = new Intl.DateTimeFormat(organization.locale, { dateStyle: "medium", timeStyle: "short", timeZone: organization.timezone });
  const activity = isDraft ? { links: [], events: [] } : await quoteActivity(tenantData, organization.id, quote.id);
  const activeLinks = activity.links.filter((link) => !link.revokedAt).length;
  const shareable = ["sent", "accepted", "rejected"].includes(quote.status);
  const invoice = quote.status === "accepted" ? await invoiceForQuote(tenantData, organization.id, quote.id) : null;

  const header = (
    <header className="topbar">
      <div>
        <p>
          <Link href="/app/quotes" className="crumb">QUOTES</Link> · <span className={`status-pill ${shown}`}>{STATUS_LABELS[shown]}</span>
        </p>
        <h1>
          {quote.number}
          {quote.revision > 1 ? ` · revision ${quote.revision}` : ""} — {quote.customer.displayName}
        </h1>
      </div>
    </header>
  );

  const side = (
    <aside className="record-side">
      <section className="panel contacts-panel" aria-label="Status">
        <div className="panel-heading">
          <div>
            <h3>Status</h3>
            <p>
              {isDraft
                ? "A draft: edit freely. Marking it sent fixes its content."
                : shown === "accepted"
                  ? "Accepted. This version is final and cannot be revised."
                  : shown === "superseded"
                    ? "Replaced by a newer revision."
                    : shown === "expired"
                      ? "Past its validity date. Revise to make a new offer."
                      : "Sent. Share it below. Revise to change it; the customer keeps this version until the revision is sent."}
            </p>
          </div>
        </div>
        <p className="quote-download">
          <a href={`/app/quotes/${quote.id}/pdf`} className="link-button" download>Download PDF</a>
        </p>
        {canEdit ? (
          <QuoteActions
            send={isDraft ? sendQuoteAction.bind(null, quote.id, quote.version) : undefined}
            revise={!isDraft && isLatest && quote.status !== "accepted" && quote.status !== "superseded" ? reviseQuoteAction.bind(null, quote.id) : undefined}
            duplicate={duplicateQuoteAction.bind(null, quote.id)}
            remove={isDraft ? deleteDraftAction.bind(null, quote.id) : undefined}
          />
        ) : null}
        <ul className="contact-list">
          <li><div><small>Customer</small><Link href={`/app/customers/${quote.customer.id}`}>{quote.customer.displayName}</Link></div></li>
          {quote.lead && tenant.can("sales:read") ? (
            <li><div><small>Lead</small><Link href={`/app/leads/${quote.lead.id}`}>{leadName(quote.lead)}</Link></div></li>
          ) : null}
          <li><div><small>Created</small>{date.format(quote.createdAt)}{quote.createdBy ? ` by ${quote.createdBy.name}` : ""}</div></li>
          {quote.sentAt ? <li><div><small>Sent</small>{date.format(quote.sentAt)}</div></li> : null}
          {quote.viewedAt ? <li><div><small>First viewed</small>{date.format(quote.viewedAt)}</div></li> : null}
          {quote.acceptedAt ? <li><div><small>Accepted</small>{date.format(quote.acceptedAt)}</div></li> : null}
          {quote.rejectedAt ? <li><div><small>Rejected</small>{date.format(quote.rejectedAt)}</div></li> : null}
        </ul>
      </section>
      {quote.status === "accepted" && (invoice ? tenant.can("invoices:read") : tenant.can("invoices:write")) ? (
        <section className="panel contacts-panel" aria-label="Invoice">
          <div className="panel-heading">
            <div>
              <h3>Invoice</h3>
              <p>{invoice ? "This quote has been invoiced." : "The invoice copies the accepted lines and amounts exactly."}</p>
            </div>
          </div>
          <div className="quote-actions">
            {invoice ? (
              <a href={`/app/invoices/${invoice.id}`} className="link-button">{invoice.number ?? "Draft invoice"}</a>
            ) : (
              <StepButton primary action={invoiceQuoteAction.bind(null, quote.id)} label="Invoice this quote" />
            )}
          </div>
        </section>
      ) : null}
      {shareable && canEdit ? (
        <SharePanel
          email={quote.status === "sent" ? emailQuoteAction.bind(null, quote.id, organization.name) : undefined}
          createLink={createLinkAction.bind(null, quote.id)}
          revoke={revokeLinksAction.bind(null, quote.id)}
          recipientEmail={quote.recipientEmail}
          activeLinks={activeLinks}
        />
      ) : null}
      {activity.events.length ? (
        <section className="panel contacts-panel" aria-label="Customer activity">
          <div className="panel-heading"><div><h3>Customer activity</h3><p>From the quote&apos;s link. Kept as evidence; never edited.</p></div></div>
          <ul className="contact-list">
            {activity.events.map((event) => (
              <li key={event.id}>
                <div>
                  <strong>
                    {{ viewed: "Viewed", code_sent: "Acceptance code sent", accepted: "Accepted", rejected: "Declined" }[event.kind] ?? event.kind}
                  </strong>
                  <small>{time.format(event.createdAt)}</small>
                  {event.kind === "accepted" ? (
                    <small>
                      By {event.name}, confirmed by a code sent to {event.email}. Version fingerprint {event.contentHash?.slice(0, 12)}.
                    </small>
                  ) : null}
                  {event.kind === "code_sent" ? <small>To {event.email}{event.name ? ` for ${event.name}` : ""}</small> : null}
                  {event.kind === "rejected" ? (
                    <small>{event.name ? `By ${event.name}. ` : ""}{event.reason ? `Reason: ${event.reason}` : "No reason given."}</small>
                  ) : null}
                  {event.ipAddress ? <small>From {event.ipAddress}</small> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {quote.revisions.length > 1 ? (
        <section className="panel contacts-panel" aria-label="Revisions">
          <div className="panel-heading"><div><h3>Revisions</h3><p>Every version is kept.</p></div></div>
          <ul className="contact-list">
            {quote.revisions.map((revision) => {
              const state = displayStatus({ ...revision, status: revision.status }, today);
              return (
                <li key={revision.id}>
                  <div>
                    <strong>
                      {revision.id === quote.id ? `Revision ${revision.revision}` : <Link href={`/app/quotes/${revision.id}`}>Revision {revision.revision}</Link>}
                      <span className={`status-pill ${state}`}>{STATUS_LABELS[state]}</span>
                    </strong>
                    <small>
                      {formatMoney(money(revision.totalMinor, quote.currency), organization.locale)}
                      {revision.sentAt ? ` · sent ${date.format(revision.sentAt)}` : ` · started ${date.format(revision.createdAt)}`}
                    </small>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </aside>
  );

  if (isDraft && canEdit) {
    const options = await builderOptions(organization.id, {
      taxRates: quote.items.flatMap((item) =>
        item.taxRateId && item.taxName !== null && item.taxMilliPercent !== null
          ? [{ id: item.taxRateId, name: item.taxName, milliPercent: item.taxMilliPercent }]
          : [],
      ),
    });
    // Keep the current customer on the list even if archived since.
    if (!options.customers.some((c) => c.id === quote.customer.id)) {
      options.customers.push({
        id: quote.customer.id, name: quote.customer.displayName, email: quote.customer.email,
        preferredCurrency: quote.customer.preferredCurrency, contacts: [],
      });
    }
    const contact = quote.customer.contacts.find((c) => c.name === quote.recipientName && c.email === quote.recipientEmail);
    return (
      <>
        {header}
        <section className="quote-page">
          <div className="panel settings-panel wide">
            <QuoteBuilder
              action={updateDraftAction.bind(null, quote.id)}
              version={quote.version}
              options={options}
              locale={organization.locale}
              submitLabel="Save draft"
              initial={{
                customerId: quote.customerId,
                recipientContactId: contact?.id ?? "",
                leadId: quote.leadId ?? "",
                currency: quote.currency,
                taxMode: quote.taxMode as "exclusive" | "inclusive",
                issuedOn: quote.issuedOn.toISOString().slice(0, 10),
                endsOn: quote.expiresOn.toISOString().slice(0, 10),
                notes: quote.notes ?? "",
                terms: quote.terms ?? "",
                lines: quote.items.map((item) =>
                  newLine({
                    productId: item.productId ?? "",
                    description: item.description,
                    quantity: formatScaled(item.quantityMilli, 3),
                    unit: item.unit ?? "",
                    unitPrice: toDecimalString(money(item.unitPriceMinor, quote.currency)),
                    discountKind: item.discountKind as "none" | "percent" | "fixed",
                    discount:
                      item.discountKind === "percent"
                        ? formatScaled(item.discountValue, 3)
                        : item.discountKind === "fixed"
                          ? toDecimalString(money(item.discountValue, quote.currency))
                          : "",
                    taxRateId: item.taxRateId ?? "",
                  }),
                ),
              }}
            />
          </div>
          {side}
        </section>
      </>
    );
  }

  return (
    <>
      {header}
      <p className="record-meta">Valid until {day.format(quote.expiresOn)}</p>
      <section className="quote-page">
        <QuoteDocument quote={quote} seller={organization.name} locale={organization.locale} />
        {side}
      </section>
    </>
  );
}
