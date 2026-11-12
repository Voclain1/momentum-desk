"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "../actions";

export interface CustomerChoice {
  id: string;
  label: string;
  reasons: string;
}

/**
 * Lead → customer (spec §7.2): a new customer, or one of the existing
 * customers this lead resembles (decision D28: linking instead of creating
 * a duplicate). Once converted, it links to the customer.
 */
export function ConversionPanel({
  action,
  converted,
  candidates,
  canConvert,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  converted: { id: string; displayName: string; on: string } | null;
  candidates: CustomerChoice[];
  canConvert: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  return (
    <aside className="panel contacts-panel" aria-label="Customer">
      <div className="panel-heading">
        <div>
          <h3>Customer</h3>
          <p>{converted ? "This lead is linked to a customer. Its history stays here." : "Convert the lead once the deal is real."}</p>
        </div>
      </div>
      {converted ? (
        <p className="conversion-done">
          Converted to <Link href={`/app/customers/${converted.id}`}>{converted.displayName}</Link> on {converted.on}.
        </p>
      ) : canConvert ? (
        <form action={formAction} className="contact-form" aria-label="Convert to customer">
          {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
          <fieldset disabled={pending}>
            <legend className="sr-only">Customer to convert into</legend>
            <label className="check">
              <input type="radio" name="target" value="new" defaultChecked /> Create a new customer
            </label>
            {candidates.map((candidate) => (
              <label key={candidate.id} className="check">
                <input type="radio" name="target" value={candidate.id} /> Link to {candidate.label}
                <small> — {candidate.reasons}</small>
              </label>
            ))}
            <div className="row-buttons">
              <button type="submit" className="new-button">{pending ? "Converting…" : "Convert to customer"}</button>
            </div>
          </fieldset>
        </form>
      ) : (
        <p className="team-empty">Not converted yet.</p>
      )}
    </aside>
  );
}
