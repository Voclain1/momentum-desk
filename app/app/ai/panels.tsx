"use client";

import { useActionState, useState, useTransition } from "react";
import type { CollectionsDraft, LeadAssist, ReceivablesSummary } from "@/lib/ai/tasks";
import type { AiResult, SettingsState } from "./actions";

const DRAFT_NOTE = "Drafted by Momentum AI from your records. Check and edit it before you use it.";
const ACTIONS: Record<LeadAssist["nextAction"]["action"], string> = {
  call: "Call them", email: "Email them", meeting: "Arrange a meeting", send_quote: "Send a quote",
  follow_up_later: "Follow up later", close_as_lost: "Close as lost",
};
const TIMING: Record<LeadAssist["nextAction"]["timing"], string> = { today: "today", this_week: "this week", next_week: "next week", later: "later" };

function Alert({ message }: { message: string }) {
  return <p role="alert" className="settings-message error">{message}</p>;
}

function Saved({ message }: { message: string }) {
  return <p role="status" className="settings-message saved">{message}</p>;
}

/** Lead summary, next step and a follow-up draft (spec §7.8). */
export function LeadAssistPanel({
  assist,
  log,
  contactEmail,
}: {
  assist: () => Promise<AiResult<LeadAssist>>;
  log: (kind: "note" | "email", body: string) => Promise<AiResult<null>>;
  contactEmail: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [result, setResult] = useState<LeadAssist | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const ask = () =>
    start(async () => {
      setError("");
      setSaved("");
      const response = await assist();
      if (response.status === "error") return setError(response.message);
      setResult(response.result);
      setSubject(response.result.followUp.subject);
      setBody(response.result.followUp.body);
    });
  const save = (kind: "note" | "email", text: string, done: string) =>
    start(async () => {
      const response = await log(kind, text);
      if (response.status === "error") setError(response.message);
      else setSaved(done);
    });
  return (
    <section className="panel contacts-panel" aria-label="Momentum AI">
      <div className="panel-heading">
        <div><h3>Momentum AI</h3><p>A summary, a suggested next step and a follow-up draft, from this lead&apos;s records.</p></div>
        <button type="button" className="new-button" disabled={pending} onClick={ask}>{pending && !result ? "Thinking…" : result ? "Ask again" : "Summarise and suggest"}</button>
      </div>
      <div className="collection-panel">
        {error ? <Alert message={error} /> : null}
        {saved ? <Saved message={saved} /> : null}
        {result ? (
          <>
            <p className="form-hint">{DRAFT_NOTE}</p>
            <h4>Summary</h4>
            <p>{result.summary}</p>
            <div className="row-buttons">
              <button type="button" className="link-button" disabled={pending} onClick={() => save("note", `Summary (AI-assisted): ${result.summary}`, "Summary saved as a note.")}>Save as note</button>
            </div>
            <h4>Suggested next step</h4>
            <p><strong>{ACTIONS[result.nextAction.action]}, {TIMING[result.nextAction.timing]}.</strong> {result.nextAction.reason}</p>
            <h4>Follow-up draft</h4>
            <label className="settings-field"><span>Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} /></label>
            <label className="settings-field"><span>Message</span><textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} /></label>
            <div className="row-buttons">
              {contactEmail ? (
                <a className="link-button" href={`mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>Open in your email</a>
              ) : null}
              <button type="button" className="link-button" disabled={pending} onClick={() => save("email", `${subject}\n\n${body}`, "Logged as an email on the timeline.")}>Log as sent email</button>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Emailing the customer about an invoice: a person writes or edits the
 * message (optionally from an AI draft) and sends it themselves.
 */
export function CollectionMessagePanel({
  recipient,
  aiAvailable,
  draft,
  send,
}: {
  recipient: string | null;
  aiAvailable: boolean;
  draft: (tone: string) => Promise<AiResult<CollectionsDraft>>;
  send: (message: { subject: string; body: string; aiDrafted: boolean }) => Promise<AiResult<{ sentTo: string }>>;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState("friendly");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [aiDrafted, setAiDrafted] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [sent, setSent] = useState("");
  if (!recipient) return <p className="form-hint">Add an email address to the invoice&apos;s customer to email them from here.</p>;
  if (!open) {
    return (
      <div className="row-buttons">
        <button type="button" className="link-button" onClick={() => setOpen(true)}>Email the customer</button>
        {sent ? <Saved message={sent} /> : null}
      </div>
    );
  }
  const ask = () =>
    start(async () => {
      setError("");
      const response = await draft(tone);
      if (response.status === "error") return setError(response.message);
      setSubject(response.result.subject);
      setBody(response.result.body);
      setAiDrafted(true);
    });
  const submit = () =>
    start(async () => {
      if (!window.confirm(`Send this email to ${recipient}?`)) return;
      setError("");
      const response = await send({ subject, body, aiDrafted });
      if (response.status === "error") {
        setError(response.message);
        setFields(response.fields ?? {});
        return;
      }
      setSent(`Sent to ${response.result.sentTo}.`);
      setOpen(false);
      setSubject("");
      setBody("");
      setAiDrafted(false);
    });
  return (
    <div className="contact-form" role="group" aria-label="Email the customer">
      {error ? <Alert message={error} /> : null}
      {aiAvailable ? (
        <div className="row-buttons">
          <label className="settings-field">
            <span>Tone</span>
            <select value={tone} onChange={(e) => setTone(e.target.value)}>
              <option value="friendly">Friendly</option>
              <option value="firm">Firm</option>
              <option value="final">Final request</option>
            </select>
          </label>
          <button type="button" className="link-button" disabled={pending} onClick={ask}>{pending ? "Drafting…" : "Draft with AI"}</button>
        </div>
      ) : null}
      {aiDrafted ? <p className="form-hint">{DRAFT_NOTE}</p> : null}
      <label className="settings-field">
        <span>Subject</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} />
        {fields.subject ? <em role="alert">{`Subject ${fields.subject}`}</em> : null}
      </label>
      <label className="settings-field">
        <span>Message</span>
        <textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
        {fields.body ? <em role="alert">{`Message ${fields.body}`}</em> : null}
      </label>
      <p className="form-hint">A link to view and pay the invoice is added under your message. It goes to {recipient}.</p>
      <div className="row-buttons">
        <button type="button" className="new-button" disabled={pending} onClick={submit}>Send email</button>
        <button type="button" className="link-button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

/** A short read of the overdue accounts, for a person deciding where to start. */
export function ReceivablesSummaryPanel({ summarize }: { summarize: () => Promise<AiResult<ReceivablesSummary>> }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ReceivablesSummary | null>(null);
  const [error, setError] = useState("");
  return (
    <section className="panel contacts-panel" aria-label="Momentum AI summary">
      <div className="panel-heading">
        <div><h3>Momentum AI</h3><p>A summary of the overdue accounts and where to start.</p></div>
        <button
          type="button"
          className="new-button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError("");
              const response = await summarize();
              if (response.status === "error") setError(response.message);
              else setResult(response.result);
            })
          }
        >
          {pending ? "Thinking…" : "Summarise overdue accounts"}
        </button>
      </div>
      <div className="collection-panel">
        {error ? <Alert message={error} /> : null}
        {result ? (
          <>
            <p className="form-hint">{DRAFT_NOTE}</p>
            <p>{result.summary}</p>
            {result.priorities.length ? (
              <ol>{result.priorities.map((p) => <li key={p.invoiceNumber}><strong>{p.invoiceNumber}</strong>: {p.reason}</li>)}</ol>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

/** Settings → Momentum AI (decision D20). */
export function AiSettingsPanel({
  canEdit,
  configured,
  provider,
  enabled,
  monthlyLimit,
  serverLimit,
  usage,
  action,
}: {
  canEdit: boolean;
  configured: boolean;
  provider: string | null;
  enabled: boolean;
  monthlyLimit: number;
  serverLimit: number;
  usage: { requests: number; failed: number; tokens: string; cost: string };
  action: (state: SettingsState, form: FormData) => Promise<SettingsState>;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  return (
    <section className="panel contacts-panel" aria-label="Momentum AI settings">
      <div className="panel-heading">
        <div>
          <h3>Momentum AI</h3>
          <p>
            {configured ? `${enabled ? "On" : "Off"} · ${provider}.` : "Not set up on this server: everything works without it."} AI drafts and suggests from your
            records; people review, edit and send. Prompts and AI text are not stored, only what ran, when, by whom and what it cost.
          </p>
        </div>
      </div>
      <p className="form-hint" aria-label="AI usage">
        This month: {usage.requests} of {monthlyLimit} requests{usage.failed ? ` (${usage.failed} failed, not counted)` : ""} · {usage.tokens} tokens · estimated {usage.cost}
      </p>
      {canEdit && configured ? (
        <form action={formAction} className="contact-form" aria-label="AI settings">
          {state.status === "error" ? <Alert message={state.message} /> : null}
          {state.status === "saved" ? <Saved message={state.message} /> : null}
          <fieldset disabled={pending}>
            <label className="settings-field checkbox-field"><input type="checkbox" name="enabled" defaultChecked={enabled} /> <span>Use Momentum AI in this workspace</span></label>
            <label className="settings-field">
              <span>Monthly request limit (at most {serverLimit})</span>
              <input name="monthlyLimit" inputMode="numeric" defaultValue={monthlyLimit} required maxLength={6} />
              {state.status === "error" && state.fields?.monthlyLimit ? <em role="alert">{`Limit ${state.fields.monthlyLimit}`}</em> : null}
            </label>
            <div className="row-buttons"><button type="submit" className="new-button">{pending ? "Saving…" : "Save AI settings"}</button></div>
          </fieldset>
        </form>
      ) : null}
    </section>
  );
}
