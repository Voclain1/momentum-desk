"use client";

import { useActionState, useMemo, useState } from "react";
import { calculateDocument, type Discount, formatScaled, HUNDRED_PERCENT, parseScaled } from "@/lib/documents/calc";
import { formatMoney, fromDecimalString, money } from "@/lib/money";
import type { Option } from "@/lib/organizations/options";
import type { FormState } from "./actions";
import type { QuoteSuggestion } from "@/lib/ai/tasks";
import type { AiResult } from "../ai/actions";
import { type LineValues, newLine, type QuoteValues } from "./builder-values";

export type { LineValues, QuoteValues };

export interface BuilderOptions {
  customers: {
    id: string;
    name: string;
    email: string | null;
    preferredCurrency: string | null;
    contacts: { id: string; name: string; email: string | null }[];
  }[];
  products: {
    id: string;
    name: string;
    description: string | null;
    unit: string | null;
    taxRateId: string | null;
    /** Currency → decimal price string. */
    prices: Record<string, string>;
  }[];
  taxRates: { id: string; name: string; milliPercent: number; label: string }[];
  currencies: Option[];
}

/** Live preview with the same arithmetic as the server (decision D12); the server's result is what is saved. */
function preview(values: QuoteValues, rates: BuilderOptions["taxRates"]) {
  const parsed = values.lines.map((line) => {
    try {
      const quantityMilli = parseScaled(line.quantity, 3);
      const unitPriceMinor = fromDecimalString(line.unitPrice.replaceAll(",", ""), values.currency).amountMinor;
      if (quantityMilli === null || quantityMilli <= 0n || unitPriceMinor < 0n) return null;
      let discount: Discount = { kind: "none" };
      if (line.discountKind === "percent") {
        const value = parseScaled(line.discount.replace(/%$/, ""), 3);
        if (value === null || value > HUNDRED_PERCENT) return null;
        discount = { kind: "percent", milliPercent: value };
      } else if (line.discountKind === "fixed") {
        discount = { kind: "fixed", amountMinor: fromDecimalString(line.discount.replaceAll(",", "") || "0", values.currency).amountMinor };
      }
      const rate = rates.find((r) => r.id === line.taxRateId);
      return {
        quantityMilli, unitPriceMinor, discount,
        tax: rate ? { key: rate.id, name: rate.name, milliPercent: BigInt(rate.milliPercent) } : null,
      };
    } catch {
      return null;
    }
  });
  if (parsed.some((line) => line === null) || parsed.length === 0) return { totals: null, lineAmounts: parsed.map(() => null) };
  try {
    const totals = calculateDocument(parsed as NonNullable<(typeof parsed)[number]>[], values.taxMode);
    return { totals, lineAmounts: totals.lines.map((line) => line.netMinor) };
  } catch {
    return { totals: null, lineAmounts: parsed.map(() => null) };
  }
}

