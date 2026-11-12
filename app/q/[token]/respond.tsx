"use client";

import { useActionState, useState } from "react";
import type { PublicState } from "./actions";

type Action = (state: PublicState, form: FormData) => Promise<PublicState>;

function Message({ state }: { state: PublicState }) {
  if (state.status !== "done") return null;
  return state.ok ? (
    <p role="status" className="settings-message saved">{state.message}</p>
  ) : (
    <p role="alert" className="settings-message error">{state.message}</p>
  );
}

/**
 * Accept (with an emailed code, decision D15) or decline. Accepting here is
 * a record of the customer's agreement to this version of the quote; it is
 * not an electronic signature (spec §7.5).
 */
export function Respond({
  requestCode,
  confirmCode,
  reject,
  recipientEmail,
  pendingCode,
}: {
  requestCode: Action;
  confirmCode: Action;
  reject: Action;
  recipientEmail: string | null;
  pendingCode: { sentTo: string } | null;
}) {
  const [requested, requestAction, requesting] = useActionState(requestCode, { status: "idle" });
  const [confirmed, confirmAction, confirming] = useActionState(confirmCode, { status: "idle" });
  const [rejected, rejectFormAction, rejecting] = useActionState(reject, { status: "idle" });
  const [mode, setMode] = useState<"accept" | "decline">("accept");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const codeSent = pendingCode !== null || (requested.status === "done" && requested.ok);

  return (
    <section className="panel public-respond" aria-label="Your answer">
      <div className="row-buttons" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "accept"} className={mode === "accept" ? "new-button" : "link-button"} onClick={() => setMode("accept")}>
          Accept
        </button>
        <button type="button" role="tab" aria-selected={mode === "decline"} className={mode === "decline" ? "new-button" : "link-button"} onClick={() => setMode("decline")}>
          Decline
        </button>
      </div>

      {mode === "accept" ? (
        <>
          <form action={requestAction} className="settings-form" aria-label="Request a code">
            <Message state={requested} />
            <fieldset disabled={requesting}>
              <label className="settings-field">
                <span>Your full name</span>
                <input name="name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </label>
              {recipientEmail ? (
                <p className="form-hint">We will email a code to {recipientEmail} to confirm it is you.</p>
              ) : (
                <label className="settings-field">
                  <span>Your email</span>
                  <input name="email" type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                </label>
              )}
              <button type="submit" className={codeSent ? "link-button" : "new-button"}>{requesting ? "Sending…" : codeSent ? "Send a new code" : "Email me a code"}</button>
            </fieldset>
          </form>
          {codeSent ? (
            <form action={confirmAction} className="settings-form" aria-label="Confirm acceptance">
              <Message state={confirmed} />
              <fieldset disabled={confirming}>
                <label className="settings-field">
                  <span>6-digit code{pendingCode ? ` (sent to ${pendingCode.sentTo})` : ""}</span>
                  <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required />
                </label>
                <p className="form-hint">
                  By confirming, you accept this quote as shown above. This records your agreement; it is not an electronic signature.
                </p>
                <button type="submit" className="new-button">{confirming ? "Confirming…" : "Confirm acceptance"}</button>
              </fieldset>
            </form>
          ) : null}
        </>
      ) : (
        <form action={rejectFormAction} className="settings-form" aria-label="Decline the quote">
          <Message state={rejected} />
          <fieldset disabled={rejecting}>
            <label className="settings-field">
              <span>Your name (optional)</span>
              <input name="name" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
            <label className="settings-field">
              <span>Reason (optional)</span>
              <textarea name="reason" rows={3} maxLength={1000} />
            </label>
            <button type="submit" className="new-button">{rejecting ? "Sending…" : "Decline quote"}</button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
