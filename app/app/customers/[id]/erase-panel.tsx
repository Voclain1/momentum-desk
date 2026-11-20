"use client";

import { useActionState } from "react";
import type { FormState } from "../actions";

/** Erasing a customer on request (D25): typed confirmation, then it cannot be undone. */
export function ErasePanel({ name, action }: { name: string; action: (state: FormState, form: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  return (
    <section className="panel contacts-panel" aria-label="Erase personal data">
      <div className="panel-heading">
        <div>
          <h3>Erase personal data</h3>
          <p>
            When this customer asks to be forgotten. Removes their details, contacts, notes, tasks, draft documents and the
            addresses of their visits to document links. Issued quotes and invoices, payments and acceptance records stay exactly as
            they were sent: they are financial records you may have to keep. This cannot be undone.
          </p>
        </div>
      </div>
      <form action={formAction} className="contact-form" aria-label="Erase this customer">
        {state.status === "error" ? (
          <p role="alert" className="settings-message error">{state.fields?.confirmation ? `The name ${state.fields.confirmation}.` : state.message}</p>
        ) : null}
        <fieldset disabled={pending}>
          <label className="settings-field">
            <span>Type the customer&apos;s name to confirm: {name}</span>
            <input name="confirmation" autoComplete="off" required />
          </label>
          <div className="row-buttons"><button type="submit" className="new-button danger-button">{pending ? "Erasing…" : "Erase personal data"}</button></div>
        </fieldset>
      </form>
    </section>
  );
}
