"use client";

import { useActionState, useState, useTransition } from "react";
import { type FormState, removeContactAction, saveContactAction } from "../actions";

export function ArchiveButton({ action, archived }: { action: () => Promise<FormState>; archived: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <>
      {error ? <span role="alert" className="inline-error">{error}</span> : null}
      <button
        type="button"
        className={archived ? "new-button" : "icon-button text-button"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (!archived && !window.confirm("Archive this customer? It will be hidden from lists but keeps its history.")) return;
            const result = await action();
            setError(result.status === "error" ? result.message : "");
          })
        }
      >
        {archived ? "Restore customer" : "Archive"}
      </button>
    </>
  );
}

export interface ContactValues {
  id: string;
  name: string;
  email: string;
  phone: string;
  jobTitle: string;
  isPrimary: boolean;
}

function ContactForm({
  customerId,
  contact,
  onDone,
}: {
  customerId: string;
  contact?: ContactValues;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (previous: FormState, form: FormData) => {
      const result = await saveContactAction(customerId, contact?.id ?? null, previous, form);
      if (result.status === "saved") onDone();
      return result;
    },
    { status: "idle" },
  );
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  const label = contact ? `Edit ${contact.name}` : "Add a contact";
  return (
    <form action={formAction} className="contact-form" aria-label={label}>
      {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
      <fieldset disabled={pending}>
        {(
          [
            ["name", "Name", "text", true],
            ["jobTitle", "Job title", "text", false],
            ["email", "Email", "email", false],
            ["phone", "Phone", "tel", false],
          ] as const
        ).map(([name, text, type, required]) => (
          <label key={name} className="settings-field">
            <span>{text}</span>
            <input name={name} type={type} required={required} defaultValue={contact?.[name] ?? ""} maxLength={name === "email" ? 254 : 200} />
            {errors[name] ? <em role="alert">{`${text} ${errors[name]}`}</em> : null}
          </label>
        ))}
        <label className="check">
          <input type="checkbox" name="isPrimary" defaultChecked={contact?.isPrimary ?? false} /> Primary contact
        </label>
        <div className="row-buttons">
          <button type="submit" className="new-button">{pending ? "Saving…" : contact ? "Save contact" : "Add contact"}</button>
          <button type="button" className="link-button" onClick={onDone}>Cancel</button>
        </div>
      </fieldset>
    </form>
  );
}

export function Contacts({
  customerId,
  contacts,
  canEdit,
}: {
  customerId: string;
  contacts: ContactValues[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");

  return (
    <aside className="panel contacts-panel" aria-label="Contacts">
      <div className="panel-heading">
        <div>
          <h3>Contacts</h3>
          <p>People to address quotes, invoices and reminders to.</p>
        </div>
        {canEdit && editing === null ? (
          <button type="button" onClick={() => setEditing("new")}>＋ Add</button>
        ) : null}
      </div>
      {message ? <p role="status" className="settings-message saved contacts-message">{message}</p> : null}
      {editing === "new" ? <ContactForm customerId={customerId} onDone={() => setEditing(null)} /> : null}
      {contacts.length === 0 && editing !== "new" ? <p className="team-empty">No contacts yet.</p> : null}
      <ul className="contact-list">
        {contacts.map((contact) =>
          editing === contact.id ? (
            <li key={contact.id}>
              <ContactForm customerId={customerId} contact={contact} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={contact.id}>
              <div>
                <strong>
                  {contact.name}
                  {contact.isPrimary ? <span className="pill">Primary</span> : null}
                </strong>
                {contact.jobTitle ? <small>{contact.jobTitle}</small> : null}
                {contact.email ? <small><a href={`mailto:${contact.email}`}>{contact.email}</a></small> : null}
                {contact.phone ? <small><a href={`tel:${contact.phone}`}>{contact.phone}</a></small> : null}
              </div>
              {canEdit && editing === null ? (
                <div className="row-buttons">
                  <button type="button" className="link-button" onClick={() => setEditing(contact.id)}>Edit</button>
                  <button
                    type="button"
                    className="link-button danger"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        if (!window.confirm(`Remove ${contact.name}?`)) return;
                        const result = await removeContactAction(customerId, contact.id);
                        setMessage(result.status === "saved" ? result.message : "");
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </li>
          ),
        )}
      </ul>
    </aside>
  );
}
