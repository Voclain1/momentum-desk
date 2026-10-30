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

Next: Sentry, deployment.

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
