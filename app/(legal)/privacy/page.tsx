import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Privacy — MomentumDesk" };

/** What MomentumDesk actually collects and why (spec §12). Keep in step with the code. */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="20 November 2026">
      <h2>Who we are</h2>
      <p>
        MomentumDesk is provided by [LEGAL ENTITY NAME], [REGISTERED ADDRESS], [COUNTRY] (&quot;we&quot;). Contact us about privacy at
        [PRIVACY CONTACT EMAIL].
      </p>
      <p>
        Businesses use MomentumDesk to manage their own customers, leads, quotes, invoices and payments. For that business data the
        business is in charge (the controller) and we process it on its behalf. For our own users&apos; accounts, we are in charge.
      </p>

      <h2>What we keep</h2>
      <ul>
        <li><strong>Your account:</strong> name, email address, a hash of your password (never the password), your workspaces and roles, and sign-in sessions.</li>
        <li><strong>What your business enters:</strong> customers and contacts, leads, notes, tasks, products and prices, quotes, invoices, payments, refunds, collection notes and settings, including your logo.</li>
        <li><strong>When a customer opens a quote or invoice link:</strong> the time, IP address and browser description of each view, and the name and email given when accepting or rejecting a quote, as evidence of what happened.</li>
        <li><strong>A history of changes</strong> (audit log): who changed what and when, without the contents of documents or passwords.</li>
        <li><strong>Usage events</strong> such as &quot;quote sent&quot; or &quot;payment received&quot;, holding record ids only, kept in our own database to show you your metrics. We use no third-party tracking or advertising cookies.</li>
        <li><strong>AI usage:</strong> which AI task ran, when, for whom, the model, the number of tokens and the estimated cost. We do not keep the text sent to the AI or the AI&apos;s answer unless you save it.</li>
      </ul>

      <h2>Who else processes data</h2>
      <ul>
        <li><strong>Hosting:</strong> our servers and database at [HOSTING PROVIDER], [HOSTING LOCATION].</li>
        <li><strong>Email:</strong> Resend sends sign-in links, invitations, documents and reminders on our behalf.</li>
        <li><strong>Payments:</strong> when a business connects Paystack, Stripe or Bachs, its customers pay on that provider&apos;s own pages under the provider&apos;s terms. We never see or store card details. We store the business&apos;s provider keys encrypted.</li>
        <li><strong>AI (only if the business uses Momentum AI):</strong> [Anthropic / OpenAI, as configured] receives the facts needed for the task a person asked for, such as a lead&apos;s history or an invoice&apos;s amounts. Contact details are left out where the task does not need them. The provider&apos;s own data terms apply: [LINK TO PROVIDER TERMS].</li>
        <li><strong>Error monitoring:</strong> Sentry receives error reports with internal ids only. Email addresses, IP addresses, cookies, request bodies and tokens are removed before they leave our servers.</li>
        <li><strong>Exchange rates:</strong> Open Exchange Rates provides daily rates; no personal data is sent.</li>
      </ul>

      <h2>Cookies</h2>
      <p>One cookie keeps you signed in. It is needed for the service to work. We use no analytics or advertising cookies.</p>

      <h2>How long we keep data</h2>
      <p>
        A business&apos;s data is kept while its workspace is active. Customers and leads are archived rather than deleted so financial
        history stays complete. When a customer asks to be erased, their details, contacts, notes and visit records are removed; issued
        quotes and invoices, payments and acceptance records are kept as sent, because they are financial records the business may be
        required to keep. When an owner closes a workspace, it and all its data are deleted 30 days later (an owner can cancel until
        then). Backups are kept for [BACKUP RETENTION, e.g. 14 days] and then expire.
      </p>

      <h2>Your rights</h2>
      <p>
        You can see and correct your account details in the app, and owners and admins can download everything in their workspace (Settings → Your data). To ask
        for a copy of your data, its correction or deletion, or to object to processing, contact [PRIVACY CONTACT EMAIL]. If you are a
        customer of a business that uses MomentumDesk, please contact that business first; we will help it respond. You may also
        complain to [DATA PROTECTION AUTHORITY for the relevant country, e.g. NDPC in Nigeria, ODPC in Ghana or Kenya, the Information
        Regulator in South Africa, the ICO in the UK].
      </p>

      <h2>Security</h2>
      <p>
        Each business&apos;s data is separated twice: in the application and by the database itself. Connections are encrypted, payment
        provider keys are encrypted at rest, public document links are long random tokens stored only as hashes, and important
        financial and permission changes are logged.
      </p>

      <h2>Changes</h2>
      <p>We will tell account owners by email before material changes to this policy take effect.</p>
    </LegalPage>
  );
}
