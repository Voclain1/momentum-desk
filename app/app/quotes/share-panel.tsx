"use client";

import { useState, useTransition } from "react";
import type { ShareState } from "./actions";

type Run = () => Promise<ShareState>;

/** Getting a sent quote to the customer: email it, or create a link to send yourself (decision D16). */
export function SharePanel({
  email,
  createLink,
  revoke,
  recipientEmail,
  activeLinks,
}: {
  email?: Run;
  createLink: Run;
  revoke: Run;
  recipientEmail: string | null;
  activeLinks: number;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ShareState>({ status: "idle" });
  const run = (action: Run, confirm?: string) =>
    start(async () => {
      if (confirm && !window.confirm(confirm)) return;
      setState(await action());
    });
  return (
    <section className="panel contacts-panel" aria-label="Share with the customer">
      <div className="panel-heading">
        <div>
          <h3>Share with the customer</h3>
          <p>
            {activeLinks ? `${activeLinks} active ${activeLinks === 1 ? "link" : "links"}.` : "No active links."} Anyone with a link can
            view the quote; links stop working when revoked or when a newer revision is sent.
          </p>
        </div>
      </div>
      <div className="quote-actions">
        {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
        {state.status === "saved" ? <p role="status" className="settings-message saved">{state.message}</p> : null}
        {state.status === "link" ? (
          <div className="share-link">
            <p role="status" className="settings-message saved">{state.message}</p>
            <input readOnly aria-label="Quote link" value={state.url} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="link-button" onClick={() => navigator.clipboard?.writeText(state.url)}>Copy</button>
          </div>
        ) : null}
        {email && recipientEmail ? (
          <button type="button" className="new-button" disabled={pending} onClick={() => run(email)}>Email to {recipientEmail}</button>
        ) : null}
        <button type="button" className="icon-button text-button" disabled={pending} onClick={() => run(createLink)}>Create link</button>
        {activeLinks ? (
          <button type="button" className="link-button danger" disabled={pending} onClick={() => run(revoke, "Stop every link to this quote from working?")}>
            Revoke links
          </button>
        ) : null}
      </div>
    </section>
  );
}
