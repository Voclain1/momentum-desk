# MomentumDesk

AI Revenue Operations for growing businesses. MomentumDesk connects the path from enquiry to quote, invoice, payment and collected revenue in one workspace.

- **Product specification:** [`docs/product-spec.md`](docs/product-spec.md) — scope, principles and milestones (M0–M7).
- **Decisions log:** [`docs/decisions.md`](docs/decisions.md) — every technical and product decision, open or made.

## Current state — M0 (global SaaS foundation), in progress

Done:

- Next.js 16 App Router, TypeScript, pnpm
- Lint, type-check, unit-test commands and GitHub Actions CI
- Environment validation at startup (`lib/env.ts`)
- Money foundation (`lib/money`): integer minor units as `bigint`, explicit ISO 4217 exponents (zero- and three-decimal currencies), currency-safe arithmetic, locale-aware formatting
- Routes: `/` marketing page, `/app` workspace dashboard preview (demo data, currency basis shown)
- Database: PostgreSQL with Prisma 7 (`prisma/schema.prisma`, client in `lib/db`). Tables for users, sessions, accounts, organizations, memberships and invitations in the shape Better Auth expects; organization global settings (§5.1) with database CHECK constraints; all timestamps `timestamptz`
- Organization settings validation (`lib/organizations/settings.ts`): ISO 4217 currencies, ISO 3166 countries (explicit table in `lib/geo/countries.ts`), BCP 47 locales and languages, IANA timezones
- Authentication (Better Auth, `lib/auth`): email and password, magic link, password reset, sign-out. Rate limits stored in Postgres. Sign-in pages at `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`
- Workspaces: `/onboarding` creates an organization with its global settings; the creator becomes owner. Roles owner, admin, sales, finance, member (§10); only owners and admins change settings, only owners delete
- `/app` requires a session and a workspace membership, both checked on the server (`lib/auth/session.ts`); `proxy.ts` only redirects visitors with no session cookie

- Tenant isolation ([`docs/tenant-isolation.md`](docs/tenant-isolation.md)): organization data only through `requireTenant()` / `tenantDb()`, plus Postgres row-level security, with the app connecting as a restricted role. Cross-tenant tests at the unit, database and browser level
- Audit log: append-only, records workspace creation, settings changes, member and invitation changes with the acting user; shown on the dashboard as Recent activity
- Permissions ([`docs/authorization.md`](docs/authorization.md)): per-role business permission matrix; every server entry point asks `requireTenant(permission)`. Admins cannot create, change or remove owners
- Settings page (`/app/settings`): owners and admins edit name, country, locale, timezone, document language and default invoice currency. Saves re-check permission in the transaction, reject stale versions (two tabs cannot overwrite each other) and write the audit entry atomically. The base currency is fixed after creation, also enforced by a database trigger

- Team (`/app/team`): everyone sees members and roles; owners and admins invite (emailed through Resend, plus a copyable link), change roles, remove members and cancel invitations. Invitees accept at `/invite/{id}` after signing in or up with the invited address and confirming it. Invitations expire after 7 days; inviting again replaces the old link

- Email through Resend (`lib/email`): sign-in links, password resets, email confirmation and invitations. Plain HTTP API, 10-second timeout, errors never include the key or recipient
- Error monitoring through Sentry (`instrumentation.ts`, `lib/observability`): server, edge and browser errors; off unless `NEXT_PUBLIC_SENTRY_DSN` is set. No session replay; every event is scrubbed of emails, IPs, cookies, auth headers, request bodies, one-time tokens and local variables before it leaves the app
- Health check: `GET /api/health` returns 200 when the app and database are up, 503 otherwise
- Deploys (D9): one VPS with Docker Compose (`Dockerfile`, `deploy/`): PostgreSQL, the web server, the background worker and Caddy for HTTPS. `deploy/deploy.sh` runs migrations and grants first and leaves the running app alone if they fail; `deploy/backup.sh` takes nightly dumps

**Going live:** [`docs/go-live.md`](docs/go-live.md) lists every account, key and setup step in order.

## M1 (customers, leads and pipeline): done

