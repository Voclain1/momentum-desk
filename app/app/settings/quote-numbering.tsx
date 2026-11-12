"use client";

import { useActionState, useState } from "react";
import type { FormState } from "../quotes/actions";

/** A document number format (quotes §7.5, invoices §7.6, decision D30). */
export function QuoteNumbering({
  initial,
  canEdit,
  action,
  noun = "quote",
}: {
  initial: { prefix: string; nextNumber: number; padding: number };
  canEdit: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  noun?: "quote" | "invoice";
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, { status: "idle" });
  const [values, setValues] = useState({ prefix: initial.prefix, nextNumber: String(initial.nextNumber), padding: String(initial.padding) });
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  const example = `${values.prefix}${(values.nextNumber || "1").padStart(Number(values.padding) || 1, "0")}`;
  const input = (name: keyof typeof values, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className="settings-field">
      <span>{label}</span>
      <input name={name} value={values[name]} onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))} {...props} />
      {errors[name] ? <em role="alert">{`${label} ${errors[name]}`}</em> : null}
    </label>
  );
  return (
    <section className="panel settings-panel tax-rates" aria-label={`${noun === "quote" ? "Quote" : "Invoice"} numbering`}>
      <h3>{noun === "quote" ? "Quote" : "Invoice"} numbering</h3>
      <form action={formAction} className="settings-form">
        {state.status === "saved" ? <p role="status" className="settings-message saved">{state.message}</p> : null}
        {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
        <fieldset disabled={!canEdit || pending}>
          <div className="form-grid">
            {input("prefix", "Prefix", { maxLength: 12 })}
            {input("nextNumber", "Next number", { inputMode: "numeric", required: true })}
            {input("padding", "Digits", { inputMode: "numeric", required: true })}
          </div>
          <p className="form-hint">
            Next {noun}: <strong>{example}</strong>. Numbers already used are skipped.
            {noun === "invoice" ? " Invoices are numbered when issued, in order; voided invoices keep their number." : ""}
          </p>
          {canEdit ? <div className="row-buttons"><button type="submit" className="new-button">{pending ? "Saving…" : `Save ${noun} numbering`}</button></div> : null}
        </fieldset>
      </form>
    </section>
  );
}
