# M0 authorization foundation

`lib/tenancy/authorization.ts` defines the permission policy and a server-side
authorization core. It is not yet wired to Better Auth, Prisma, routes, or UI.
The `/app` route remains an explicitly labelled public demo. Do not put real
organization data there until authentication and scoped repositories are wired.

## Initial permission policy

This is a conservative implementation baseline for the roles in product-spec
§10. It can be narrowed or expanded deliberately as modules are implemented.

| Capability | Owner | Admin | Sales | Finance | Member |
|---|---|---|---|---|---|
| Workspace summary | Yes | Yes | Yes | Yes | Yes |
| Customers: read/write | Yes | Yes | Yes | Yes | No |
| Leads, opportunities, pipeline: read/write | Yes | Yes | Yes | No | No |
| Quotes: read/write | Yes | Yes | Yes | No | No |
| Invoices: read/write | Yes | Yes | No | Yes | No |
| Void invoices | Yes | Yes | No | No | No |
| Payments: read / manual recording | Yes | Yes | No | Yes | No |
| Collections: read/write | Yes | Yes | No | Yes | No |
| Export business data | Yes | Yes | No | No | No |
| Organization settings, memberships, providers | Yes | Yes | No | No | No |
| Ownership operations | Yes | No | No | No | No |

Member has no implicit access to CRM or financial records. Workspace summaries
must honor underlying record permissions: `workspace:read` alone must not expose
financial aggregates or customer details. Future catalogue permissions should be
added explicitly with the M2 module.

## Integration contract

- Construct the authorizer in a server-only integration module. Resolve user ID
  from the verified Better Auth session; never use a browser-supplied user ID,
  role, or membership. A requested organization ID is only an untrusted selector.
- Query membership by both user ID and organization ID. Invitations are not
  memberships. Revoked memberships must return `null`.
- Every query and mutation must call the guard with its specific permission.
  Returned tenant context is an internal request value, never proof to accept
  from a client or a long-lived authorization cache.
- Query records using organization ID **and** record ID. `requireResourceAccess`
  additionally rejects a record returned for the wrong tenant. Missing and
  foreign records both return 404 after membership authorization.
- Scope updates/deletes by both identifiers too; a prior read check does not
  authorize an unscoped mutation. Critical writes must recheck membership and
  perform version checks within the database transaction as appropriate.
- Map `AuthorizationError.status` to HTTP responses without returning membership
  details. Storage/session errors propagate; outages must never grant access.
- Permissions are necessary, not sufficient: role changes must prevent escalation
  to owner by an admin, and ownership changes require additional invariants.
  Financial writes still require domain validation and audit records. Public
  document tokens use a separate narrowly scoped access path, not these roles.

## Verification and remaining work

`lib/tenancy/authorization.test.ts` covers the role matrix, anonymous sessions,
missing/revoked membership, wrong user and tenant, unknown roles, permission
denial, storage failure, scoped resource loading, and foreign-record rejection.

These are unit tests of the authorization policy. M0 still needs Prisma/Neon,
Better Auth, server-only session/database adapters, protected routes, transaction
integration tests across two real tenants, onboarding/settings, audit logging,
and Sentry before it meets the milestone exit criteria.