- Customers and contacts (`/app/customers`, `lib/customers`): people or organizations with contact, address, tax and preference details (preferred currency is a default only), tags and notes; several contacts each, one primary. Search across names, emails, tax IDs, contacts and tags; filter, sort and page. Archive and restore instead of delete. Version-checked edits, audited by field name. Owner, admin, sales and finance can view and edit; member cannot
- Leads and pipeline (`/app/leads`, `/app/pipeline`, `lib/leads`): leads with contact details, source, owner, estimated value and currency (exact minor units), need, next follow-up date, tags and notes. One pipeline per workspace with default stages (New, Contacted, Qualified, Quote / proposal, Won, Lost) created on first use; logic follows each stage's kind (open, won, lost), not its name. The board shows counts and per-currency totals (currencies are never added together) and moves leads between stages; the list filters by status, stage, owner, source and follow-up (overdue, today, next 7 days, in the workspace's timezone). Owner, admin and sales can use them; finance and member cannot
- Activity, notes and tasks (`lib/activities`, `lib/tasks`): every lead and customer has a timeline of notes and logged calls, emails, meetings and messages (back-dated in the workspace's timezone; authors edit their own, managers can remove), merged with the record's history from the audit log. Tasks have a due date and assignee and can be about a lead, a customer or nothing; `/app/tasks` groups them (overdue, today, next 7 days, later, no date, done) and the dashboard shows your overdue and due-today counts. Notes and tasks inherit their record's permission, so finance never sees lead tasks. Reminders are in the app; emailed reminders wait for background jobs (D18)
- Conversion and duplicates (`lib/leads/conversion.ts`, `lib/records/duplicates.ts`): a lead converts into a new customer (a company's contact person becomes its primary contact) or is linked to an existing customer it resembles; the lead keeps its timeline and tasks, and both records show the link. Possible duplicates by email, phone or name are listed on lead and customer pages and never merged automatically (D28). Converting needs sales and customer write access
- Import and export (`/app/import`, `lib/transfer`, `lib/csv.ts`): customers and leads to and from CSV for owners and admins (D29). Imports check every row with the form rules and save nothing if any row fails, listing each problem by line and column; exports guard against spreadsheet formula injection

## M2 (catalogue and quotes): done, except the visual design and quote-to-invoice conversion (M3)

- Decisions D12–D16 (`docs/decisions.md`): exact bigint arithmetic with fixed rounding points, per-currency catalogue prices, configurable tax rates, quote acceptance confirmed by an emailed code, hashed share links valid until revoked or superseded
- Document arithmetic (`lib/documents/calc.ts`): line and document totals, tax-exclusive and tax-inclusive, with tests in 0-, 2- and 3-decimal currencies
- Tax rates (Settings) and the catalogue (`/app/catalogue`, `lib/catalogue`): products and services with optional SKU, unit, category, default tax and one price per currency (never converted). Owners and admins edit; sales and finance can read
- Quotes (`/app/quotes`, `lib/quotes`): a builder with lines from the catalogue (priced in the quote's currency) or typed, per-line discounts and tax, live totals using the same arithmetic as the server, tax-exclusive or tax-inclusive, notes and terms. Numbering is configurable in Settings (prefix, next number, digits) and never repeats. Drafts are edited freely; "Mark as sent" fixes the content and the customer's details. "Revise" starts the next revision as a draft; sending it supersedes the previous one, and every revision is kept. Accepted quotes can never be revised. A database trigger refuses any change to a sent quote's content whatever code runs. Quotes can start from a customer or a converted lead. Owner, admin and sales; finance and member cannot see them
- Sharing and the customer's answer (`/q/{token}`, `lib/quotes/sharing.ts`, `lib/quotes/public.ts`): staff email a sent quote to its recipient or create a link to send themselves (shown once; only its hash is stored) and can revoke links. The customer, without an account, sees the quote as sent; the first view is recorded. Accepting takes their name and a 6-digit code emailed to the quote's recipient (10 minutes, 5 attempts, 5 codes an hour); the acceptance records name, verified email, time, IP address, browser and a fingerprint of the exact version, and is labelled as acceptance, not an e-signature. Declining needs no code and can give a reason. Expired quotes stay visible but can't be answered; links to a replaced revision show only a notice. The quote page lists this evidence, which the database keeps append-only
- Quote PDF (`lib/documents/quote-pdf.ts`): drawn from the same copied snapshot as the web view (`lib/documents/present.ts`), A4, with the DejaVu Sans font embedded so every currency sign prints; long descriptions wrap and the table continues across pages. Staff download any revision (`/app/quotes/{id}/pdf`, drafts marked "DRAFT"); customers download from their link (`/q/{token}/pdf`), which stops with the link. Plain layout until the design system
- Not yet: logo and brand colours on documents (with the design system), quote-to-invoice conversion (start of M3)

## M3 (invoicing): done, except the visual design

- Decisions D30–D34 (`docs/decisions.md`): numbers at issue without gaps, issued invoices never change (void with a reason, then reissue), manual payments in the invoice currency without overpayment, accepted quotes convert once and verbatim, base-currency reporting in M5
- Invoices (`/app/invoices`, `lib/invoices`): direct invoices with the same builder as quotes, or from an accepted quote ("Invoice this quote", or the list on the new-invoice page for finance), copying its lines and amounts exactly. Issuing assigns the next number and copies the payment instructions from Settings. Status is derived: issued, viewed, partly paid, paid, overdue, disputed, void. Disputes need a reason; voiding needs `invoices:void` (owner, admin), a reason and no valid payments. Owner, admin and finance; sales and member cannot see invoices
- Payments (`lib/payments`): recorded by owner, admin or finance in the invoice's currency, never above what is owed and never dated in the future; voided with a reason, never deleted. The database keeps each invoice's paid and owed amounts from valid allocations and refuses overpayment, currency or customer mismatches, and payments to drafts or void invoices
- Settings: invoice numbering, payment instructions and default days until due
- Sharing and the customer's invoice (`/i/{token}`, `lib/invoices/sharing.ts`, `lib/invoices/public.ts`): staff email an issued invoice to its recipient or create a link (shown once, stored as a hash) and can revoke links. The customer, without an account, sees what is owed and by when, payments made, "paid in full" or "cancelled", and how to pay; views are recorded (first view on the invoice, then per half hour) and listed on the invoice page
- Invoice PDF (`lib/documents/invoice-pdf.ts`): the shared document layout with paid, balance due, how to pay, and DRAFT / VOID stamps; staff download from `/app/invoices/{id}/pdf`, customers from `/i/{token}/pdf`
- Later: online payment through providers (M4), reminders and collections (M5)

## M4 (payments): done, except confirming Bachs in its sandbox

- D19 (owner): Paystack, Stripe and Bachs, for pilots in Nigeria, Ghana, Kenya, South Africa and the UK/US/EU; D35–D36 proposed (`docs/decisions.md`)
- Provider adapters (`lib/payments/providers`): one interface for checkout, payment lookup and webhook signatures; Paystack and Stripe follow their documented APIs, Bachs is to be confirmed in its sandbox (`docs/go-live.md`)
- Connections (Settings → Payment providers, owners and admins): each workspace's own account; keys encrypted with `PROVIDER_SECRETS_KEY`, shown once as a hint; a webhook URL per connection
- Online payment: customers pay from the invoice's public link through the provider's checkout. Signed webhooks (`/api/webhooks/{provider}/{connection}`) and the customer's return both make our server ask the provider's API; the payment is recorded once per provider reference, however many deliveries arrive; amounts above what was owed are kept and flagged for refund; mismatched or forged events are refused
- Refunds (D37, `lib/payments/refunds.ts`, owners and admins): from any payment on the invoice page, through Paystack or Stripe, or recorded when the business paid the customer back another way (and for Bachs for now). A refund first takes back money received beyond what was owed, then reopens what the invoice owes; the database refuses refunds beyond what is left of a payment. Provider refunds are confirmed by the provider's webhook or "Check status"; a failed one gives the amounts back. A refunded payment can no longer be voided as a mistake
- Tests run against a local stand-in for the providers (`e2e/mock-providers.mjs`, `PAYMENTS_TEST_API`, localhost only)

End-to-end tests read emails from `e2e/.outbox/emails.jsonl` (`EMAIL_TEST_OUTBOX`, set by `playwright.config.ts`); the app refuses that setting unless `APP_URL` is localhost.

## M5 (receivables and reminders): done, except the visual design

- Background jobs (D18, `lib/jobs`, `pnpm worker`): a PostgreSQL queue enqueued in the same transaction as the change that causes it; workers claim with `FOR UPDATE SKIP LOCKED`, retry with back-off and give up after the last attempt. Failed jobs show in Settings with a Retry button. Daily jobs run once per workspace per local day
- Receivables (`/app/receivables`, `lib/receivables`): ageing (current, 1–30, 31–60, 61–90, 90+) per currency, and in the base currency only when every currency has a rate (otherwise it says which are missing). Filters by age and "mine"
- Exchange rates (D38, `lib/fx`): daily from Open Exchange Rates when `FX_PROVIDER_KEY` is set, plus rates staff enter in Settings, which win on the same day. Every rate keeps its source and date and is never edited; rates older than 7 days are marked stale
- Collections (invoice page): an owner, pause until a date with a reason, escalate to a person, promises to pay (judged kept or broken by what was actually paid by the date) and internal notes, all audited
- Payment reminders (`lib/reminders`, Settings): off until an owner turns them on. Steps 3 days before and 1, 7, 14 and 30 days after due, with fixed friendly, firm and final wording that states what is owed on the day. Only the latest due step is sent (never a backlog), with a minimum gap between reminders. Each step is checked again just before sending and stops for payment, void, dispute, pause, escalation, an open promise or opt-out; the invoice page lists every step with its reason. Customers stop reminders from their invoice link; staff can stop or restart them per customer

**Email** needs `RESEND_API_KEY` and `EMAIL_FROM` (a sender on a domain verified in Resend). Without them, development prints sign-in, reset and invitation links in the server log, and production refuses to send them; email and password sign-in still works.

## Run locally

Needs Node 20.9+, pnpm and PostgreSQL 16 (local or Docker).

```bash
pnpm install                  # also generates the Prisma client
cp .env.example .env.local    # set BETTER_AUTH_SECRET, DATABASE_URL, TEST_DATABASE_URL
createdb momentum_dev && createdb momentum_test
pnpm db:deploy                # apply migrations as the owner (MIGRATION_DATABASE_URL)
# create the restricted app role and grant it access (docs/tenant-isolation.md)
psql -d momentum_dev -c "CREATE ROLE momentum_app LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS"
psql -d momentum_dev -v app_role=momentum_app -f prisma/sql/app-role.sql
psql -d momentum_test -v app_role=momentum_app -f prisma/sql/app-role.sql
pnpm dev
```

## Database

```bash
pnpm db:migrate    # after editing prisma/schema.prisma: create and apply a migration
pnpm db:deploy     # apply pending migrations (CI, production)
pnpm db:check      # fail if the database and schema differ
pnpm db:studio     # browse data
```

Migrations are committed under `prisma/migrations`. CHECK constraints that Prisma's schema language cannot express are written into the migration SQL by hand.

## Checks

```bash
pnpm lint        # ESLint
pnpm typecheck   # next typegen + tsc
pnpm test        # Vitest unit tests
pnpm test:db     # Vitest database tests against TEST_DATABASE_URL (name must end in _test)
pnpm test:e2e    # Playwright: builds the app and runs browser tests against TEST_DATABASE_URL
pnpm check       # lint, typecheck and unit tests
pnpm build
```

## Build principles

See `docs/product-spec.md` §20. In short:

- Every business record is organization-scoped and authorized server-side.
- Money is stored in integer minor units with an ISO 4217 currency code; never floating point; never mixed currencies in one sum.
- Published quotes and finalized invoices are immutable snapshots.
- Payment providers sit behind adapters and update state through verified, idempotent webhooks.
- AI drafts and recommends; people approve external communication.
- MomentumDesk integrates with accounting systems; it is not a general ledger.
