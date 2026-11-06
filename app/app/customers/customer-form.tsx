"use client";

import { useActionState, useState } from "react";
import type { Option } from "@/lib/organizations/options";
import type { FormState } from "./actions";

export interface CustomerValues {
  type: string;
  displayName: string;
  legalName: string;
  email: string;
  phone: string;
  website: string;
  taxId: string;
  countryCode: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  preferredLocale: string;
  preferredLanguage: string;
  preferredCurrency: string;
  tags: string;
  notes: string;
}

export const EMPTY_CUSTOMER: CustomerValues = {
  type: "organization", displayName: "", legalName: "", email: "", phone: "", website: "", taxId: "",
  countryCode: "", addressLine1: "", addressLine2: "", city: "", region: "", postalCode: "",
  preferredLocale: "", preferredLanguage: "", preferredCurrency: "", tags: "", notes: "",
};

type Field = keyof CustomerValues;

export function CustomerForm({
  action,
  initial,
  version,
  canEdit,
  submitLabel,
  countries,
  currencies,
  languages,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  initial: CustomerValues;
  /** Edit forms send the version they were loaded with. */
  version?: number;
  canEdit: boolean;
  submitLabel: string;
  countries: Option[];
  currencies: Option[];
  languages: Option[];
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  // Controlled so a failed save keeps what was typed.
  const [values, setValues] = useState(initial);
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  const bind = (field: Field) => ({
    name: field,
    id: `customer-${field}`,
    value: values[field],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValues((current) => ({ ...current, [field]: event.target.value })),
    "aria-invalid": errors[field] ? true : undefined,
  });

  const field = (name: Field, label: string, input: React.ReactNode, hint?: string) => (
    <label className="settings-field" htmlFor={`customer-${name}`}>
      <span>{label}</span>
      {input}
      {errors[name] ? <em role="alert">{`${label} ${errors[name]}`}</em> : hint ? <small>{hint}</small> : null}
    </label>
  );
  const select = (name: Field, options: Option[], blank: string) => (
    <select {...bind(name)}>
      <option value="">{blank}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
  const isPerson = values.type === "person";

  return (
    <form action={formAction} className="settings-form customer-form">
      {version !== undefined ? <input type="hidden" name="version" value={version} /> : null}
      {state.status === "saved" ? (
        <p role="status" className="settings-message saved">{state.message}</p>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" className="settings-message error">{state.message}</p>
      ) : null}
      <fieldset disabled={!canEdit || pending}>
        <div className="form-grid">
          {field("type", "Type", (
            <select {...bind("type")}>
              <option value="organization">Organization</option>
              <option value="person">Person</option>
            </select>
          ))}
          {field("displayName", isPerson ? "Full name" : "Name", <input {...bind("displayName")} required maxLength={200} />)}
          {isPerson ? null : field("legalName", "Legal name", <input {...bind("legalName")} maxLength={200} />, "If different, for invoices.")}
          {field("taxId", "Tax ID", <input {...bind("taxId")} maxLength={50} />, "VAT, TIN or similar.")}
        </div>

        <h4>Contact details</h4>
        <div className="form-grid">
          {field("email", "Email", <input {...bind("email")} type="email" maxLength={254} />)}
          {field("phone", "Phone", <input {...bind("phone")} type="tel" maxLength={40} />)}
          {field("website", "Website", <input {...bind("website")} maxLength={200} />)}
        </div>

        <h4>Address</h4>
        <div className="form-grid">
          {field("addressLine1", "Address", <input {...bind("addressLine1")} maxLength={200} />)}
          {field("addressLine2", "Address line 2", <input {...bind("addressLine2")} maxLength={200} />)}
          {field("city", "City", <input {...bind("city")} maxLength={100} />)}
          {field("region", "State or region", <input {...bind("region")} maxLength={100} />)}
          {field("postalCode", "Postal code", <input {...bind("postalCode")} maxLength={20} />)}
          {field("countryCode", "Country", select("countryCode", countries, "Not set"))}
        </div>

        <h4>Preferences</h4>
        <div className="form-grid">
          {field("preferredCurrency", "Preferred currency", select("preferredCurrency", currencies, "Not set"), "A default for new quotes; each document keeps its own currency.")}
          {field("preferredLanguage", "Language", select("preferredLanguage", languages, "Workspace default"))}
          {field("preferredLocale", "Formatting locale", <input {...bind("preferredLocale")} maxLength={35} placeholder="e.g. en-GB" />)}
        </div>

        <h4>Notes</h4>
        <div className="form-grid">
          {field("tags", "Tags", <input {...bind("tags")} maxLength={900} />, "Separate with commas.")}
        </div>
        {field("notes", "Notes", <textarea {...bind("notes")} rows={4} maxLength={5000} />)}

        {canEdit ? (
          <button type="submit" className="new-button settings-save">
            {pending ? "Saving…" : submitLabel}
          </button>
        ) : null}
      </fieldset>
    </form>
  );
}
