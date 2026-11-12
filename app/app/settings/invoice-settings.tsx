"use client";

import { useActionState, useState } from "react";
import type { FormState } from "../invoices/actions";

/** Payment instructions printed on invoices, and the default days until due. */
export function InvoiceSettingsPanel({
  initial,
  canEdit,
  action,
}: {
  initial: { paymentInstructions: string; defaultDueDays: number };
  canEdit: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, { status: "idle" });
  const [values, setValues] = useState({ paymentInstructions: initial.paymentInstructions, defaultDueDays: String(initial.defaultDueDays) });
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  return (
    <section className="panel settings-panel tax-rates" aria-label="Invoice settings">
      <h3>Invoices</h3>
      <form action={formAction} className="settings-form">
        {state.status === "saved" ? <p role="status" className="settings-message saved">{state.message}</p> : null}
        {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
        <fieldset disabled={!canEdit || pending}>
          <label className="settings-field">
            <span>How to pay</span>
            <textarea
              name="paymentInstructions"
              rows={4}
              maxLength={2000}
              value={values.paymentInstructions}
              onChange={(e) => setValues((v) => ({ ...v, paymentInstructions: e.target.value }))}
              placeholder="e.g. Bank, account name, account number, sort code / IBAN"
            />
            {errors.paymentInstructions ? <em role="alert">{`How to pay ${errors.paymentInstructions}`}</em> : <small>Copied onto each invoice when it is issued.</small>}
          </label>
          <label className="settings-field">
            <span>Days until due</span>
            <input
              name="defaultDueDays"
              inputMode="numeric"
              value={values.defaultDueDays}
              onChange={(e) => setValues((v) => ({ ...v, defaultDueDays: e.target.value }))}
            />
            {errors.defaultDueDays ? <em role="alert">{`Days until due ${errors.defaultDueDays}`}</em> : <small>Default for new invoices.</small>}
          </label>
          {canEdit ? <div className="row-buttons"><button type="submit" className="new-button">{pending ? "Saving…" : "Save invoice settings"}</button></div> : null}
        </fieldset>
      </form>
    </section>
  );
}
