"use client";

import { useActionState } from "react";
import type { PayState } from "./actions";

export interface PayChoice {
  connectionId: string;
  name: string;
  needsEmail: boolean;
  action: (state: PayState, form: FormData) => Promise<PayState>;
}

function PayButton({ choice, amount }: { choice: PayChoice; amount: string }) {
  const [state, formAction, pending] = useActionState(choice.action, { status: "idle" });
  return (
    <form action={formAction} className="settings-form pay-form" aria-label={`Pay with ${choice.name}`}>
      {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
      <fieldset disabled={pending}>
        {choice.needsEmail ? (
          <label className="settings-field">
            <span>Your email</span>
            <input name="email" type="email" required maxLength={254} autoComplete="email" />
            <small>{choice.name} sends your receipt here.</small>
          </label>
        ) : null}
        <button type="submit" className="new-button">{pending ? "Opening checkout…" : `Pay ${amount} with ${choice.name}`}</button>
      </fieldset>
    </form>
  );
}

/** Online payment through the business's own provider account (decision D19). */
export function PayPanel({ choices, amount }: { choices: PayChoice[]; amount: string }) {
  return (
    <section className="panel public-respond" aria-label="Pay online">
      <h3>Pay online</h3>
      {choices.map((choice) => <PayButton key={choice.connectionId} choice={choice} amount={amount} />)}
      <p className="form-hint">You will be taken to the provider&apos;s secure checkout. The invoice is marked paid once the provider confirms the payment.</p>
    </section>
  );
}
