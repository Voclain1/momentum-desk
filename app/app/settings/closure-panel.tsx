"use client";

import { useActionState } from "react";
import type { ClosureState } from "./closure-actions";

/** Settings → Close workspace (owners). Typed confirmation; 30 days to cancel. */
export function ClosurePanel({
  name,
  deleteAfter,
  request,
  cancel,
}: {
  name: string;
  deleteAfter: string | null;
  request: (state: ClosureState, form: FormData) => Promise<ClosureState>;
  cancel: () => Promise<ClosureState>;
}) {
  const [requestState, requestAction, requesting] = useActionState(request, { status: "idle" });
  const [cancelState, cancelAction, cancelling] = useActionState(cancel, { status: "idle" });
  const state = cancelState.status !== "idle" ? cancelState : requestState;
  return (
    <section className="panel contacts-panel" aria-label="Close workspace">
      <div className="panel-heading">
        <div>
          <h3>Close workspace</h3>
          <p>
            Deletes this workspace and all its data, for every member, 30 days after you ask. Until then everything works and any
            owner can cancel. Download everything first. Backups expire on their own schedule.
          </p>
        </div>
      </div>
      <div className="collection-panel">
        {state.status === "saved" ? <p role="status" className="settings-message saved">{state.message}</p> : null}
        {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
        {deleteAfter ? (
          <form action={cancelAction} aria-label="Cancel closing">
            <p className="form-hint">Deletion is scheduled for {deleteAfter}.</p>
            <button type="submit" className="new-button" disabled={cancelling}>Cancel closing</button>
          </form>
        ) : (
          <form action={requestAction} className="contact-form" aria-label="Close this workspace">
            <fieldset disabled={requesting}>
              <label className="settings-field">
                <span>Type the workspace&apos;s name to confirm: {name}</span>
                <input name="confirmation" autoComplete="off" required />
              </label>
              <div className="row-buttons"><button type="submit" className="new-button danger-button">Close workspace</button></div>
            </fieldset>
          </form>
        )}
      </div>
    </section>
  );
}
