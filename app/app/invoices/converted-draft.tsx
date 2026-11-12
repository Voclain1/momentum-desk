"use client";

import { useActionState, useState } from "react";
import type { FormState } from "./actions";

/** A draft from an accepted quote: the lines and amounts are fixed (D33); these can change. */
export function ConvertedDraftForm({
  action,
  version,
  initial,
  contacts,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  version: number;
  initial: { recipientContactId: string; issuedOn: string; dueOn: string; notes: string; terms: string };
  contacts: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const [values, setValues] = useState(initial);
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  const bind = (name: keyof typeof values) => ({
    name,
    value: values[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [name]: e.target.value })),
  });
  const field = (name: keyof typeof values, label: string, input: React.ReactNode) => (
    <label className="settings-field">
      <span>{label}</span>
      {input}
      {errors[name] ? <em role="alert">{`${label} ${errors[name]}`}</em> : null}
    </label>
  );
  return (
    <form action={formAction} className="settings-form" aria-label="Invoice details">
      <input type="hidden" name="version" value={version} />
      {state.status === "saved" ? <p role="status" className="settings-message saved">{state.message}</p> : null}
      {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
      <fieldset disabled={pending}>
        <div className="form-grid">
          {field("recipientContactId", "Send to", (
            <select {...bind("recipientContactId")}>
              <option value="">The customer</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          ))}
          {field("issuedOn", "Issue date", <input type="date" {...bind("issuedOn")} required />)}
          {field("dueOn", "Due date", <input type="date" {...bind("dueOn")} required />)}
        </div>
        <div className="form-grid">
          {field("notes", "Notes", <textarea rows={3} maxLength={5000} {...bind("notes")} />)}
          {field("terms", "Terms", <textarea rows={3} maxLength={5000} {...bind("terms")} />)}
        </div>
        <div className="row-buttons"><button type="submit" className="new-button">{pending ? "Saving…" : "Save draft"}</button></div>
      </fieldset>
    </form>
  );
}
