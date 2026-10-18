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
- Authorization policy core (`lib/tenancy`): explicit role permissions, session/membership dependency contract, and scoped resource checks with unit tests. Not yet wired to auth, database, or routes; see [`docs/authorization.md`](docs/authorization.md).
- Workspace domain core (`lib/workspaces`): global-settings validation, transactional onboarding contract, authorized version-checked updates, and audit event requirements. Unit tested; production adapters and UI remain pending. See [`docs/workspace-foundation.md`](docs/workspace-foundation.md).
- Routes: `/` marketing page, `/app` workspace dashboard preview (demo data, currency basis shown)

Next: Prisma + Postgres (Neon), Better Auth, organizations and memberships, server-side tenant guard with cross-tenant tests, organization settings, onboarding, audit log, Sentry.

## Run locally

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

## Checks

```bash
pnpm lint        # ESLint
pnpm typecheck   # next typegen + tsc
pnpm test        # Vitest
pnpm check       # all of the above
pnpm build
```

If dependencies cannot be installed, Node 22.18+ can run the dependency-free
domain tests with `node scripts/test-domain.mjs`. This does not replace the full
checks, type-checking, database integration tests, or build.

## Build principles

See `docs/product-spec.md` §20. In short:

- Every business record is organization-scoped and authorized server-side.
- Money is stored in integer minor units with an ISO 4217 currency code; never floating point; never mixed currencies in one sum.
- Published quotes and finalized invoices are immutable snapshots.
- Payment providers sit behind adapters and update state through verified, idempotent webhooks.
- AI drafts and recommends; people approve external communication.
- MomentumDesk integrates with accounting systems; it is not a general ledger.
