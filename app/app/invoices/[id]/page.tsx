import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceDocument } from "@/app/_documents/invoice-document";
import { todayIn } from "@/lib/dates";
import { formatScaled } from "@/lib/documents/calc";
import { RecordNotFoundError } from "@/lib/errors";
import { getInvoice, invoiceStatus } from "@/lib/invoices/service";
import { invoiceActivity } from "@/lib/invoices/sharing";
import { onlineActivity } from "@/lib/payments/online";
import { canRefundThroughProvider } from "@/lib/payments/refunds";
import { getCollection } from "@/lib/receivables/service";
import { remindersFor, STOP_LABELS, type StopReason } from "@/lib/reminders/service";
import { listTeam } from "@/lib/auth/team";
import { addNoteAction, addPromiseAction, cancelPromiseAction, updateCollectionAction } from "../../receivables/actions";
import { CollectionPanel } from "../collection-panel";
import { PROVIDERS } from "@/lib/payments/providers";
import { leadName } from "@/lib/leads/labels";
import { formatMoney, money, toDecimalString } from "@/lib/money";
import { PAYMENT_METHODS } from "@/lib/payments/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../../_components/no-access";
import { newLine } from "../../quotes/builder-values";
import { builderOptions } from "../../quotes/page-data";
import { QuoteBuilder } from "../../quotes/quote-builder";
import { SharePanel } from "../../quotes/share-panel";
import {
  createInvoiceLinkAction,
  deleteDraftAction,
  emailInvoiceAction,
  revokeInvoiceLinksAction,
  disputeAction,
  issueInvoiceAction,
  recordPaymentAction,
  resolveDisputeAction,
  updateConvertedDraftAction,
  updateDraftAction,
  voidInvoiceAction,
  voidPaymentAction,
  refreshRefundAction,
  refundPaymentAction,
} from "../actions";
import { ConvertedDraftForm } from "../converted-draft";
import { INVOICE_STATUS_LABELS, METHOD_LABELS } from "../labels";
import { PaymentForm, ReasonForm, RefundForm, StepButton } from "../panels";

export const metadata: Metadata = { title: "Invoice — MomentumDesk" };

