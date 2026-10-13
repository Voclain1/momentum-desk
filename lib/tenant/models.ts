/**
 * Organization-owned models: each has an `organizationId`, row-level security
 * in its migration, and is reached only through `tenantDb()`.
 *
 * Adding a model with an `organizationId` column fails the registry test in
 * lib/tenant/tenant.db.test.ts until it is listed here or in
 * `AUTH_MANAGED_MODELS`.
 */
export const TENANT_MODELS = ["auditLog"] as const;
export type TenantModel = (typeof TENANT_MODELS)[number];

/**
 * Models with an organizationId that Better Auth's organization plugin owns.
 * It checks membership and role on every call (tested in
 * lib/auth/auth.db.test.ts), so they are not routed through tenantDb.
 */
export const AUTH_MANAGED_MODELS = ["member", "invitation"] as const;
