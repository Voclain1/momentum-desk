# MomentumDesk — Decisions Log

The product specification (`docs/product-spec.md`, §19) requires that open technical and product decisions are made explicitly, not hidden inside implementation. Record each one here when it is made or changed.

Status values: **Accepted** (in force), **Proposed** (recommended, awaiting confirmation), **Open** (not yet decided), **Superseded**.

| # | Decision | Status | Choice | Notes |
|---|---|---|---|---|
| D1 | Repository name and visibility | Accepted (name) / Open (visibility) | `voclain1/momentum-desk` | Visibility to be confirmed by owner. |
| D2 | Application framework | Accepted | Next.js 16 (App Router), React 19, TypeScript, pnpm | Already bootstrapped. Follow the bundled docs in `node_modules/next/dist/docs/` (see `AGENTS.md`). |
| D3 | Authentication provider | Accepted | Better Auth (email/password + magic link, organization plugin) | Confirm current version and Prisma adapter support at install time. Alternative considered: Clerk (hosted, faster start, vendor cost, less control). |
| D4 | Database and hosting | Accepted | PostgreSQL on Neon | Branch-per-preview fits §11 preview/production separation. Backup and recovery procedure to be documented before pilot (M7). |
| D5 | Typed data layer | Accepted | Prisma | As suggested in §11. |
| D6 | Testing | Accepted | Vitest (unit/integration), Playwright (end-to-end) | Playwright is added when the first end-to-end flow exists (auth/onboarding). |
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
| D17 | Transactional email provider | Open (M3) | — | |
| D18 | Background job / queue service | Open (M3/M5) | — | Must support retries, idempotency and a transactional outbox (§11). |
| D19 | Payment providers for first pilot markets | Open (M4) | — | Requires eligibility/currency research per §6. |
| D20 | AI provider, data handling and usage limits | Open (M6) | — | Behind a provider-neutral `AIService`. |
| D21 | Route layout | Accepted | `/` marketing, `/app` authenticated workspace, `/q/{token}` and `/i/{token}` public documents | From §13. |

## Change history

- 2026-10-11 — Log created. D3–D9 accepted by the owner from the M0 recommendations. D10, D11 and D21 adopted for the M0 foundation.
