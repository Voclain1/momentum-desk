# M0 workspace domain foundation

## Implemented

`lib/workspaces/settings.ts` validates explicit country, base currency, locale,
timezone, language and optional invoice currency. Country uses an explicit ISO
3166-1 alpha-2 list; currency uses the existing ISO 4217 exponent table. Locale
and language tags must be canonicalizable and supported by the runtime's Intl
data. Timezones must be recognized by Intl. No value is inferred from country.
Full ICU support is required in the production Node runtime.

`lib/workspaces/service.ts` exposes two server domain operations:

- `createWorkspace(input)`: resolves the authenticated user, validates input,
  then creates the organization, its owner membership, version-1 settings and
  a minimal audit event inside one transaction. Client-supplied identity, role,
  or organization ID fields are rejected.
- `updateSettings(organizationId, expectedVersion, input)`: checks the session's
  current membership and `settings:write` permission within the transaction,
  validates a full settings replacement, uses an atomic version check, and
  appends audit metadata in the same transaction. Identical input is a no-op.

Base currency is fixed at workspace creation in this M0 implementation. A future
change requires an explicit policy for historical reporting and rate snapshots.
Invoice currency can be different, or null to leave document choice explicit.

Audit events carry tenant ID, actor ID, action, settings version and changed
field names. They omit business names, email addresses, credentials, and raw
request data. The database adapter supplies stable audit IDs and timestamps.

## Required production integration

No Prisma/Better Auth adapter or route calls these services yet. `/app` still
shows the existing public demo; no live workspace data has been introduced.

The next implementation must:

1. Install and lock Prisma, its Postgres adapter and Better Auth; generate the
   authentication schema from the selected Better Auth configuration/version.
   The organization plugin uses its own organization/member/invitation models;
   integrate those models instead of creating a parallel membership store.
2. Add settings (one record per organization, integer version), membership
   uniqueness `(organizationId, userId)`, unique organization slugs, and tenant-
   scoped audit records, with database foreign keys and appropriate indexes.
3. Implement `WorkspaceTransaction` with a single Prisma transaction client.
   Use serializable isolation for membership-sensitive writes and bounded retry
   on serialization conflicts. Every retry must rerun membership authorization.
   Audit errors must abort the transaction. Updates must compare both tenant ID
   and expected settings version, not a record ID alone.
4. Resolve identity only from Better Auth's verified server session. Keep the
   adapter server-only. Disable or constrain alternative organization-create
   endpoints that would bypass required settings and transactional onboarding.
5. Add signup/login and explicit workspace onboarding; protect the workspace
   and settings mutations with server guards. Apply request validation, CSRF
   protections and rate limits at the HTTP/auth boundary.
6. Add integration tests against two Postgres tenants proving denied access,
   audit rollback, uniqueness, concurrency handling and revoked membership.
   Add Playwright signup/onboarding coverage, then Sentry and deployment setup.

Database URLs and auth secrets are not configured in this workspace. The shell
proxy is unreachable, so dependencies could not be installed. No migration has
been generated or applied, and no live authentication flow is claimed.

## Checks

Normal verification remains `pnpm check` and `pnpm build`. The existing Vitest
configuration picks up the new `*.test.ts` files without additional packages.

For an offline check on Node 22.18+ (verified here on Node 24):

```bash
node scripts/test-domain.mjs
```

The runner transforms temporary copies of the domain modules with Node's
TypeScript transformer, substitutes `node:test` for Vitest's `describe`/`it`,
and executes the same assertions. It leaves source files unchanged and tests
only the dependency-free domain modules. This is not a type-check, full test
suite, or application build. Transaction tests use an in-memory double and do
not establish Postgres behavior.

## Documentation reviewed for the next integration

Checked 2026-10-16:

- [Better Auth Prisma adapter](https://www.better-auth.com/docs/adapters/prisma)
- [Better Auth organization plugin](https://www.better-auth.com/docs/plugins/organization)
- [Better Auth releases](https://github.com/better-auth/better-auth/releases)

Recheck the installed version's documentation and generated schema when package
installation becomes available; the integration has not been implemented from
unverified API assumptions.