export default async function InvoicePage({ params }: PageProps<"/app/invoices/[id]">) {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("invoices:read")) return <NoAccess title="Invoice" />;
  const { id } = await params;
  const { organization } = tenant;
  let invoice;
  try {
    invoice = await getInvoice(tenantData, organization.id, id);
  } catch (error) {
    if (error instanceof RecordNotFoundError) notFound();
    throw error;
  }
  const canEdit = tenant.can("invoices:write");
  const today = todayIn(organization.timezone);
  const shown = invoiceStatus(invoice, today);
  const isDraft = invoice.status === "draft";
  const show = (minor: bigint) => formatMoney(money(minor, invoice.currency), organization.locale);
  const date = new Intl.DateTimeFormat(organization.locale, { dateStyle: "medium", timeZone: organization.timezone });
  const day = new Intl.DateTimeFormat(organization.locale, { dateStyle: "medium", timeZone: "UTC" });
  const outstanding = invoice.totalMinor - invoice.paidMinor;
  const activity = isDraft ? { links: [], events: [] } : await invoiceActivity(tenantData, organization.id, invoice.id);
  const online = isDraft || !tenant.can("payments:read") ? null : await onlineActivity(tenantData, organization.id, invoice.id);
  const providerName = (key: string) => PROVIDERS[key as keyof typeof PROVIDERS]?.name ?? key;
  const canRefund = tenant.can("payments:refund");
  const collecting = invoice.status === "issued" && tenant.can("collections:read");
  const [collection, reminders, team] = collecting
    ? await Promise.all([
        getCollection(tenantData, organization.id, invoice.id),
        remindersFor(tenantData, organization.id, invoice.id),
        listTeam(organization.id),
      ])
    : [null, [], []];
  const REMINDER_TONE: Record<string, string> = { friendly: "Friendly reminder", firm: "Firm reminder", final: "Final reminder" };
  const REFUND_STATUS: Record<string, string> = { pending: "processing", succeeded: "refunded", failed: "failed" };
  const time = new Intl.DateTimeFormat(organization.locale, { dateStyle: "medium", timeStyle: "short", timeZone: organization.timezone });

  const header = (
    <header className="topbar">
      <div>
        <p>
          <Link href="/app/invoices" className="crumb">INVOICES</Link> · <span className={`status-pill ${shown}`}>{INVOICE_STATUS_LABELS[shown]}</span>
        </p>
        <h1>{invoice.number ?? "Draft invoice"} — {invoice.customer.displayName}</h1>
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
                ? invoice.quoteId
                  ? "A draft from an accepted quote: its lines and amounts are fixed. Issuing gives it the next number."
                  : "A draft: edit freely. Issuing gives it the next number and fixes its content."
                : invoice.status === "void"
                  ? `Void: ${invoice.voidReason}`
                  : shown === "disputed"
                    ? `Disputed: ${invoice.disputeReason}`
                    : `Issued. ${show(outstanding)} of ${show(invoice.totalMinor)} still owed.`}
            </p>
          </div>
        </div>
        <div className="quote-actions">
          {isDraft && canEdit ? (
            <>
              <StepButton
                primary
                action={issueInvoiceAction.bind(null, invoice.id, invoice.version)}
                label="Issue invoice"
                confirm="Issue this invoice? It gets the next number and can no longer be changed; mistakes are corrected by voiding it."
              />
              <StepButton action={deleteDraftAction.bind(null, invoice.id)} label="Delete draft" confirm="Delete this draft?" />
            </>
          ) : null}
          {invoice.status === "issued" && canEdit ? (
            invoice.disputedAt ? (
              <StepButton action={resolveDisputeAction.bind(null, invoice.id)} label="Resolve dispute" />
            ) : (
              <ReasonForm action={disputeAction.bind(null, invoice.id)} open="Mark disputed" submit="Mark disputed" hint="What the customer disputes." />
            )
          ) : null}
          {invoice.status === "issued" && tenant.can("invoices:void") && invoice.paidMinor === 0n ? (
            <ReasonForm
              action={voidInvoiceAction.bind(null, invoice.id)}
              open="Void invoice"
              submit="Void invoice"
              hint="Kept with the invoice. Its number stays used; issue a new invoice if needed."
            />
          ) : null}
        </div>
        <ul className="contact-list">
          <li><div><small>Customer</small><Link href={`/app/customers/${invoice.customer.id}`}>{invoice.customer.displayName}</Link></div></li>
          {invoice.quote && tenant.can("quotes:read") ? (
            <li><div><small>From quote</small><Link href={`/app/quotes/${invoice.quote.id}`}>{invoice.quote.number}{invoice.quote.revision > 1 ? ` rev ${invoice.quote.revision}` : ""}</Link></div></li>
          ) : null}
          {invoice.lead && tenant.can("sales:read") ? (
            <li><div><small>Lead</small><Link href={`/app/leads/${invoice.lead.id}`}>{leadName(invoice.lead)}</Link></div></li>
          ) : null}
          <li><div><small>Created</small>{date.format(invoice.createdAt)}{invoice.createdBy ? ` by ${invoice.createdBy.name}` : ""}</div></li>
          {invoice.issuedAt ? <li><div><small>Issued</small>{date.format(invoice.issuedAt)}</div></li> : null}
          {invoice.voidedAt ? <li><div><small>Voided</small>{date.format(invoice.voidedAt)}{invoice.voidedBy ? ` by ${invoice.voidedBy.name}` : ""}</div></li> : null}
        </ul>
      </section>

      {collecting && collection ? (
        <section className="panel contacts-panel" aria-label="Collection">
          <div className="panel-heading">
            <div>
              <h3>Collection</h3>
              <p>{collection.collection?.ownerUserId ? `Owner: ${team.find((m) => m.userId === collection.collection?.ownerUserId)?.name ?? "a former member"}` : "No owner yet."}</p>
            </div>
          </div>
          <CollectionPanel
            collection={{
              status: collection.collection?.status ?? "open",
              ownerUserId: collection.collection?.ownerUserId ?? null,
              pausedUntil: collection.collection?.pausedUntil ? day.format(collection.collection.pausedUntil) : null,
              pauseReason: collection.collection?.pauseReason ?? null,
              escalationNote: collection.collection?.escalationNote ?? null,
            }}
            members={team.map((m) => ({ id: m.userId, name: m.name }))}
            canWrite={tenant.can("collections:write")}
            update={updateCollectionAction.bind(null, invoice.id)}
            addPromise={addPromiseAction.bind(null, invoice.id)}
            addNote={addNoteAction.bind(null, invoice.id)}
            currency={invoice.currency}
            owed={toDecimalString(money(outstanding, invoice.currency))}
            today={today}
          />
          <ul className="contact-list">
            {collection.promises.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>Promise: {show(p.amountMinor)} by {day.format(p.promisedOn)}</strong>
                  <small>{{ open: "Open", kept: "Kept", broken: "Broken", cancelled: "Cancelled" }[p.status] ?? p.status}{p.takenBy ? ` · taken by ${p.takenBy.name}` : ""}{p.note ? ` · ${p.note}` : ""}</small>
                </div>
                {p.status === "open" && tenant.can("collections:write") ? (
                  <div className="row-buttons"><StepButton action={cancelPromiseAction.bind(null, p.id, invoice.id)} label="Cancel promise" /></div>
                ) : null}
              </li>
            ))}
            {collection.notes.map((n) => (
              <li key={n.id}><div><strong>Note</strong><small>{n.body}</small><small>{date.format(n.createdAt)}{n.author ? ` · ${n.author.name}` : ""}</small></div></li>
            ))}
          </ul>
        </section>
      ) : null}
      {reminders.length ? (
        <section className="panel contacts-panel" aria-label="Reminders">
          <div className="panel-heading"><div><h3>Reminders</h3><p>Every reminder step, sent or skipped, with the reason.</p></div></div>
          <ul className="contact-list">
            {reminders.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>{REMINDER_TONE[r.tone] ?? r.tone} ({r.offsetDays < 0 ? `${-r.offsetDays} days before due` : `${r.offsetDays} days after due`})</strong>
                  <small>
                    {r.status === "sent"
                      ? `Sent to ${r.sentTo} for ${show(r.amountMinor!)}`
                      : r.status === "queued"
                        ? "Waiting to be sent"
                        : r.reason === "superseded"
                          ? "Skipped: a later step was due"
                          : `Skipped: ${STOP_LABELS[r.reason as StopReason] ?? r.reason}`}
                    {r.completedAt ? ` · ${date.format(r.completedAt)}` : ""}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {!isDraft ? (
        <p className="quote-download">
          <a href={`/app/invoices/${invoice.id}/pdf`} className="link-button" download>Download PDF</a>
        </p>
      ) : null}
      {invoice.status === "issued" && canEdit ? (
        <SharePanel
          email={emailInvoiceAction.bind(null, invoice.id, organization.name)}
          createLink={createInvoiceLinkAction.bind(null, invoice.id)}
          revoke={revokeInvoiceLinksAction.bind(null, invoice.id)}
          recipientEmail={invoice.recipientEmail}
          activeLinks={activity.links.filter((link) => !link.revokedAt).length}
          stopsWhen="when revoked"
        />
      ) : null}
      {activity.events.length ? (
        <section className="panel contacts-panel" aria-label="Customer activity">
          <div className="panel-heading"><div><h3>Customer activity</h3><p>Views of the invoice&apos;s link.</p></div></div>
          <ul className="contact-list">
            {activity.events.map((event) => (
              <li key={event.id}>
                <div>
                  <strong>Viewed</strong>
                  <small>{time.format(event.createdAt)}{event.ipAddress ? ` · from ${event.ipAddress}` : ""}</small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {invoice.status !== "draft" && tenant.can("payments:read") ? (
        <section className="panel contacts-panel" aria-label="Payments">
          <div className="panel-heading">
            <div>
              <h3>Payments</h3>
              <p>Paid {show(invoice.paidMinor)} · owed {show(outstanding)}. Payments are never deleted; a mistake is voided.</p>
            </div>
          </div>
          {invoice.allocations.length === 0 ? <p className="team-empty">No payments yet.</p> : null}
          <ul className="contact-list">
            {invoice.allocations.map((allocation) => {
              const payment = allocation.payment;
              return (
                <li key={allocation.id}>
                  <div>
                    <strong>
                      {show(allocation.amountMinor)}
                      {payment.voidedAt ? <span className="pill">Void</span> : null}
                    </strong>
                    <small>
                      {payment.source !== "manual" ? `${providerName(payment.source)} · ` : ""}
                      {METHOD_LABELS[payment.method as keyof typeof METHOD_LABELS] ?? payment.method} · received {day.format(payment.receivedOn)}
                      {payment.reference ? ` · ${payment.reference}` : ""}
                    </small>
                    <small>
                      Recorded {date.format(payment.createdAt)}
                      {payment.recordedBy ? ` by ${payment.recordedBy.name}` : payment.source !== "manual" ? `, confirmed by ${providerName(payment.source)}` : ""}
                    </small>
                    {payment.note ? <small>{payment.note}</small> : null}
                    {payment.voidedAt ? <small>Voided: {payment.voidReason}{payment.voidedBy ? ` (${payment.voidedBy.name})` : ""}</small> : null}
                    {payment.refunds.map((refund) => (
                      <small key={refund.id} className={refund.status === "failed" ? "refund-failed" : undefined}>
                        Refund {show(refund.amountMinor)} {REFUND_STATUS[refund.status] ?? refund.status}
                        {refund.method === "provider" ? ` through ${providerName(payment.source)}` : " (recorded)"} · {refund.reason}
                        {refund.requestedBy ? ` · ${refund.requestedBy.name}` : ""}
                        {refund.failureReason ? ` · ${refund.failureReason}` : ""}
                        {refund.status === "pending" && canRefund ? (
                          <> <StepButton action={refreshRefundAction.bind(null, refund.id, invoice.id)} label="Check status" /></>
                        ) : null}
                      </small>
                    ))}
                  </div>
                  {!payment.voidedAt && canRefund && payment.amountMinor - payment.refunds.filter((r) => r.status !== "failed").reduce((sum, r) => sum + r.amountMinor, 0n) > 0n ? (
                    <div className="row-buttons">
                      <RefundForm
                        action={refundPaymentAction.bind(null, payment.id, invoice.id)}
                        currency={payment.currency}
                        refundable={toDecimalString(money(payment.amountMinor - payment.refunds.filter((r) => r.status !== "failed").reduce((sum, r) => sum + r.amountMinor, 0n), payment.currency))}
                        provider={canRefundThroughProvider(payment) ? providerName(payment.source) : null}
                      />
                    </div>
                  ) : null}
                  {!payment.voidedAt && payment.refunds.every((r) => r.status === "failed") && tenant.can("payments:record") ? (
                    <div className="row-buttons">
                      <ReasonForm
                        action={voidPaymentAction.bind(null, payment.id, invoice.id)}
                        open="Void"
                        submit="Void payment"
                        hint="e.g. bounced transfer, recorded twice."
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {online?.unallocated.length ? (
            <div role="alert" className="settings-message error unallocated">
              {online.unallocated.map((u) => (
                <div key={u.paymentId}>
                  <p>
                    {formatMoney(money(u.amountMinor, u.currency), organization.locale)} was received through {providerName(u.source)} beyond
                    what this invoice owed. Refund it to the customer.
                  </p>
                  {canRefund ? (
                    <RefundForm
                      action={refundPaymentAction.bind(null, u.paymentId, invoice.id)}
                      currency={u.currency}
                      refundable={toDecimalString(money(u.amountMinor, u.currency))}
                      provider={PROVIDERS[u.source as keyof typeof PROVIDERS]?.refund ? providerName(u.source) : null}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {online?.attempts.length ? (
            <details className="online-attempts">
              <summary>Online payment attempts ({online.attempts.length})</summary>
              <ul className="contact-list">
                {online.attempts.map((attempt) => (
                  <li key={attempt.id}>
                    <div>
                      <strong>{providerName(attempt.provider)} · {formatMoney(money(attempt.amountMinor, attempt.currency), organization.locale)}</strong>
                      <small>
                        {{ created: "Started", pending: "Waiting for the provider", succeeded: "Paid", failed: "Failed" }[attempt.status] ?? attempt.status}
                        {" · "}{date.format(attempt.createdAt)}
                      </small>
                      {attempt.failureReason ? <small>{attempt.failureReason}</small> : null}
                      {online.events.filter((e) => e.attemptId === attempt.id).map((e) => (
                        <small key={e.id}>Webhook {e.type}: {e.outcome.replace("_", " ")}{e.detail ? ` (${e.detail})` : ""}</small>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {invoice.status === "issued" && outstanding > 0n && tenant.can("payments:record") ? (
            <PaymentForm
              key={invoice.paidMinor.toString()}
              action={recordPaymentAction.bind(null, invoice.id)}
              currency={invoice.currency}
              outstanding={toDecimalString(money(outstanding, invoice.currency))}
              today={today}
              methods={PAYMENT_METHODS.map((value) => ({ value, label: METHOD_LABELS[value] }))}
            />
          ) : null}
        </section>
      ) : null}
    </aside>
  );

  if (isDraft && canEdit) {
    if (invoice.quoteId) {
      const contact = invoice.customer.contacts.find((c) => c.name === invoice.recipientName && c.email === invoice.recipientEmail);
      return (
        <>
          {header}
          <section className="quote-page">
            <div className="record-side">
              <div className="panel settings-panel wide">
                <ConvertedDraftForm
                  action={updateConvertedDraftAction.bind(null, invoice.id)}
                  version={invoice.version}
                  contacts={invoice.customer.contacts.map((c) => ({ id: c.id, label: `${c.name}${c.email ? ` (${c.email})` : ""}` }))}
                  initial={{
                    recipientContactId: contact?.id ?? "",
                    issuedOn: invoice.issuedOn.toISOString().slice(0, 10),
                    dueOn: invoice.dueOn.toISOString().slice(0, 10),
                    notes: invoice.notes ?? "",
                    terms: invoice.terms ?? "",
                  }}
                />
              </div>
              <InvoiceDocument invoice={invoice} seller={organization.name} locale={organization.locale} />
            </div>
            {side}
          </section>
        </>
      );
    }
    const options = await builderOptions(organization.id, {
      taxRates: invoice.items.flatMap((item) =>
        item.taxRateId && item.taxName !== null && item.taxMilliPercent !== null
          ? [{ id: item.taxRateId, name: item.taxName, milliPercent: item.taxMilliPercent }]
          : [],
      ),
    });
    if (!options.customers.some((c) => c.id === invoice.customer.id)) {
      options.customers.push({
        id: invoice.customer.id, name: invoice.customer.displayName, email: invoice.customer.email,
        preferredCurrency: invoice.customer.preferredCurrency, contacts: [],
      });
    }
    const contact = invoice.customer.contacts.find((c) => c.name === invoice.recipientName && c.email === invoice.recipientEmail);
    return (
      <>
        {header}
        <section className="quote-page">
          <div className="panel settings-panel wide">
            <QuoteBuilder
              kind="invoice"
              action={updateDraftAction.bind(null, invoice.id)}
              version={invoice.version}
              options={options}
              locale={organization.locale}
              submitLabel="Save draft"
              initial={{
                customerId: invoice.customerId,
                recipientContactId: contact?.id ?? "",
                leadId: invoice.leadId ?? "",
                currency: invoice.currency,
                taxMode: invoice.taxMode as "exclusive" | "inclusive",
                issuedOn: invoice.issuedOn.toISOString().slice(0, 10),
                endsOn: invoice.dueOn.toISOString().slice(0, 10),
                notes: invoice.notes ?? "",
                terms: invoice.terms ?? "",
                lines: invoice.items.map((item) =>
                  newLine({
                    productId: item.productId ?? "",
                    description: item.description,
                    quantity: formatScaled(item.quantityMilli, 3),
                    unit: item.unit ?? "",
                    unitPrice: toDecimalString(money(item.unitPriceMinor, invoice.currency)),
                    discountKind: item.discountKind as "none" | "percent" | "fixed",
                    discount:
                      item.discountKind === "percent"
                        ? formatScaled(item.discountValue, 3)
                        : item.discountKind === "fixed"
                          ? toDecimalString(money(item.discountValue, invoice.currency))
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
      <p className="record-meta">Due {day.format(invoice.dueOn)}</p>
      <section className="quote-page">
        <InvoiceDocument invoice={invoice} seller={organization.name} locale={organization.locale} />
        {side}
      </section>
    </>
  );
}
