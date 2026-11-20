# Security review (M7)

Reviewed 2026-11-20 against `docs/product-spec.md` §12. Each item names where
it is enforced and how it is tested. Re-run this review before each pilot
expansion and after any change to authentication, payments or tenant access.

| Requirement | Status | Where | Tested by |
|---|---|---|---|
| Tenant isolation and authorization | Done | Two layers: `lib/tenant` scoping and forced PostgreSQL row-level security (D22); `requireTenant(permission)` on every entry point; ESLint blocks raw database access outside an allowlist | `lib/tenant/*.db.test.ts`, "never reaches another workspace" tests in every service |
| Authentication and sessions | Done | Better Auth (D3): database sessions, hashed passwords, magic links, sessions revoked on password reset | `lib/auth/auth.db.test.ts`, `e2e/auth.spec.ts` |
| Input validation on every mutation | Done | zod schemas in each service; server actions pass raw input to them | Service tests (validation messages) |
| Rate limits | Done | Auth: Better Auth (database counters). Public quote/invoice pages and PDFs, acceptance codes, online checkout, reminder opt-out, Momentum AI: `lib/security/rate-limit.ts` (PostgreSQL, hashed keys). Quote acceptance codes are also limited per quote and per attempt; AI also by the workspace's monthly limit | `lib/security/rate-limit.db.test.ts`, `lib/quotes/public.db.test.ts`, `lib/ai/service.db.test.ts` |
| CSRF | Done | Server actions check the Origin header (Next.js); Better Auth checks trusted origins (`APP_URL` only); cookies are SameSite=Lax | `lib/auth/origins.test.ts` |
| Webhook signatures, replay and idempotency | Done | Per-connection secrets; the provider's API is asked before anything is recorded; one payment per provider reference | `lib/payments/*.db.test.ts`, `e2e/online-payments.spec.ts` |
| Secrets server-side only | Done | `lib/env.ts` (nothing secret is `NEXT_PUBLIC_`); provider keys encrypted with `PROVIDER_SECRETS_KEY`; `deploy/.env` never committed | `lib/env.test.ts` |
| No sensitive payment data in logs | Done | No card data ever reaches us; Sentry events scrubbed (`lib/observability/scrub.ts`); audit and analytics hold ids, not amounts in free text | `lib/observability/*.test.ts` |
| Public document tokens | Done | 256-bit random, stored as SHA-256 only, revocable (D16); a token reads exactly one link row | `lib/quotes/public.db.test.ts`, `lib/invoices/public.db.test.ts` |
| Audit logs | Done | `lib/audit`: financial, permission, settings, branding and AI-settings changes, in the same transaction as the change | Service tests |
| Backups and tested recovery | Done | `deploy/backup.sh` nightly; restore drill in `docs/runbooks.md` | Recorded drill |
| Data export and deletion/retention | Partly | CSV export of customers and leads, PDFs of documents; archive instead of delete (D25). Workspace closure and erasure are a manual runbook step until D25 erasure is decided | — |
| Error monitoring and alerting | Done | Sentry (D8), health check for uptime monitoring | `e2e/health.spec.ts` |
| Dependency and security updates | Done | `pnpm audit --prod` clean on 2026-11-20 (Next.js 16.4.6, zod 4.6.7, Prisma 7.10.1; `effect` and `fast-uri` overridden in `pnpm-workspace.yaml`). One moderate advisory remains in lint-only tooling (`minimatch` via eslint-config-next). Check monthly and on every advisory: `docs/runbooks.md` | CI |
| Privacy disclosures for AI and integrations | Draft | `/privacy` and `/terms` (D40), awaiting legal review | `e2e/legal.spec.ts` |
| Security headers | Done | `next.config.ts`: nosniff, frame-ancestors 'none' and X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, HSTS over HTTPS; no X-Powered-By | `e2e/health.spec.ts` |
| No sequential ids exposed | Done | UUIDv7 and Better Auth ids; document numbers are per workspace and only shown to that workspace and its customers | — |

## Accessibility

`e2e/accessibility.spec.ts` checks the sign-up, sign-in and onboarding pages,
every main app page, a customer's invoice page and the home and privacy pages
with axe (WCAG 2.1 A and AA). It fails on any serious or critical problem.
Fixed in this review: low-contrast hint and label text, status pills, the
sign-in mode toggle, the home page button, and links that relied on colour
alone. The visual design system planned later must keep this test passing.
