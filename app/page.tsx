import Link from "next/link";

const journey = ["Leads", "Quotes", "Invoices", "Payments", "Collections"];

export default function MarketingHome() {
  return (
    <main className="flex min-h-screen flex-col bg-[#102c27] text-[#d9e7e1]">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-6 sm:px-6">
        <span className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-white">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#2bb48c] font-serif italic">
            M
          </span>
          MomentumDesk
        </span>
        <Link
          href="/sign-in"
          className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
        >
          Sign in
        </Link>
      </header>

      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-16 sm:px-6">
        <p className="mb-4 text-xs font-bold tracking-[0.2em] text-[#efc053]">
          AI REVENUE OPERATIONS FOR GROWING BUSINESSES
        </p>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-white sm:text-6xl">
          Turn enquiries into revenue.
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-[#a9bdb6] sm:text-lg">
          MomentumDesk brings your leads, quotations, invoices, payments, and follow-ups
          together—with AI helping your team move every opportunity from first conversation to
          final payment.
        </p>
        <ul className="mt-8 flex flex-wrap gap-2" aria-label="One desk for">
          {journey.map((step) => (
            <li
              key={step}
              className="rounded-full border border-[#2b574c] bg-[#183d35] px-3 py-1 text-sm text-[#d9e7e1]"
            >
              {step}
            </li>
          ))}
        </ul>
        <div className="mt-10">
          <Link
            href="/sign-up"
            className="inline-block rounded-lg bg-[#2f8d73] px-5 py-3 text-sm font-bold text-white hover:bg-[#35a083]"
          >
            Create your workspace →
          </Link>
        </div>
      </section>

      <footer className="mx-auto w-full max-w-5xl px-4 py-6 text-xs text-[#739087] sm:px-6">
        Early access · Pilot in progress
      </footer>
    </main>
  );
}
