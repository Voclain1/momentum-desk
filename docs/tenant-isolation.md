# Tenant isolation

Every business record belongs to exactly one organization (workspace). A user
must never read or change another organization's data, whatever they send.
Spec: `docs/product-spec.md` §12 and §20.4. Decision: D22.

Isolation is enforced twice, independently, so one mistake is not a breach.

## 1. Application: `tenantDb`

Code reaches organization-owned data only through `lib/tenant`:

```ts
import { requireTenant } from "@/lib/tenant/server";

const tenant = await requireTenant("workspace:read"); // session, membership and permission checked on the server
const entries = await tenant.db.auditLog.findMany({ take: 20 });
```

- `requireTenant()` takes the organization from the verified session and a
  database membership check, never from a URL, form field or header.
- `tenantDb(organizationId)` exposes only tenant models. `tenantDb(id).user`
  is a type error.
- Every call is rewritten (`lib/tenant/scope.ts`): filters are wrapped with
  `AND organizationId = …` so `OR` clauses cannot widen them, created rows
  get the organization, and an argument naming another organization throws
  `TenantViolationError` instead of being silently corrected. Unknown
  operations are refused.
- Use `tenantTransaction(organizationId, async (tenant) => …)` for several
  writes that must succeed or fail together.
- ESLint blocks importing `@/lib/db` or the generated Prisma client outside
  `lib/db`, `lib/auth`, `lib/tenant`, `lib/workspaces` (the workspace record
  itself, with its own in-transaction membership check) and tests.
- Permissions per role: `docs/authorization.md`.

## 2. Database: row-level security

Each tenant table has `ENABLE` and `FORCE ROW LEVEL SECURITY` and a policy
that matches rows to `app_current_organization_id()`, which reads the
transaction-local setting `app.organization_id`. `tenantDb` sets it in the
same transaction as each query. Without it, queries see no rows and cannot
insert any. The setting never outlives its transaction, so pooled connections
do not leak it.

Row-level security does not apply to superusers or roles with `BYPASSRLS`. On
Neon, the default owner role has `BYPASSRLS`. So:

| Variable | Role | Used by |
|---|---|---|
| `DATABASE_URL` | restricted app role (`NOSUPERUSER NOBYPASSRLS`, owns nothing) | the app, at runtime |
| `MIGRATION_DATABASE_URL` | database owner | `prisma migrate` only |

Set up the app role once per database (see `prisma/sql/app-role.sql`):

```sql
CREATE ROLE momentum_app LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
```

```bash
pnpm db:deploy   # as the owner, via MIGRATION_DATABASE_URL
psql "$MIGRATION_DATABASE_URL" -v app_role=momentum_app -f prisma/sql/app-role.sql
```

A database test fails if the app connection is a superuser or can bypass
row-level security.

## Adding an organization-owned model

1. Give it `organizationId String` with a relation to `Organization`
   (`onDelete: Cascade`) and an index starting with `organizationId`.
2. Add it to `TENANT_MODELS` in `lib/tenant/models.ts` and its types to
   `TenantModelTypes` in `lib/tenant/core.ts`.
3. In its migration, enable and force row-level security with the same policy
   as `auditLog` (see `prisma/migrations/*_tenant_audit_log`).
4. When it references another tenant table, use a composite foreign key on
   `(id, organizationId)` so a row can never point at another organization's
   record.
5. Add cross-tenant tests: read, filter, create, update and delete from a
   second organization must all fail.

`lib/tenant/tenant.db.test.ts` fails if a table with an `organizationId`
column is not registered, or if a registered table lacks forced row-level
security.

Tenant tables so far: `auditLog`, `customer`, `contact` (references
`customer` through the composite key), `pipelineStage`, `lead`
(references `pipelineStage` and, once converted, `customer` through
composite keys), `activity` and
`task` (reference `lead` or `customer` through composite keys), `taxRate`,
`product` (references `taxRate`), `productPrice` (references `product`),
`documentSequence`, `quote` (references `customer`, `lead` and its previous
revision), `quoteItem` (references `quote` and `product`), `quoteLink`,
`quoteEvent` and `quoteAcceptanceCode` (reference `quote`), `invoice`
(references `customer`, `lead` and `quote`), `invoiceItem`, `payment`
(references `customer`), `paymentAllocation` (references `payment` and
`invoice`), `invoiceSettings`, `invoiceLink` and `invoiceEvent` (reference
`invoice`). Invoice links (`/i/{token}`) use the same token lookup as quote
links, through the `invoiceLink_token_lookup` policy.

`providerConnection`, `paymentAttempt`, `providerEvent` and `refund` hold
online payments and refunds. Provider webhooks arrive without a session at
`/api/webhooks/{provider}/{connectionId}`: the `providerConnection_webhook_lookup`
policy lets that request read the one connection it names, to check the
signature with that connection's own secret; everything after runs as a
tenant transaction for the connection's workspace.

`job` is the background queue (D18). The worker (`scripts/worker.ts`) claims
due jobs across workspaces through the `job_worker_access` policy, which only
applies while its own transaction sets `app.job_worker`; each job's handler
then runs as a tenant transaction for that job's workspace. Outside the
worker the app role sees only the current workspace's jobs
(`lib/jobs/queue.db.test.ts`). `exchangeRate` (append-only),
`invoiceCollection`, `promiseToPay`, `collectionNote`, `reminderStep` and
`reminderExecution` are ordinary tenant tables. A customer stops reminders
from `/i/{token}` through the same invoice-link token lookup.

Public quote pages (`/q/{token}`) have no session. `lib/tenant/public.ts`
runs the one query without an organization: it sets the token's SHA-256 for
its own transaction, and the read-only `quoteLink_token_lookup` policy lets it
see exactly that link row. The rest runs as a tenant transaction for the
link's workspace. Without the token the app role sees no link rows
(`lib/quotes/public.db.test.ts`). Domain services such as
`lib/customers/service.ts` receive `TenantData` (`lib/tenant`) instead of a
database client, so they can only run scoped queries. Duplicate checks,
conversion and CSV import/export (`lib/records`, `lib/leads/conversion.ts`,
`lib/transfer`) use the same scoped access, so a match, a link or an export
never reaches another workspace (tests in their `*.db.test.ts` files).

`member` and `invitation` also carry an `organizationId` but are managed by
Better Auth's organization plugin, which checks membership and role on every
call (tests in `lib/auth/auth.db.test.ts`).

## Audit log

`auditLog` is the first tenant table. It is append-only: a trigger rejects
`UPDATE` and `DELETE`, except foreign-key actions when an organization or a
user account is deleted. Workspace creation, settings changes (each changed
field with its old and new value, written in the same transaction as the
change), member changes and invitations are recorded with the acting user
(`lib/auth/server.ts`, `lib/workspaces`, `lib/audit`). Entries hold no email
addresses, passwords or tokens.
