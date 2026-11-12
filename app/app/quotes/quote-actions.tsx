"use client";

import { useState, useTransition } from "react";
import type { FormState } from "./actions";

type Run = () => Promise<FormState>;

/** The next steps for a quote, each checked again on the server. */
export function QuoteActions({
  send,
  revise,
  duplicate,
  remove,
}: {
  send?: Run;
  revise?: Run;
  duplicate?: Run;
  remove?: Run;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FormState>({ status: "idle" });
  const run = (action: Run, confirm?: string) =>
    start(async () => {
      if (confirm && !window.confirm(confirm)) return;
      setResult(await action());
    });
  const fields = result.status === "error" && result.fields ? Object.entries(result.fields) : [];
  return (
    <div className="quote-actions">
      {result.status === "error" ? (
        <div role="alert" className="settings-message error">
          {result.message}
          {fields.length ? <ul>{fields.map(([field, message]) => <li key={field}>{`${field === "expiresOn" ? "Valid until" : field} ${message}`}</li>)}</ul> : null}
        </div>
      ) : null}
      {result.status === "saved" ? <p role="status" className="settings-message saved">{result.message}</p> : null}
      {send ? (
        <button
          type="button"
          className="new-button"
          disabled={pending}
          onClick={() => run(send, "Mark this quote as sent? Its content is then fixed; changes need a new revision.")}
        >
          Mark as sent
        </button>
      ) : null}
      {revise ? <button type="button" className="icon-button text-button" disabled={pending} onClick={() => run(revise)}>Revise</button> : null}
      {duplicate ? <button type="button" className="icon-button text-button" disabled={pending} onClick={() => run(duplicate)}>Duplicate</button> : null}
      {remove ? (
        <button type="button" className="link-button danger" disabled={pending} onClick={() => run(remove, "Delete this draft? This cannot be undone.")}>
          Delete draft
        </button>
      ) : null}
    </div>
  );
}
