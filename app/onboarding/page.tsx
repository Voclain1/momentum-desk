import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasWorkspace, requireUser } from "@/lib/auth/session";
import { COUNTRY_CODES } from "@/lib/geo/countries";
import { CURRENCY_EXPONENTS } from "@/lib/money";
import { OnboardingForm, type Option } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your workspace — MomentumDesk" };

/** Languages offered for customer documents. The interface itself is English for now. */
const DOCUMENT_LANGUAGES = ["en", "fr", "pt", "es", "de", "ar", "sw", "yo", "ha", "ig", "zu", "hi", "zh", "ja"];

function options(codes: readonly string[], type: "region" | "currency" | "language"): Option[] {
  const names = new Intl.DisplayNames(["en"], { type });
  return codes
    .map((value) => ({ value, label: `${names.of(value) ?? value} (${value})` }))
    .sort((a, b) => a.label.localeCompare(b.label, "en"));
}

export default async function OnboardingPage() {
  const { user } = await requireUser();
  if (await hasWorkspace(user.id)) {
    redirect("/app");
  }

  return (
    <main className="min-h-screen bg-[#f6f7f3] px-4 py-10 text-[#172126]">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#2bb48c] font-serif italic text-white">
            M
          </span>
          MomentumDesk
        </Link>
        <h1 className="mt-10 text-3xl font-bold tracking-tight">Set up your workspace</h1>
        <p className="mt-2 text-sm text-[#718087]">
          These settings are independent: a business can be registered in one country, report in
          another currency and invoice customers in several. You can change them later.
        </p>
        <div className="mt-8 rounded-xl border border-[#e7ece9] bg-white p-6 shadow-sm sm:p-8">
          <OnboardingForm
            countries={options(COUNTRY_CODES, "region")}
            currencies={options(Object.keys(CURRENCY_EXPONENTS), "currency")}
            languages={options(DOCUMENT_LANGUAGES, "language")}
            timezones={["UTC", ...Intl.supportedValuesOf("timeZone")]}
          />
        </div>
      </div>
    </main>
  );
}
