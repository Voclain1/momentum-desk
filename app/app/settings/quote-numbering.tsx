"use client";

import { useActionState, useState } from "react";
import { type FormState, updateNumberingAction } from "../quotes/actions";

/** Quote number format (spec §7.5 "organization-configurable numbering"). */
export function QuoteNumbering({ initial, canEdit }: { initial: { prefix: string; nextNumber: number; padding: number }; canEdit: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateNumberingAction, { status: "idle" });
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
    <section className="panel settings-panel tax-rates" aria-label="Quote numbering">
      <h3>Quote numbering</h3>
      <form action={formAction} className="settings-form">
        {state.status === "saved" ? <p role="status" className="settings-message saved">{state.message}</p> : null}
        {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
        <fieldset disabled={!canEdit || pending}>
          <div className="form-grid">
            {input("prefix", "Prefix", { maxLength: 12 })}
            {input("nextNumber", "Next number", { inputMode: "numeric", required: true })}
            {input("padding", "Digits", { inputMode: "numeric", required: true })}
          </div>
          <p className="form-hint">Next quote: <strong>{example}</strong>. Numbers already used are skipped.</p>
          {canEdit ? <div className="row-buttons"><button type="submit" className="new-button">{pending ? "Saving…" : "Save numbering"}</button></div> : null}
        </fieldset>
      </form>
    </section>
  );
}