export function QuoteBuilder({
  kind = "quote",
  action,
  initial,
  version,
  options,
  locale,
  submitLabel,
  assist,
}: {
  /** Momentum AI quote assistance, when available. */
  assist?: (request: string, currency: string) => Promise<AiResult<QuoteSuggestion>>;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  initial: QuoteValues;
  version?: number;
  options: BuilderOptions;
  locale: string;
  submitLabel: string;
  /** The same builder makes invoices; only the closing date differs. */
  kind?: "quote" | "invoice";
}) {
  const endKey = kind === "quote" ? "expiresOn" : "dueOn";
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const [values, setValues] = useState(initial);
  const [notice, setNotice] = useState("");
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  const customer = options.customers.find((c) => c.id === values.customerId);
  const { totals, lineAmounts } = useMemo(() => preview(values, options.taxRates), [values, options.taxRates]);
  const show = (minor: bigint) => {
    try {
      return formatMoney(money(minor, values.currency), locale);
    } catch {
      return "—";
    }
  };

  const set = <K extends keyof QuoteValues>(field: K, value: QuoteValues[K]) => setValues((current) => ({ ...current, [field]: value }));
  const setLine = (key: string, change: Partial<LineValues>) =>
    setValues((current) => ({ ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...change } : line)) }));

  /** Catalogue lines take the price in the new currency; typed prices are kept but flagged. Nothing is converted. */
  const changeCurrency = (currency: string) => {
    setValues((current) => {
      let manual = 0;
      const lines = current.lines.map((line) => {
        const product = options.products.find((p) => p.id === line.productId);
        if (product) return { ...line, unitPrice: product.prices[currency] ?? "" };
        if (line.unitPrice) manual++;
        return line;
      });
      setNotice(
        manual
          ? `Currency changed to ${currency}. Check the ${manual === 1 ? "typed price" : `${manual} typed prices`}: amounts are never converted.`
          : `Currency changed to ${currency}. Catalogue prices were refilled in ${currency}.`,
      );
      return { ...current, currency, lines };
    });
  };

  /** A suggested line: a catalogue item at its catalogue price, or a described line whose price the person enters. */
  const addSuggested = (suggested: QuoteSuggestion["lines"]) => {
    let unpriced = 0;
    const added = suggested.map((s) => {
      const product = options.products.find((p) => p.id === s.productId);
      const price = product?.prices[values.currency] ?? "";
      if (!price) unpriced++;
      return product
        ? newLine({
            productId: product.id,
            description: product.description ? `${product.name} — ${product.description}` : product.name,
            quantity: s.quantity, unit: product.unit ?? "", unitPrice: price,
            taxRateId: options.taxRates.some((r) => r.id === product.taxRateId) ? (product.taxRateId ?? "") : "",
          })
        : newLine({ description: s.description, quantity: s.quantity });
    });
    setValues((current) => ({
      ...current,
      lines: [...current.lines.filter((line) => line.description || line.unitPrice || line.productId), ...added],
    }));
    setNotice(unpriced ? `Enter the price on ${unpriced === 1 ? "1 line" : `${unpriced} lines`}: prices come only from your catalogue or from you.` : "");
  };

  const addProduct = (productId: string) => {
    const product = options.products.find((p) => p.id === productId);
    if (!product) return;
    const price = product.prices[values.currency];
    setValues((current) => ({
      ...current,
      lines: [
        ...current.lines.filter((line) => line.description || line.unitPrice || line.productId),
        newLine({
          productId: product.id,
          description: product.description ? `${product.name} — ${product.description}` : product.name,
          unit: product.unit ?? "",
          unitPrice: price ?? "",
          taxRateId: options.taxRates.some((r) => r.id === product.taxRateId) ? (product.taxRateId ?? "") : "",
        }),
      ],
    }));
    setNotice(price ? "" : `${product.name} has no ${values.currency} price in the catalogue; enter one.`);
  };

  const lineError = (index: number, field: string) => errors[`lines.${index + 1}.${field}`];
  const payload = JSON.stringify({
    customerId: values.customerId,
    recipientContactId: values.recipientContactId,
    leadId: values.leadId,
    currency: values.currency,
    taxMode: values.taxMode,
    issuedOn: values.issuedOn,
    [endKey]: values.endsOn,
    notes: values.notes,
    terms: values.terms,
    lines: values.lines.map((line) => ({
      productId: line.productId, description: line.description, quantity: line.quantity, unit: line.unit,
      unitPrice: line.unitPrice, discountKind: line.discountKind, discount: line.discount, taxRateId: line.taxRateId,
    })),
  });

  const label = (text: string, error: string | undefined, input: React.ReactNode, hint?: string) => (
    <label className="settings-field">
      <span>{text}</span>
      {input}
      {error ? <em role="alert">{`${text} ${error}`}</em> : hint ? <small>{hint}</small> : null}
    </label>
  );

  return (
    <form action={formAction} className="settings-form quote-builder" aria-label={kind === "quote" ? "Quote" : "Invoice"}>
      <input type="hidden" name="quote" value={payload} />
      {version !== undefined ? <input type="hidden" name="version" value={version} /> : null}
      {state.status === "saved" ? <p role="status" className="settings-message saved">{state.message}</p> : null}
      {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
      <fieldset disabled={pending}>
        <div className="form-grid">
          {label("Customer", errors.customerId, (
            <select
              value={values.customerId}
              onChange={(event) => {
                const next = options.customers.find((c) => c.id === event.target.value);
                set("customerId", event.target.value);
                set("recipientContactId", next?.contacts[0]?.id ?? "");
                // A customer's preferred currency is a default for new quotes only (spec §5.2).
                if (version === undefined && next?.preferredCurrency && next.preferredCurrency !== values.currency) {
                  changeCurrency(next.preferredCurrency);
                }
              }}
              required
            >
              <option value="">Choose a customer…</option>
              {options.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ))}
          {label("Send to", errors.recipientContactId, (
            <select value={values.recipientContactId} onChange={(event) => set("recipientContactId", event.target.value)}>
              <option value="">{customer ? `${customer.name}${customer.email ? ` (${customer.email})` : ""}` : "The customer"}</option>
              {customer?.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` (${c.email})` : ""}</option>)}
            </select>
          ))}
          {label("Currency", errors.currency, (
            <select value={values.currency} onChange={(event) => changeCurrency(event.target.value)}>
              {options.currencies.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          ), "Every line is in this currency.")}
          {label("Prices", errors.taxMode, (
            <select value={values.taxMode} onChange={(event) => set("taxMode", event.target.value as QuoteValues["taxMode"])}>
              <option value="exclusive">Exclude tax (tax added on top)</option>
              <option value="inclusive">Include tax</option>
            </select>
          ))}
          {label("Issue date", errors.issuedOn, <input type="date" value={values.issuedOn} onChange={(e) => set("issuedOn", e.target.value)} required />)}
          {label(kind === "quote" ? "Valid until" : "Due date", errors[endKey], (
            <input type="date" value={values.endsOn} onChange={(e) => set("endsOn", e.target.value)} required />
          ))}
        </div>
        {errors.leadId ? <em role="alert" className="inline-error">{`Lead ${errors.leadId}`}</em> : null}

        <h4>Lines</h4>
        {notice ? <p role="status" className="form-hint quote-notice">{notice}</p> : null}
        {errors.lines ? <em role="alert" className="inline-error">{`Lines ${errors.lines}`}</em> : null}
        <div className="quote-lines" role="group" aria-label="Lines">
          <div className="quote-line quote-line-head" aria-hidden>
            <span>Description</span><span>Qty</span><span>Unit</span><span>Unit price</span><span>Discount</span><span>Tax</span><span>Amount</span><span />
          </div>
          {values.lines.map((line, index) => {
            const n = index + 1;
            const amount = lineAmounts[index];
            return (
              <div className="quote-line" key={line.key} role="group" aria-label={`Line ${n}`}>
                <div>
                  <textarea
                    aria-label={`Description ${n}`}
                    rows={1}
                    maxLength={2000}
                    value={line.description}
                    onChange={(e) => setLine(line.key, { description: e.target.value })}
                  />
                  {lineError(index, "description") ? <em role="alert">{`Description ${lineError(index, "description")}`}</em> : null}
                  {lineError(index, "productId") ? <em role="alert">{`Product ${lineError(index, "productId")}`}</em> : null}
                </div>
                <div>
                  <input aria-label={`Quantity ${n}`} inputMode="decimal" value={line.quantity} onChange={(e) => setLine(line.key, { quantity: e.target.value })} />
                  {lineError(index, "quantity") ? <em role="alert">{`Quantity ${lineError(index, "quantity")}`}</em> : null}
                </div>
                <input aria-label={`Unit ${n}`} maxLength={30} value={line.unit} onChange={(e) => setLine(line.key, { unit: e.target.value })} />
                <div>
                  <input aria-label={`Unit price ${n}`} inputMode="decimal" value={line.unitPrice} onChange={(e) => setLine(line.key, { unitPrice: e.target.value })} />
                  {lineError(index, "unitPrice") ? <em role="alert">{`Unit price ${lineError(index, "unitPrice")}`}</em> : null}
                </div>
                <div className="discount-cell">
                  <select
                    aria-label={`Discount type ${n}`}
                    value={line.discountKind}
                    onChange={(e) => setLine(line.key, { discountKind: e.target.value as LineValues["discountKind"], discount: "" })}
                  >
                    <option value="none">None</option>
                    <option value="percent">%</option>
                    <option value="fixed">{values.currency}</option>
                  </select>
                  {line.discountKind !== "none" ? (
                    <input aria-label={`Discount ${n}`} inputMode="decimal" value={line.discount} onChange={(e) => setLine(line.key, { discount: e.target.value })} />
                  ) : null}
                  {lineError(index, "discount") ? <em role="alert">{`Discount ${lineError(index, "discount")}`}</em> : null}
                </div>
                <div>
                  <select aria-label={`Tax ${n}`} value={line.taxRateId} onChange={(e) => setLine(line.key, { taxRateId: e.target.value })}>
                    <option value="">No tax</option>
                    {options.taxRates.map((rate) => <option key={rate.id} value={rate.id}>{rate.label}</option>)}
                  </select>
                  {lineError(index, "taxRateId") ? <em role="alert">{`Tax ${lineError(index, "taxRateId")}`}</em> : null}
                </div>
                <output aria-label={`Amount ${n}`}>{amount === null || amount === undefined ? "—" : show(amount)}</output>
                <button
                  type="button"
                  className="link-button danger"
                  aria-label={`Remove line ${n}`}
                  onClick={() => setValues((current) => ({ ...current, lines: current.lines.filter((l) => l.key !== line.key) }))}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <div className="row-buttons">
          <button type="button" className="link-button" onClick={() => set("lines", [...values.lines, newLine()])}>＋ Add a line</button>
          {options.products.length ? (
            <select aria-label="Add from catalogue" value="" onChange={(e) => addProduct(e.target.value)}>
              <option value="">＋ Add from catalogue…</option>
              {options.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.prices[values.currency] ? "" : ` (no ${values.currency} price)`}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {assist && kind === "quote" ? <QuoteAssist assist={assist} currency={values.currency} products={options.products} onAdd={addSuggested} /> : null}

        <dl className="quote-totals" aria-label="Totals">
          {totals ? (
            <>
              <div><dt>Subtotal{values.taxMode === "inclusive" ? " (including tax)" : ""}</dt><dd>{show(totals.subtotalMinor)}</dd></div>
              {totals.discountMinor > 0n ? <div><dt>Discounts included</dt><dd>{show(totals.discountMinor)}</dd></div> : null}
              {totals.taxes.map((tax) => (
                <div key={tax.key}>
                  <dt>{tax.name} {formatScaled(tax.milliPercent, 3)}%{values.taxMode === "inclusive" ? " included" : ""} on {show(tax.baseMinor)}</dt>
                  <dd>{show(tax.taxMinor)}</dd>
                </div>
              ))}
              <div className="grand-total"><dt>Total</dt><dd>{show(totals.totalMinor)}</dd></div>
            </>
          ) : (
            <div><dt>Total</dt><dd>Complete every line to see the total.</dd></div>
          )}
        </dl>

        <div className="form-grid">
          {label("Notes", errors.notes, <textarea rows={3} maxLength={5000} value={values.notes} onChange={(e) => set("notes", e.target.value)} />, "Shown to the customer.")}
          {label("Terms", errors.terms, <textarea rows={3} maxLength={5000} value={values.terms} onChange={(e) => set("terms", e.target.value)} />, "e.g. payment and delivery terms.")}
        </div>

        <div className="row-buttons">
          <button type="submit" className="new-button">{pending ? "Saving…" : submitLabel}</button>
        </div>
      </fieldset>
    </form>
  );
}

/** Momentum AI: lines suggested from the customer's request; a person adds the ones they want. */
function QuoteAssist({
  assist,
  currency,
  products,
  onAdd,
}: {
  assist: (request: string, currency: string) => Promise<AiResult<QuoteSuggestion>>;
  currency: string;
  products: BuilderOptions["products"];
  onAdd: (lines: QuoteSuggestion["lines"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [suggestion, setSuggestion] = useState<QuoteSuggestion | null>(null);
  if (!open) {
    return (
      <div className="row-buttons">
        <button type="button" className="link-button" onClick={() => setOpen(true)}>Suggest lines from the customer&apos;s request (AI)</button>
      </div>
    );
  }
  const name = (line: QuoteSuggestion["lines"][number]) => products.find((p) => p.id === line.productId)?.name ?? line.description;
  return (
    <div className="contact-form" role="group" aria-label="Quote assistance">
      {error ? <p role="alert" className="settings-message error">{error}</p> : null}
      <label className="settings-field">
        <span>What the customer asked for</span>
        <textarea rows={4} maxLength={4000} value={request} onChange={(e) => setRequest(e.target.value)} placeholder="Paste their message or describe the request" />
      </label>
      <div className="row-buttons">
        <button
          type="button"
          className="link-button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError("");
            const response = await assist(request, currency);
            setPending(false);
            if (response.status === "error") setError(response.fields ? Object.values(response.fields).join("; ") : response.message);
            else setSuggestion(response.result);
          }}
        >
          {pending ? "Thinking…" : "Suggest lines"}
        </button>
        <button type="button" className="link-button" onClick={() => setOpen(false)}>Close</button>
      </div>
      {suggestion ? (
        <>
          <p className="form-hint">Suggested by Momentum AI from the request and your catalogue. Prices come from your catalogue, never from AI.</p>
          <ul className="contact-list" aria-label="Suggested lines">
            {suggestion.lines.map((line, i) => (
              <li key={i}>
                <div><strong>{line.quantity} × {name(line)}</strong><small>{line.productId ? "From your catalogue" : "Not in your catalogue: enter a price"}</small></div>
                <div className="row-buttons"><button type="button" className="link-button" onClick={() => onAdd([line])}>Add</button></div>
              </li>
            ))}
          </ul>
          {suggestion.lines.length > 1 ? (
            <div className="row-buttons"><button type="button" className="link-button" onClick={() => onAdd(suggestion.lines)}>Add all lines</button></div>
          ) : null}
          {suggestion.questions.length ? (
            <>
              <p className="form-hint">To confirm with the customer:</p>
              <ul>{suggestion.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
