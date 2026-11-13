"use client";

import { SmallForm } from "../invoices/collection-panel";
import { StepButton } from "../invoices/panels";
import { addRateAction, retryJobAction, updateReminderSettingsAction } from "../receivables/actions";

const TONES: Record<string, string> = { friendly: "Friendly", firm: "Firm", final: "Final" };
const when = (offset: number) => (offset < 0 ? `${-offset} days before due` : offset === 0 ? "On the due date" : `${offset} days after due`);

/** Payment reminders (spec §7.8): off until an owner turns them on. */
export function RemindersPanel({
  canEdit,
  enabled,
  minGapDays,
  steps,
}: {
  canEdit: boolean;
  enabled: boolean;
  minGapDays: number;
  steps: { offsetDays: number; tone: string }[];
}) {
  return (
    <section className="panel contacts-panel" aria-label="Payment reminders">
      <div className="panel-heading">
        <div>
          <h3>Payment reminders</h3>
          <p>
            {enabled ? "On." : "Off."} Reminders go to the customer&apos;s email and state what is owed on the day. They stop when an
            invoice is paid, voided, disputed, paused, escalated, covered by a promise, or the customer opts out. Only the latest due
            step is sent; earlier ones are never sent late.
          </p>
        </div>
      </div>
      <ul className="contact-list">
        {steps.map((s) => (
          <li key={s.offsetDays}><div><strong>{when(s.offsetDays)}</strong><small>{TONES[s.tone] ?? s.tone} reminder</small></div></li>
        ))}
      </ul>
      {canEdit ? (
        <SmallForm action={updateReminderSettingsAction} label="Reminder settings" submit="Save reminders">
          <label className="settings-field checkbox-field">
            <input type="checkbox" name="enabled" defaultChecked={enabled} /> <span>Send payment reminders</span>
          </label>
          <label className="settings-field">
            <span>Minimum days between reminders to one invoice</span>
            <input name="minGapDays" inputMode="numeric" defaultValue={minGapDays} required maxLength={2} />
          </label>
        </SmallForm>
      ) : null}
    </section>
  );
}

export interface RateRow {
  id: string;
  quote: string;
  rate: string;
  effectiveOn: string;
  source: string;
  enteredBy: string | null;
}

/** Exchange rates into the base currency (decision D38): provider rates, staff rates win. */
export function RatesPanel({ canEdit, base, rates, providerConfigured, today }: { canEdit: boolean; base: string; rates: RateRow[]; providerConfigured: boolean; today: string }) {
  return (
    <section className="panel contacts-panel" aria-label="Exchange rates">
      <div className="panel-heading">
        <div>
          <h3>Exchange rates</h3>
          <p>
            Units of {base} for one unit of each currency, used to total receivables in {base}.{" "}
            {providerConfigured ? "Rates are fetched daily; a rate you enter wins on its day." : "No rate provider is configured, so enter rates here."}{" "}
            Rates older than 7 days are marked stale.
          </p>
        </div>
      </div>
      {canEdit ? (
        <SmallForm action={addRateAction} label="Add an exchange rate" submit="Add rate">
          <label className="settings-field"><span>Currency</span><input name="quote" required maxLength={3} placeholder="USD" /></label>
          <label className="settings-field"><span>{base} per unit</span><input name="rate" required inputMode="decimal" maxLength={30} /></label>
          <label className="settings-field"><span>Effective on</span><input name="effectiveOn" type="date" required defaultValue={today} max={today} /></label>
        </SmallForm>
      ) : null}
      <ul className="contact-list">
        {rates.length === 0 ? <li><div><small>No rates yet.</small></div></li> : null}
        {rates.map((r) => (
          <li key={r.id}>
            <div>
              <strong>1 {r.quote} = {r.rate} {base}</strong>
              <small>{r.effectiveOn} · {r.source === "manual" ? `entered by ${r.enteredBy ?? "a former member"}` : r.source}</small>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Background work that failed every attempt; an owner or admin can send it round again. */
export function FailedJobsPanel({ jobs }: { jobs: { id: string; kind: string; key: string; lastError: string | null; finishedAt: string | null }[] }) {
  if (jobs.length === 0) return null;
  return (
    <section className="panel contacts-panel" aria-label="Failed background work">
      <div className="panel-heading"><div><h3>Failed background work</h3><p>These gave up after every retry.</p></div></div>
      <ul className="contact-list">
        {jobs.map((j) => (
          <li key={j.id}>
            <div><strong>{j.kind} ({j.key})</strong><small>{j.lastError ?? "No error recorded"}{j.finishedAt ? ` · ${j.finishedAt}` : ""}</small></div>
            <div className="row-buttons"><StepButton action={retryJobAction.bind(null, j.id)} label="Retry" /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}
