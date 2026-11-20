import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Terms — MomentumDesk" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="20 November 2026">
      <h2>The agreement</h2>
      <p>
        These terms are between [LEGAL ENTITY NAME] (&quot;we&quot;) and the business that creates a MomentumDesk workspace (&quot;you&quot;).
        The person who signs up confirms they may accept them for that business. [GOVERNING LAW AND COURTS: e.g. the laws of
        COUNTRY, courts of CITY].
      </p>

      <h2>What MomentumDesk does and does not do</h2>
      <ul>
        <li>It helps you manage leads, quotes, invoices, payments and collections. It is not an accounting ledger, a bank or a payment processor.</li>
        <li>Money is paid to your own payment provider account (Paystack, Stripe or Bachs). We never hold it. Each provider&apos;s own terms and fees apply.</li>
        <li>Tax lines are calculated from the rates you set. We do not guarantee tax compliance in any jurisdiction; check with your adviser.</li>
        <li>Exchange-rate conversions are for reporting only and show their source and date. They are not a quote for exchanging money.</li>
        <li>Momentum AI drafts and suggests. You review, edit and decide what to send. It is checked against your records but can still be wrong.</li>
      </ul>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Keep sign-in details safe, and give team members only the roles they need.</li>
        <li>Have the right to put your customers&apos; data into MomentumDesk and to contact them, including by automatic payment reminders, which stay off until you turn them on.</li>
        <li>Do not use MomentumDesk for unlawful, fraudulent or abusive purposes, or try to reach other workspaces&apos; data.</li>
      </ul>

      <h2>Your data</h2>
      <p>
        Your business data is yours. We use it only to provide the service as described in the <Link href="/privacy">privacy policy</Link>.
        You can export customers and leads at any time, and documents as PDF.
      </p>

      <h2>Pilot and availability</h2>
      <p>
        During the pilot the service is provided [FREE OF CHARGE / AT THE AGREED PRICE] and may change. We aim for it to be available
        and back up data daily, but do not promise uninterrupted service. [SUPPORT CONTACT AND HOURS].
      </p>

      <h2>Liability</h2>
      <p>[LIMITATION OF LIABILITY, WARRANTIES AND INDEMNITIES: to be written by a lawyer for the pilot markets.]</p>

      <h2>Ending</h2>
      <p>
        You may stop using MomentumDesk at any time. We may suspend a workspace that breaks these terms, telling you why where we can.
        After closure, data is handled as the privacy policy describes.
      </p>
    </LegalPage>
  );
}
