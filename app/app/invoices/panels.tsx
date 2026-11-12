"use client";

import { useActionState, useState, useTransition } from "react";
import type { FormState } from "./actions";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

function Message({ state }: { state: FormState }) {
  if (state.status === "saved") return <p role="status" className="settings-message saved">{state.message}</p>;
  if (state.status === "error") {
    const fields = Object.entries(state.fields ?? {});
    return (
      <div role="alert" className="settings-message error">
        {state.message}
        {fields.length ? <ul>{fields.map(([field, message]) => <li key={field}>{`${LABELS[field] ?? field} ${message}`}</li>)}</ul> : null}
      </div>
    );
  }
  return null;
}

const LABELS: Record<string, string> = {
  amount: "Amount", receivedOn: "Date received", method: "Method", reason: "Reason", lines: "Lines", customerId: "Customer",
  reference: "Reference", note: "Note",
};

/** One-click steps (issue, delete draft, resolve dispute), each checked again on the server. */
export function StepButton({ action, label, confirm, primary }: { action: () => Promise<FormState>; label: string; confirm?: string; primary?: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>({ status: "idle" });
  return (
    <>
      <Message state={state} />
      <button
        type="button"
        className={primary ? "new-button" : "icon-button text-button"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (confirm && !window.confirm(confirm)) return;
            setState(await action());
          })
        }
      >
        {label}
      </button>
    </>
  );
}

/** A step that needs a reason (void, dispute), opened on demand. */
export function ReasonForm({ action, open, submit, hint }: { action: Action; open: string; submit: string; hint: string }) {
  const [shown, setShown] = useState(false);
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  if (!shown) {
    return <button type="button" className="link-button danger" onClick={() => setShown(true)}>{open}</button>;
  }
  return (
    <form action={formAction} className="contact-form" aria-label={open}>
      <Message state={state} />
      <fieldset disabled={pending}>
        <label className="settings-field">
          <span>Reason</span>
          <textarea name="reason" rows={2} required minLength={3} maxLength={500} />
          <small>{hint}</small>
        </label>
        <div className="row-buttons">
          <button type="submit" className="new-button">{pending ? "Saving…" : submit}</button>
          <button type="button" className="link-button" onClick={() => setShown(false)}>Cancel</button>
        </div>
      </fieldset>
    </form>
  );
}

/** Records money received against the invoice, in its currency (D32). */
export function PaymentForm({
  action,
  currency,
  outstanding,
  today,
  methods,
}: {
  action: Action;
  currency: string;
  outstanding: string;
  today: string;
  methods: { value: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const [values, setValues] = useState({ amount: outstanding, method: "bank_transfer", receivedOn: today, reference: "", note: "" });
  const bind = (name: keyof typeof values) => ({
    name,
    value: values[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [name]: e.target.value })),
  });
  return (
    <form action={formAction} className="contact-form" aria-label="Record a payment">
      <Message state={state} />
      <fieldset disabled={pending}>
        <label className="settings-field">
          <span>Amount ({currency})</span>
          <input {...bind("amount")} inputMode="decimal" required maxLength={30} />
          <small>Owed: {outstanding} {currency}</small>
        </label>
        <label className="settings-field">
          <span>Date received</span>
          <input {...bind("receivedOn")} type="date" max={today} required />
        </label>
        <label className="settings-field">
          <span>Method</span>
          <select {...bind("method")}>{methods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
        </label>
        <label className="settings-field">
          <span>Reference</span>
          <input {...bind("reference")} maxLength={200} placeholder="e.g. transfer reference" />
        </label>
        <label className="settings-field">
          <span>Note</span>
          <input {...bind("note")} maxLength={1000} />
        </label>
        <div className="row-buttons">
          <button type="submit" className="new-button">{pending ? "Saving…" : "Record payment"}</button>
        </div>
      </fieldset>
    </form>
  );
}
