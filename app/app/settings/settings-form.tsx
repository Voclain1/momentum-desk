"use client";

import { useActionState, useState } from "react";
import type { Option } from "@/lib/organizations/options";
import { saveWorkspaceSettings, type SettingsState } from "./actions";

interface Values {
  name: string;
  countryCode: string;
  locale: string;
  timezone: string;
  defaultLanguage: string;
  defaultInvoiceCurrency: string;
}

const LABELS: Record<string, string> = {
  name: "Business name",
  countryCode: "Country",
  locale: "Formatting locale",
  timezone: "Timezone",
  defaultLanguage: "Document language",
  defaultInvoiceCurrency: "Default invoice currency",
};

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      {children}
      {error ? <em role="alert">{`${label} ${error}`}</em> : hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Select({ options, ...props }: { options: Option[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function SettingsForm({
  initial,
  version,
  canEdit,
  countries,
  currencies,
  languages,
  timezones,
}: {
  initial: Values;
  /** Latest saved version from the server; refreshed after each save. */
  version: number;
  canEdit: boolean;
  countries: Option[];
  currencies: Option[];
  languages: Option[];
  timezones: string[];
}) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(saveWorkspaceSettings, {
    status: "idle",
  });
  // Controlled so a failed save keeps what the user typed.
  const [values, setValues] = useState(initial);
  const set = (key: keyof Values) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  const unknownErrors = Object.entries(errors).filter(([field]) => !(field in LABELS));

  return (
    <form action={formAction} className="settings-form">
      <input type="hidden" name="version" value={version} />
      {state.status === "saved" ? (
        <p role="status" className="settings-message saved">
          Settings saved.
        </p>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" className="settings-message error">
          {state.message}
          {unknownErrors.map(([field, message]) => ` ${field} ${message}.`)}
        </p>
      ) : null}
      <fieldset disabled={!canEdit || pending}>
        <Field label={LABELS.name} error={errors.name}>
          <input name="name" value={values.name} onChange={set("name")} required maxLength={100} />
        </Field>
        <Field label={LABELS.countryCode} hint="Where the business is registered." error={errors.countryCode}>
          <Select name="countryCode" value={values.countryCode} onChange={set("countryCode")} options={countries} />
        </Field>
        <Field
          label={LABELS.defaultInvoiceCurrency}
          hint="Optional. Each quote and invoice still has its own currency."
          error={errors.defaultInvoiceCurrency}
        >
          <Select
            name="defaultInvoiceCurrency"
            value={values.defaultInvoiceCurrency}
            onChange={set("defaultInvoiceCurrency")}
            options={[{ value: "", label: "None" }, ...currencies]}
          />
        </Field>
        <Field label={LABELS.defaultLanguage} hint="For quotes, invoices and reminders." error={errors.defaultLanguage}>
          <Select name="defaultLanguage" value={values.defaultLanguage} onChange={set("defaultLanguage")} options={languages} />
        </Field>
        <Field label={LABELS.timezone} hint="Schedules and due dates follow this timezone." error={errors.timezone}>
          <Select
            name="timezone"
            value={values.timezone}
            onChange={set("timezone")}
            options={timezones.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }))}
          />
        </Field>
        <Field
          label={LABELS.locale}
          hint="How numbers and dates are written, e.g. en-GB."
          error={errors.locale}
        >
          <input name="locale" value={values.locale} onChange={set("locale")} required maxLength={35} />
        </Field>
        {canEdit ? (
          <button type="submit" className="new-button settings-save">
            {pending ? "Saving…" : "Save settings"}
          </button>
        ) : null}
      </fieldset>
    </form>
  );
}
