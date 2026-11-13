"use client";

import { useActionState, useState } from "react";
import type { FormState } from "../receivables/actions";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

function Note({ state }: { state: FormState }) {
  if (state.status === "saved") return <p role="status" className="settings-message saved">{state.message}</p>;
  if (state.status === "error") {
    const fields = Object.entries(state.fields ?? {});
    return (
      <div role="alert" className="settings-message error">
        {state.message}
        {fields.length ? <ul>{fields.map(([f, m]) => <li key={f}>{`${f} ${m}`}</li>)}</ul> : null}
      </div>
    );
  }
  return null;
}

export function SmallForm({ action, label, children, submit }: { action: Action; label: string; children?: React.ReactNode; submit: string }) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={formAction} className="contact-form" aria-label={label}>
      <Note state={state} />
      <fieldset disabled={pending}>
        {children}
        <div className="row-buttons"><button type="submit" className="new-button">{pending ? "Saving…" : submit}</button></div>
      </fieldset>
    </form>
  );
}

export interface CollectionView {
  status: string;
  ownerUserId: string | null;
  pausedUntil: string | null;
  pauseReason: string | null;
  escalationNote: string | null;
}

/** How this invoice is being collected (spec §7.7). */
export function CollectionPanel({
  collection,
  members,
  canWrite,
  update,
  addPromise,
  addNote,
  currency,
  owed,
  today,
}: {
  collection: CollectionView;
  members: { id: string; name: string }[];
  canWrite: boolean;
  update: Action;
  addPromise: Action;
  addNote: Action;
  currency: string;
  owed: string;
  today: string;
}) {
  const [open, setOpen] = useState<null | "escalate" | "pause" | "promise" | "note">(null);
  const toggle = (name: NonNullable<typeof open>) => setOpen((current) => (current === name ? null : name));
  return (
    <div className="collection-panel">
      <p className="form-hint">
        {collection.status === "paused"
          ? `Reminders paused until ${collection.pausedUntil}: ${collection.pauseReason}`
          : collection.status === "escalated"
            ? `Escalated to a person, so no automatic reminders: ${collection.escalationNote}`
            : "Automatic reminders follow your settings."}
      </p>
      {canWrite ? (
        <>
          <SmallForm action={update} label="Collection owner" submit="Save owner">
            <input type="hidden" name="action" value="owner" />
            <label className="settings-field">
              <span>Owner</span>
              <select name="ownerUserId" defaultValue={collection.ownerUserId ?? ""}>
                <option value="">Nobody</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          </SmallForm>
          <div className="row-buttons">
            {collection.status !== "open" ? (
              <SmallForm action={update} label="Resume collection" submit="Resume">
                <input type="hidden" name="action" value="resume" />
              </SmallForm>
            ) : (
              <>
                <button type="button" className="link-button" onClick={() => toggle("pause")}>Pause reminders</button>
                <button type="button" className="link-button" onClick={() => toggle("escalate")}>Escalate</button>
              </>
            )}
            <button type="button" className="link-button" onClick={() => toggle("promise")}>Promise to pay</button>
            <button type="button" className="link-button" onClick={() => toggle("note")}>Add note</button>
          </div>
          {open === "pause" ? (
            <SmallForm action={update} label="Pause reminders" submit="Pause">
              <input type="hidden" name="action" value="pause" />
              <label className="settings-field"><span>Until</span><input type="date" name="until" min={today} required /></label>
              <label className="settings-field"><span>Reason</span><input name="reason" required minLength={3} maxLength={500} /></label>
            </SmallForm>
          ) : null}
          {open === "escalate" ? (
            <SmallForm action={update} label="Escalate" submit="Escalate">
              <input type="hidden" name="action" value="escalate" />
              <label className="settings-field"><span>What should happen next</span><textarea name="note" rows={2} required minLength={3} maxLength={1000} /></label>
            </SmallForm>
          ) : null}
          {open === "promise" ? (
            <SmallForm action={addPromise} label="Promise to pay" submit="Record promise">
              <label className="settings-field"><span>Amount ({currency})</span><input name="amount" inputMode="decimal" defaultValue={owed} required /></label>
              <label className="settings-field"><span>By</span><input type="date" name="promisedOn" min={today} required /></label>
              <label className="settings-field"><span>Note</span><input name="note" maxLength={500} /></label>
            </SmallForm>
          ) : null}
          {open === "note" ? (
            <SmallForm action={addNote} label="Collection note" submit="Add note">
              <label className="settings-field"><span>Note (internal)</span><textarea name="body" rows={2} required maxLength={5000} /></label>
            </SmallForm>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
