"use client";

import { useActionState, useState, useTransition } from "react";
import { type FormState, saveTaxRateAction, setTaxRateArchivedAction } from "../catalogue/actions";

export interface TaxRateRow {
  id: string;
  name: string;
  rate: string;
  archived: boolean;
}

function TaxRateForm({ rate, onDone }: { rate?: TaxRateRow; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(
    async (previous: FormState, form: FormData) => {
      const result = await saveTaxRateAction(rate?.id ?? null, previous, form);
      if (result.status === "saved") onDone();
      return result;
    },
    { status: "idle" },
  );
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  // Controlled, so a failed save keeps what was typed (React resets uncontrolled forms).
  const [name, setName] = useState(rate?.name ?? "");
  const [percent, setPercent] = useState(rate?.rate ?? "");
  return (
    <form action={formAction} className="contact-form tax-rate-form" aria-label={rate ? `Edit ${rate.name}` : "Add a tax rate"}>
      {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
      <fieldset disabled={pending}>
        <label className="settings-field">
          <span>Name</span>
          <input name="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VAT" />
          {errors.name ? <em role="alert">{`Name ${errors.name}`}</em> : null}
        </label>
        <label className="settings-field">
          <span>Rate (%)</span>
          <input
            name="rate"
            required
            inputMode="decimal"
            maxLength={10}
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            placeholder="7.5"
          />
          {errors.rate ? <em role="alert">{`Rate ${errors.rate}`}</em> : null}
        </label>
        <div className="row-buttons">
          <button type="submit" className="new-button">{pending ? "Saving…" : rate ? "Save rate" : "Add rate"}</button>
          <button type="button" className="link-button" onClick={onDone}>Cancel</button>
        </div>
      </fieldset>
    </form>
  );
}

/**
 * The workspace's tax rates (decision D14). Quotes and invoices copy a rate's
 * name and percentage onto each line, so editing or archiving one here never
 * changes an existing document.
 */
export function TaxRates({ rates, canEdit }: { rates: TaxRateRow[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  return (
    <section className="panel contacts-panel tax-rates" aria-label="Tax rates">
      <div className="panel-heading">
        <div>
          <h3>Tax rates</h3>
          <p>
            Rates you charge, chosen per line on quotes and invoices. MomentumDesk does not decide which tax applies to a
            sale; check with your tax adviser.
          </p>
        </div>
        {canEdit && editing === null ? <button type="button" onClick={() => setEditing("new")}>＋ Add</button> : null}
      </div>
      {message ? <p role="status" className="settings-message saved contacts-message">{message}</p> : null}
      {editing === "new" ? <TaxRateForm onDone={() => setEditing(null)} /> : null}
      {rates.length === 0 && editing !== "new" ? <p className="team-empty">No tax rates yet.</p> : null}
      <ul className="contact-list">
        {rates.map((rate) =>
          editing === rate.id ? (
            <li key={rate.id}><TaxRateForm rate={rate} onDone={() => setEditing(null)} /></li>
          ) : (
            <li key={rate.id}>
              <div>
                <strong>
                  {rate.name} — {rate.rate}%{rate.archived ? <span className="pill">Archived</span> : null}
                </strong>
              </div>
              {canEdit && editing === null ? (
                <div className="row-buttons">
                  {rate.archived ? null : <button type="button" className="link-button" onClick={() => setEditing(rate.id)}>Edit</button>}
                  <button
                    type="button"
                    className={rate.archived ? "link-button" : "link-button danger"}
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const result = await setTaxRateArchivedAction(rate.id, !rate.archived);
                        setMessage(result.status === "saved" ? result.message : result.status === "error" ? result.message : "");
                      })
                    }
                  >
                    {rate.archived ? "Restore" : "Archive"}
                  </button>
                </div>
              ) : null}
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
