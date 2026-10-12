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

Next: tenant guard for organization-owned data with cross-tenant tests, invitations and team management, settings page, business permission matrix, audit log, Sentry.

**Email is not connected yet** (decision D17). In development, sign-in and reset links are printed in the server log. In production, magic links and password resets fail with a clear error until a provider is chosen; email and password sign-in works.

## Run locally

Needs Node 20.9+, pnpm and PostgreSQL 16 (local, Docker, or a Neon branch).

```bash
pnpm install                  # also generates the Prisma client
cp .env.example .env.local    # set BETTER_AUTH_SECRET, DATABASE_URL, TEST_DATABASE_URL
createdb momentum_dev && createdb momentum_test
pnpm db:deploy                # apply migrations
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
