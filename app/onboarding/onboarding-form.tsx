"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { currencyExponent, formatMoney, isCurrencyCode, money } from "@/lib/money";
import { slugify } from "@/lib/organizations/slug";

export interface Option {
  value: string;
  label: string;
}

const inputClass =
  "w-full rounded-lg border border-[#d5ddd9] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#167a62] focus:ring-2 focus:ring-[#167a62]/20";

function Label({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <>
      <span className="mb-1.5 block text-sm font-semibold">{children}</span>
      {hint ? <span className="-mt-1 mb-1.5 block text-xs text-[#718087]">{hint}</span> : null}
    </>
  );
}

function Select({
  name,
  options,
  placeholder,
  value,
  onChange,
  required = true,
}: {
  name: string;
  options: Option[];
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <select
      name={name}
      required={required}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={inputClass}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** A sample amount (1,234,567 and the currency's full minor units) in the chosen locale. */
function formatPreview(locale: string, currency: string): string {
  if (!isCurrencyCode(currency)) return "";
  try {
    const minor = BigInt(`1234567${"8".repeat(currencyExponent(currency))}`);
    return formatMoney(money(minor, currency), locale);
  } catch {
    return "";
  }
}

const noSubscription = () => () => {};

function browserLocale(): string {
  try {
    return Intl.getCanonicalLocales(navigator.language)[0] ?? "en";
  } catch {
    return "en";
  }
}

/** A short random suffix so two workspaces with the same name get different slugs. */
function slugSuffix(): string {
  return crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 5);
}

export function OnboardingForm({
  countries,
  currencies,
  languages,
  timezones,
}: {
  countries: Option[];
  currencies: Option[];
  languages: Option[];
  timezones: string[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("");
  const [defaultInvoiceCurrency, setDefaultInvoiceCurrency] = useState("");
  const [defaultLanguage, setDefaultLanguage] = useState("en");
  // Suggest the browser's timezone and locale until the user picks their own.
  // The server render uses UTC and "en"; the browser's values follow hydration.
  const browserZone = useSyncExternalStore(
    noSubscription,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "UTC",
  );
  const suggestedLocale = useSyncExternalStore(noSubscription, browserLocale, () => "en");
  const [chosenLocale, setLocale] = useState<string | null>(null);
  const [chosenTimezone, setTimezone] = useState<string | null>(null);
  const locale = chosenLocale ?? suggestedLocale;
  const timezone = chosenTimezone ?? (timezones.includes(browserZone) ? browserZone : "UTC");

  const localeSuggestions = useMemo(() => {
    const suggestions = new Set<string>();
    if (countryCode) suggestions.add(`${defaultLanguage}-${countryCode}`);
    suggestions.add(defaultLanguage);
    if (countryCode) suggestions.add(`en-${countryCode}`);
    return [...suggestions];
  }, [countryCode, defaultLanguage]);

  const preview = formatPreview(locale, baseCurrency);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    setPending(true);
    setError("");
    const { error } = await authClient.organization.create({
      name,
      slug: `${slugify(name)}-${slugSuffix()}`,
      baseCurrency,
      countryCode,
      locale,
      timezone,
      defaultLanguage,
      ...(defaultInvoiceCurrency ? { defaultInvoiceCurrency } : {}),
    });
    if (error) {
      setError(authErrorMessage(error));
      setPending(false);
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error ? (
        <p role="alert" className="rounded-lg bg-[#fff1ef] px-3 py-2 text-sm text-[#a5413a]">
          {error}
        </p>
      ) : null}

      <label className="block">
        <Label>Business name</Label>
        <input name="name" required maxLength={100} autoComplete="organization" className={inputClass} />
      </label>

      <label className="block">
        <Label hint="Where the business is registered.">Country</Label>
        <Select
          name="countryCode"
          options={countries}
          placeholder="Choose a country"
          value={countryCode}
          onChange={setCountryCode}
        />
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <Label hint="Used for reports and dashboard totals.">Base currency</Label>
          <Select
            name="baseCurrency"
            options={currencies}
            placeholder="Choose a currency"
            value={baseCurrency}
            onChange={setBaseCurrency}
          />
        </label>
        <label className="block">
          <Label hint="Optional. Each quote and invoice still has its own currency.">
            Default invoice currency
          </Label>
          <Select
            name="defaultInvoiceCurrency"
            options={currencies}
            placeholder="None"
            value={defaultInvoiceCurrency}
            onChange={setDefaultInvoiceCurrency}
            required={false}
          />
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <Label hint="For quotes, invoices and reminders.">Document language</Label>
          <Select
            name="defaultLanguage"
            options={languages}
            placeholder="Choose a language"
            value={defaultLanguage}
            onChange={setDefaultLanguage}
          />
        </label>
        <label className="block">
          <Label hint="Schedules and due dates follow this timezone.">Timezone</Label>
          <select
            name="timezone"
            required
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className={inputClass}
          >
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <Label hint="How numbers and dates are written, as a language-region code such as en-GB.">
          Formatting locale
        </Label>
        <input
          name="locale"
          required
          list="locale-suggestions"
          value={locale}
          onChange={(event) => setLocale(event.target.value.trim())}
          className={inputClass}
        />
        <datalist id="locale-suggestions">
          {localeSuggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
        {preview ? (
          <span className="mt-1.5 block text-xs text-[#718087]">
            Amounts will look like <strong className="text-[#172126]">{preview}</strong>
          </span>
        ) : null}
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-[#167a62] px-4 py-3 text-sm font-bold text-white hover:bg-[#13695a] disabled:opacity-60"
      >
        {pending ? "Creating workspace…" : "Create workspace"}
      </button>
    </form>
  );
}
