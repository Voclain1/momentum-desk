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
- Deploys: Vercel runs `vercel-build`, which applies migrations as the owner and then builds; production refuses to deploy without `MIGRATION_DATABASE_URL`

**Going live:** [`docs/go-live.md`](docs/go-live.md) lists every account, key and setup step in order.

## M1 (customers, leads and pipeline): in progress

- Customers and contacts (`/app/customers`, `lib/customers`): people or organizations with contact, address, tax and preference details (preferred currency is a default only), tags and notes; several contacts each, one primary. Search across names, emails, tax IDs, contacts and tags; filter, sort and page. Archive and restore instead of delete. Version-checked edits, audited by field name. Owner, admin, sales and finance can view and edit; member cannot
- Leads and pipeline (`/app/leads`, `/app/pipeline`, `lib/leads`): leads with contact details, source, owner, estimated value and currency (exact minor units), need, next follow-up date, tags and notes. One pipeline per workspace with default stages (New, Contacted, Qualified, Quote / proposal, Won, Lost) created on first use; logic follows each stage's kind (open, won, lost), not its name. The board shows counts and per-currency totals (currencies are never added together) and moves leads between stages; the list filters by status, stage, owner, source and follow-up (overdue, today, next 7 days, in the workspace's timezone). Owner, admin and sales can use them; finance and member cannot
- Activity, notes and tasks (`lib/activities`, `lib/tasks`): every lead and customer has a timeline of notes and logged calls, emails, meetings and messages (back-dated in the workspace's timezone; authors edit their own, managers can remove), merged with the record's history from the audit log. Tasks have a due date and assignee and can be about a lead, a customer or nothing; `/app/tasks` groups them (overdue, today, next 7 days, later, no date, done) and the dashboard shows your overdue and due-today counts. Notes and tasks inherit their record's permission, so finance never sees lead tasks. Reminders are in the app; emailed reminders wait for background jobs (D18)
- Conversion and duplicates (`lib/leads/conversion.ts`, `lib/records/duplicates.ts`): a lead converts into a new customer (a company's contact person becomes its primary contact) or is linked to an existing customer it resembles; the lead keeps its timeline and tasks, and both records show the link. Possible duplicates by email, phone or name are listed on lead and customer pages and never merged automatically (D28). Converting needs sales and customer write access
- Import and export (`/app/import`, `lib/transfer`, `lib/csv.ts`): customers and leads to and from CSV for owners and admins (D29). Imports check every row with the form rules and save nothing if any row fails, listing each problem by line and column; exports guard against spreadsheet formula injection

**Email** needs `RESEND_API_KEY` and `EMAIL_FROM` (a sender on a domain verified in Resend). Without them, development prints sign-in, reset and invitation links in the server log, and production refuses to send them; email and password sign-in still works.

## Run locally

Needs Node 20.9+, pnpm and PostgreSQL 16 (local, Docker, or a Neon branch).

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
