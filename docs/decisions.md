# MomentumDesk — Decisions Log

The product specification (`docs/product-spec.md`, §19) requires that open technical and product decisions are made explicitly, not hidden inside implementation. Record each one here when it is made or changed.

Status values: **Accepted** (in force), **Proposed** (recommended, awaiting confirmation), **Open** (not yet decided), **Superseded**.

| # | Decision | Status | Choice | Notes |
|---|---|---|---|---|
| D1 | Repository name and visibility | Accepted (name) / Open (visibility) | `voclain1/momentum-desk` | Visibility to be confirmed by owner. |
| D2 | Application framework | Accepted | Next.js 16 (App Router), React 19, TypeScript, pnpm | Already bootstrapped. Follow the bundled docs in `node_modules/next/dist/docs/` (see `AGENTS.md`). |
| D3 | Authentication provider | Accepted | Better Auth 1.7 (email/password + magic link, organization plugin) | Prisma adapter, database sessions (no cookie cache, so revocation is immediate), rate limits stored in Postgres. Browser forms call Better Auth's HTTP endpoints, not server actions, because rate limiting only applies there. Passwords 12–128 characters. Email verification is not required to sign in until D17 is decided, but accepting an invitation requires a verified email. Alternative considered: Clerk. |
| D4 | Database and hosting | Accepted | PostgreSQL on Neon | Branch-per-preview fits §11 preview/production separation. Backup and recovery procedure to be documented before pilot (M7). |
| D5 | Typed data layer | Accepted | Prisma 7 (`prisma-client` generator, `@prisma/adapter-pg` driver adapter) | Same adapter for local Postgres, CI and Neon (pooled connection string in the app). All timestamps `timestamptz`. Format CHECK constraints are hand-written in migration SQL. Auth and organization tables follow Better Auth 1.7's expected shape so D3 needs no table renames. |
| D6 | Testing | Accepted | Vitest (unit/integration), Playwright (end-to-end) | Playwright added with auth/onboarding; runs the production build against the disposable test database. |
| D7 | CI | Accepted | GitHub Actions: lint, type-check, test, build on every push and pull request | `.github/workflows/ci.yml` |
| D8 | Error monitoring | Accepted | Sentry | Wired up with authentication in M0. |
| D9 | Deployment | Accepted (target) / Open (setup) | Vercel, production and preview environments, `momentumdesk.app` | Domain ownership and Vercel project to be confirmed by owner. |
| D10 | Money representation | Accepted | Integer minor units as `bigint` + ISO 4217 code; minor-unit exponent from an explicit ISO 4217 table in `lib/money/currencies.ts`, never inferred from `Intl` or locale | Floating point is never used for amounts. |
| D11 | Money formatting | Accepted | `Intl.NumberFormat` with the decimal **string** of the amount (no float conversion), fraction digits forced to the ISO 4217 exponent | Locale and currency are always passed explicitly. |
| D12 | Decimal arithmetic library and rounding policy | Open (M2/M3) | — | Needed for tax, discounts, FX and allocation. Must be decided before the quote builder. |
| D13 | Per-currency catalogue pricing vs manual line items (V1) | Open (M2) | — | |
| D14 | Tax handling boundaries for pilot markets | Open (M2) | — | |
| D15 | Quote acceptance evidence / e-signature | Open (M2) | — | |
| D16 | Public document token expiry and revocation | Open (M2) | — | |
| D17 | Transactional email provider | Open — now blocking production auth emails | — | Provider-neutral `EmailSender` in `lib/email`. Until decided, production cannot send magic links, password resets or verification emails. |
| D18 | Background job / queue service | Open (M3/M5) | — | Must support retries, idempotency and a transactional outbox (§11). |
| D19 | Payment providers for first pilot markets | Open (M4) | — | Requires eligibility/currency research per §6. |
| D20 | AI provider, data handling and usage limits | Open (M6) | — | Behind a provider-neutral `AIService`. |
| D21 | Route layout | Accepted | `/` marketing, `/app` authenticated workspace, `/q/{token}` and `/i/{token}` public documents | From §13. |
| D22 | Tenant isolation | Accepted | Two independent layers: `tenantDb()` scopes every query in the app, and Postgres row-level security (forced) filters by a transaction-local organization setting. The app connects as a restricted role without `BYPASSRLS`; migrations use a separate owner URL | See `docs/tenant-isolation.md`. Neon's default owner role bypasses RLS, hence the role split. Cost: each tenant query runs in a short transaction (one extra round trip). |
| D23 | Base currency after creation | Accepted | Fixed. The settings service refuses it and a database trigger rejects the change from any path | Spec §5.4: reports must keep their meaning. Rebasing needs a future decision on exchange-rate history. From the Codex workspace-foundations work. |
| D24 | Changing workspace settings | Accepted | Only through `lib/workspaces/settings-service.ts`: permission re-checked inside a serialisable transaction, compare-and-set on `settingsVersion`, audit entry in the same transaction. Better Auth's organization update endpoint is disabled | Design from the Codex workspace-foundations work, implemented on Prisma and Postgres. |

## Change history

- 2026-10-11 — Log created. D3–D9 accepted by the owner from the M0 recommendations. D10, D11 and D21 adopted for the M0 foundation.
- 2026-10-12 — D5 detailed: Prisma 7.10 with the pg driver adapter; first migration adds auth, organization, membership and invitation tables plus organization settings.
- 2026-10-12 — D3 implemented with Better Auth 1.7.7; D6 Playwright added; D17 marked as blocking production auth emails. Country codes now validated against an explicit ISO 3166-1 table (`lib/geo/countries.ts`), following the D10 approach.
- 2026-10-13 — D22 accepted: tenant guard, row-level security and restricted app role; audit log added as the first tenant table.
- 2026-10-18 — Reviewed the Codex branch `codex/m0-workspace-foundations` (`e0e033d`), which was written in parallel without the database, auth or tenant work. Adopted: the business permission matrix (now `lib/auth/authorization.ts`), base currency fixed after creation (D23), transactional and version-checked settings changes with atomic audit (D24), rejecting unknown input fields, normalising locale and country input, field-name-only validation errors, no email addresses in the audit log, and a regression test that admins cannot escalate to owner (Better Auth already prevents it). Not adopted: its duplicate settings validator (`lib/workspaces/settings.ts`; ours rejects fixed-offset timezones and includes Kosovo), its storage-agnostic workspace service and separate settings table (Better Auth's organization table is the store), its offline test runner, and its status documents, which described the pre-database state.
