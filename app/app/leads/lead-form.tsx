"use client";

import { useActionState, useState } from "react";
import type { Option } from "@/lib/organizations/options";
import type { FormState } from "./actions";

export interface LeadValues {
  contactName: string;
  companyName: string;
  email: string;
  phone: string;
  source: string;
  ownerUserId: string;
  stageId: string;
  estimatedValue: string;
  currency: string;
  summary: string;
  nextFollowUpOn: string;
  tags: string;
  notes: string;
  lostReason: string;
}

type Field = keyof LeadValues;

export function LeadForm({
  action,
  initial,
  version,
  canEdit,
  submitLabel,
  stages,
  members,
  sources,
  currencies,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  initial: LeadValues;
  version?: number;
  canEdit: boolean;
  submitLabel: string;
  stages: { id: string; name: string; kind: string }[];
  members: { userId: string; name: string }[];
  sources: Option[];
  currencies: Option[];
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  // Controlled so a failed save keeps what was typed.
  const [values, setValues] = useState(initial);
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  const bind = (field: Field) => ({
    name: field,
    id: `lead-${field}`,
    value: values[field],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValues((current) => ({ ...current, [field]: event.target.value })),
    "aria-invalid": errors[field] ? true : undefined,
  });
  const field = (name: Field, label: string, input: React.ReactNode, hint?: string) => (
    <label className="settings-field" htmlFor={`lead-${name}`}>
      <span>{label}</span>
      {input}
      {errors[name] ? <em role="alert">{`${label} ${errors[name]}`}</em> : hint ? <small>{hint}</small> : null}
    </label>
  );
  const select = (name: Field, options: Option[], blank?: string) => (
    <select {...bind(name)}>
      {blank !== undefined ? <option value="">{blank}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
  const isLost = stages.find((stage) => stage.id === values.stageId)?.kind === "lost";
  // A former member who still owns the lead stays selectable until changed.
  const ownerOptions = members.map((member) => ({ value: member.userId, label: member.name }));
  if (initial.ownerUserId && !members.some((member) => member.userId === initial.ownerUserId)) {
    ownerOptions.push({ value: initial.ownerUserId, label: "Former member" });
  }

  return (
    <form action={formAction} className="settings-form customer-form">
      {version !== undefined ? <input type="hidden" name="version" value={version} /> : null}
      {state.status === "saved" ? <p role="status" className="settings-message saved">{state.message}</p> : null}
      {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
      <fieldset disabled={!canEdit || pending}>
        <div className="form-grid">
          {field("contactName", "Contact name", <input {...bind("contactName")} maxLength={200} />)}
          {field("companyName", "Company", <input {...bind("companyName")} maxLength={200} />, "A name, a company, or both.")}
          {field("email", "Email", <input {...bind("email")} type="email" maxLength={254} />)}
          {field("phone", "Phone", <input {...bind("phone")} type="tel" maxLength={40} />)}
        </div>

        <h4>Pipeline</h4>
        <div className="form-grid">
          {field("stageId", "Stage", select("stageId", stages.map((stage) => ({ value: stage.id, label: stage.name }))))}
          {field("ownerUserId", "Owner", select("ownerUserId", ownerOptions, "Unassigned"))}
          {field("source", "Source", select("source", sources, "Not set"))}
          {field("nextFollowUpOn", "Next follow-up", <input {...bind("nextFollowUpOn")} type="date" />)}
          {field("estimatedValue", "Estimated value", <input {...bind("estimatedValue")} inputMode="decimal" maxLength={30} placeholder="e.g. 1500.00" />)}
          {field("currency", "Currency", select("currency", currencies, "Choose"))}
        </div>
        {isLost ? field("lostReason", "Why it was lost", <input {...bind("lostReason")} maxLength={500} />) : null}

        <h4>Details</h4>
        {field("summary", "What they need", <textarea {...bind("summary")} rows={3} maxLength={2000} />)}
        <div className="form-grid">
          {field("tags", "Tags", <input {...bind("tags")} maxLength={900} />, "Separate with commas.")}
        </div>
        {field("notes", "Notes", <textarea {...bind("notes")} rows={3} maxLength={5000} />)}

        {canEdit ? (
          <button type="submit" className="new-button settings-save">
            {pending ? "Saving…" : submitLabel}
          </button>
        ) : null}
      </fieldset>
    </form>
  );
}
