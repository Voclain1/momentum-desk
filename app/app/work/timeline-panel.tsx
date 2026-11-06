"use client";

import { useActionState, useState, useTransition } from "react";
import type { Parent } from "@/lib/records/parent";
import { addActivityAction, type FormState, removeActivityAction, updateActivityAction } from "./actions";

export const KIND_LABELS: Record<string, string> = {
  note: "Note",
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  message: "Message",
};

export type TimelineItem =
  | {
      type: "activity";
      id: string;
      when: string;
      kind: string;
      body: string;
      authorName: string;
      edited: boolean;
      canEdit: boolean;
      canRemove: boolean;
    }
  | { type: "event"; id: string; when: string; text: string; actorName: string };

function ActivityForm({
  action,
  initial,
  submitLabel,
  onDone,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  initial: { kind: string; body: string; occurredAt: string };
  submitLabel: string;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(async (previous: FormState, form: FormData) => {
    const result = await action(previous, form);
    if (result.status === "saved") onDone?.();
    return result;
  }, { status: "idle" });
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  return (
    <form action={formAction} className="activity-form" aria-label={submitLabel}>
      {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
      <fieldset disabled={pending}>
        <div className="activity-form-row">
          <label>
            <span className="sr-only">Type</span>
            <select name="kind" defaultValue={initial.kind} aria-label="Type">
              {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">When</span>
            <input type="datetime-local" name="occurredAt" defaultValue={initial.occurredAt} aria-label="When" />
          </label>
        </div>
        <textarea name="body" required maxLength={10000} rows={3} defaultValue={initial.body} aria-label="What happened" placeholder="What was said or agreed?" />
        {errors.body ? <em role="alert" className="inline-error">{`Text ${errors.body}`}</em> : null}
        {errors.occurredAt ? <em role="alert" className="inline-error">{`When ${errors.occurredAt}`}</em> : null}
        <div className="row-buttons">
          <button type="submit" className="new-button">{pending ? "Saving…" : submitLabel}</button>
          {onDone && initial.body ? <button type="button" className="link-button" onClick={onDone}>Cancel</button> : null}
        </div>
      </fieldset>
    </form>
  );
}

export function TimelinePanel({
  parent,
  items,
  canWrite,
  nowLocal,
}: {
  parent: Parent;
  items: (TimelineItem & { occurredAtLocal?: string })[];
  canWrite: boolean;
  /** Current wall-clock time in the workspace's timezone, for the form. */
  nowLocal: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  return (
    <section className="panel timeline-panel" aria-label="Timeline">
      <div className="panel-heading">
        <div>
          <h3>Timeline</h3>
          <p>Notes, calls, emails and meetings, with the record&apos;s history.</p>
        </div>
      </div>
      {canWrite ? (
        <ActivityForm
          key={formKey}
          action={addActivityAction.bind(null, parent)}
          initial={{ kind: "note", body: "", occurredAt: nowLocal }}
          submitLabel="Add to timeline"
          onDone={() => setFormKey((key) => key + 1)}
        />
      ) : null}
      {error ? <p role="alert" className="settings-message error">{error}</p> : null}
      {items.length === 0 ? <p className="team-empty">Nothing yet.</p> : null}
      <ol className="timeline">
        {items.map((item) =>
          item.type === "event" ? (
            <li key={item.id} className="timeline-event">
              <span><strong>{item.actorName}</strong> {item.text}</span>
              <time>{item.when}</time>
            </li>
          ) : editing === item.id ? (
            <li key={item.id}>
              <ActivityForm
                action={updateActivityAction.bind(null, item.id)}
                initial={{ kind: item.kind, body: item.body, occurredAt: item.occurredAtLocal ?? nowLocal }}
                submitLabel="Save"
                onDone={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={item.id} className="timeline-activity">
              <div className="timeline-meta">
                <span className={`pill kind-${item.kind}`}>{KIND_LABELS[item.kind] ?? item.kind}</span>
                <strong>{item.authorName}</strong>
                <time>{item.when}{item.edited ? " · edited" : ""}</time>
              </div>
              <p>{item.body}</p>
              {canWrite && (item.canEdit || item.canRemove) && editing === null ? (
                <div className="row-buttons">
                  {item.canEdit ? <button type="button" className="link-button" onClick={() => setEditing(item.id)}>Edit</button> : null}
                  {item.canRemove ? (
                    <button
                      type="button"
                      className="link-button danger"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          if (!window.confirm("Remove this from the timeline?")) return;
                          const result = await removeActivityAction(item.id);
                          setError(result.status === "error" ? result.message : "");
                        })
                      }
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ),
        )}
      </ol>
    </section>
  );
}
