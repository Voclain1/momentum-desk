# Authorization

Who may do what inside a workspace (spec §10). The permission matrix comes
from the Codex workspace-foundations work (`e0e033d`); it is wired into the
server checks described below.

## Permission matrix

`lib/auth/authorization.ts`. Every role is tested against every permission
(`lib/auth/authorization.test.ts`), so a change to this table needs a matching
test change.

| Capability | Owner | Admin | Sales | Finance | Member |
|---|---|---|---|---|---|
| Workspace summary (`workspace:read`) | Yes | Yes | Yes | Yes | Yes |
| Customers: read/write | Yes | Yes | Yes | Yes | No |
| Leads, opportunities, pipeline: read/write | Yes | Yes | Yes | No | No |
| Quotes: read/write | Yes | Yes | Yes | No | No |
| Invoices: read/write | Yes | Yes | No | Yes | No |
| Void invoices | Yes | Yes | No | No | No |
| Payments: read / record manually | Yes | Yes | No | Yes | No |
| Collections: read/write | Yes | Yes | No | Yes | No |
| Export business data | Yes | Yes | No | No | No |
| Workspace settings, members, payment providers | Yes | Yes | No | No | No |
| Ownership operations | Yes | No | No | No | No |

`member` has no implicit access to customer or financial records. A workspace
summary must respect the underlying record permissions: `workspace:read` alone
must not expose financial totals or customer details. Unknown roles grant
nothing; a comma-separated list of roles grants the union.

## Server checks

- Pages, server actions and route handlers call
  `requireTenant(permission)` (`lib/tenant/server.ts`). It verifies the
  session, re-reads the membership from the database, checks the permission
  and returns data access scoped to that workspace. Without the permission it
  throws `AuthorizationError(403)`. `tenant.can(permission)` decides what to
  show (e.g. a read-only form).
- The organization comes from the session's membership, never from a URL,
  form field or header.
- Writes that depend on the role re-check membership inside their own
  transaction, because a role can change between the page load and the save.
  `lib/workspaces/settings-service.ts` is the reference.
- Records are read through `tenantDb`, which scopes every query (see
  `docs/tenant-isolation.md`). A record in another workspace is simply not
  found, and gets the same response as a missing one.
- Hiding a button is never the check; the server check always runs.

## Workspace administration

Members, invitations and deleting the workspace go through Better Auth's
organization plugin with its own role rules (`lib/auth/permissions.ts`):
owners and admins manage members and invitations, and only owners delete the
workspace.

Ownership is protected: an admin cannot promote anyone (including themselves)
to owner, demote or remove an owner, or invite someone as owner. Better Auth
enforces this; `lib/auth/auth.db.test.ts` checks every path so an upgrade
cannot change it silently.

Better Auth's own "update organization" endpoint is disabled. The workspace
name and settings change only through the settings service, which re-checks
`settings:write`, rejects stale versions, keeps the base currency fixed and
writes the audit entry in the same transaction.

## Still to come

Business permissions (customers, quotes, invoices, payments) are enforced as
each module is built, each with server checks and cross-tenant tests. Public
document links (`/q/{token}`, `/i/{token}`) will use a separate, narrowly
scoped token check rather than these roles.
