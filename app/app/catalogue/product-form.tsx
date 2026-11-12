"use client";

import { useActionState, useState } from "react";
import type { Option } from "@/lib/organizations/options";
import type { FormState } from "./actions";

export interface ProductValues {
  name: string;
  description: string;
  sku: string;
  unit: string;
  category: string;
  taxRateId: string;
  prices: { currency: string; amount: string }[];
}

type TextField = Exclude<keyof ProductValues, "prices">;

export function ProductForm({
  action,
  initial,
  version,
  canEdit,
  submitLabel,
  currencies,
  taxRates,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  initial: ProductValues;
  version?: number;
  canEdit: boolean;
  submitLabel: string;
  currencies: Option[];
  taxRates: Option[];
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const [values, setValues] = useState(initial);
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  const bind = (field: TextField) => ({
    name: field,
    id: `product-${field}`,
    value: values[field],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValues((current) => ({ ...current, [field]: event.target.value })),
    "aria-invalid": errors[field] ? true : undefined,
  });
  const field = (name: TextField, label: string, input: React.ReactNode, hint?: string) => (
    <label className="settings-field" htmlFor={`product-${name}`}>
      <span>{label}</span>
      {input}
      {errors[name] ? <em role="alert">{`${label} ${errors[name]}`}</em> : hint ? <small>{hint}</small> : null}
    </label>
  );
  const setPrice = (index: number, change: Partial<ProductValues["prices"][number]>) =>
    setValues((current) => ({
      ...current,
      prices: current.prices.map((price, i) => (i === index ? { ...price, ...change } : price)),
    }));

  return (
    <form action={formAction} className="settings-form customer-form" aria-label="Product">
      {version !== undefined ? <input type="hidden" name="version" value={version} /> : null}
      {state.status === "saved" ? <p role="status" className="settings-message saved">{state.message}</p> : null}
      {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
      <fieldset disabled={!canEdit || pending}>
        <div className="form-grid">
          {field("name", "Name", <input {...bind("name")} required maxLength={200} />)}
          {field("sku", "SKU / code", <input {...bind("sku")} maxLength={64} />, "Optional; unique in this workspace.")}
          {field("unit", "Unit", <input {...bind("unit")} maxLength={30} placeholder="e.g. hour, unit, kg" />)}
          {field("category", "Category", <input {...bind("category")} maxLength={100} />)}
          {field("taxRateId", "Default tax", (
            <select {...bind("taxRateId")}>
              <option value="">No tax</option>
              {taxRates.map((rate) => <option key={rate.value} value={rate.value}>{rate.label}</option>)}
            </select>
          ), "Lines can change it.")}
        </div>
        {field("description", "Description", <textarea {...bind("description")} rows={3} maxLength={2000} />, "Copied onto quote lines.")}

        <h4>Prices</h4>
        <p className="form-hint">
          One price per currency, before tax and discount. A quote in a currency without a price asks for one; prices are
          never converted.
        </p>
        {errors.prices ? <em role="alert" className="inline-error">{`Prices ${errors.prices}`}</em> : null}
        <ul className="price-rows">
          {values.prices.map((price, index) => (
            <li key={index}>
              <select
                name="priceCurrency"
                aria-label={`Currency ${index + 1}`}
                value={price.currency}
                onChange={(event) => setPrice(index, { currency: event.target.value })}
              >
                <option value="">Currency…</option>
                {currencies.map((currency) => <option key={currency.value} value={currency.value}>{currency.label}</option>)}
              </select>
              <input
                name="priceAmount"
                aria-label={`Unit price ${index + 1}`}
                inputMode="decimal"
                value={price.amount}
                onChange={(event) => setPrice(index, { amount: event.target.value })}
                maxLength={30}
              />
              <button
                type="button"
                className="link-button danger"
                onClick={() => setValues((current) => ({ ...current, prices: current.prices.filter((_, i) => i !== index) }))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="link-button"
          onClick={() => setValues((current) => ({ ...current, prices: [...current.prices, { currency: "", amount: "" }] }))}
        >
          ＋ Add a price
        </button>

        {canEdit ? (
          <div className="row-buttons">
            <button type="submit" className="new-button">{pending ? "Saving…" : submitLabel}</button>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
