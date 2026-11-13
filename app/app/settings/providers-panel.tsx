"use client";

import { useActionState, useState, useTransition } from "react";
import type { ProviderFormState } from "./provider-actions";

export interface ProviderInfo {
  key: string;
  name: string;
  currencies: string[];
  needsWebhookSecret: boolean;
  note: string;
}

export interface ConnectionRow {
  id: string;
  provider: string;
  name: string;
  mode: string;
  keyHint: string;
  currencies: string[];
  webhookUrl: string;
}

/**
 * The workspace's own payment provider accounts (decisions D19, D35). Keys
 * are sent once, encrypted on the server and never shown again.
 */
export function ProvidersPanel({
  providers,
  connections,
  canManage,
  configured,
  connect,
  disconnect,
}: {
  providers: ProviderInfo[];
  connections: ConnectionRow[];
  canManage: boolean;
  configured: boolean;
  connect: (state: ProviderFormState, form: FormData) => Promise<ProviderFormState>;
  disconnect: (id: string) => Promise<ProviderFormState>;
}) {
  const available = providers.filter((p) => !connections.some((c) => c.provider === p.key));
  const [state, formAction, pending] = useActionState(connect, { status: "idle" });
  const [choice, setChoice] = useState(available[0]?.key ?? "");
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<ProviderFormState>({ status: "idle" });
  const provider = providers.find((p) => p.key === choice);
  const errors = state.status === "error" ? (state.fields ?? {}) : {};

  return (
    <section className="panel settings-panel tax-rates" aria-label="Payment providers">
      <h3>Payment providers</h3>
      <p className="form-hint">
        Customers pay invoices online through your own provider account; the money goes to you, never through MomentumDesk.
        An invoice is marked paid only when the provider confirms it.
      </p>
      {!configured ? (
        <p role="note" className="settings-message error">Online payments are not set up on this server yet (PROVIDER_SECRETS_KEY is missing).</p>
      ) : null}
      {message.status !== "idle" ? (
        <p role={message.status === "error" ? "alert" : "status"} className={`settings-message ${message.status === "error" ? "error" : "saved"}`}>{message.message}</p>
      ) : null}
      {connections.length ? (
        <ul className="contact-list">
          {connections.map((c) => (
            <li key={c.id}>
              <div>
                <strong>{c.name}<span className="pill">{c.mode === "live" ? "Live" : c.mode === "test" ? "Test" : c.mode}</span></strong>
                <small>Key {c.keyHint} · {c.currencies.join(", ")}</small>
                <small>Webhook URL: <code>{c.webhookUrl}</code></small>
              </div>
              {canManage ? (
                <div className="row-buttons">
                  <button
                    type="button"
                    className="link-button danger"
                    disabled={busy}
                    onClick={() =>
                      start(async () => {
                        if (!window.confirm(`Disconnect ${c.name}? Customers can no longer pay through it.`)) return;
                        setMessage(await disconnect(c.id));
                      })
                    }
                  >
                    Disconnect
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="team-empty">No provider connected.</p>
      )}
      {canManage && available.length ? (
        <form action={formAction} className="settings-form" aria-label="Connect a provider">
          {state.status === "saved" ? <p role="status" className="settings-message saved">{state.message}</p> : null}
          {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
          <fieldset disabled={pending || !configured}>
            <label className="settings-field">
              <span>Provider</span>
              <select name="provider" value={choice} onChange={(e) => setChoice(e.target.value)}>
                {available.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
              {provider ? <small>{provider.note}</small> : null}
            </label>
            <label className="settings-field">
              <span>Secret key</span>
              <input name="secretKey" type="password" autoComplete="off" required maxLength={300} />
              {errors.secretKey ? <em role="alert">{`Secret key ${errors.secretKey}`}</em> : <small>From the provider&apos;s dashboard. Stored encrypted; never shown again.</small>}
            </label>
            {provider?.needsWebhookSecret ? (
              <label className="settings-field">
                <span>Webhook signing secret</span>
                <input name="webhookSecret" type="password" autoComplete="off" maxLength={300} />
                {errors.webhookSecret ? <em role="alert">{`Webhook signing secret ${errors.webhookSecret}`}</em> : <small>Shown when you add the webhook URL in the provider&apos;s dashboard.</small>}
              </label>
            ) : null}
            <fieldset className="currency-choices">
              <legend>Currencies to take</legend>
              {provider?.currencies.map((currency) => (
                <label key={currency} className="check"><input type="checkbox" name="currencies" value={currency} /> {currency}</label>
              ))}
              {errors.currencies ? <em role="alert" className="inline-error">{`Currencies: ${errors.currencies}`}</em> : null}
            </fieldset>
            <div className="row-buttons"><button type="submit" className="new-button">{pending ? "Connecting…" : `Connect ${provider?.name ?? ""}`}</button></div>
          </fieldset>
        </form>
      ) : null}
    </section>
  );
}
