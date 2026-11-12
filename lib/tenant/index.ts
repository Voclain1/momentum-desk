import { db } from "@/lib/db";
import { createTenantData, createTenantDb, runTenantTransaction, type TenantDb } from "./core";
import { createPublicLinks } from "./public";

export type { TenantData, TenantDb } from "./core";
export { TenantViolationError } from "./scope";

/**
 * The only way to read or write organization-owned data. Take the
 * organization id from `requireTenant()` (lib/tenant/server.ts), never from
 * user input.
 */
export function tenantDb(organizationId: string): TenantDb {
  return createTenantDb(db, organizationId);
}

export function tenantTransaction<T>(organizationId: string, work: (tenant: TenantDb) => Promise<T>) {
  return runTenantTransaction(db, organizationId, work);
}

/** Scoped data access for domain services (lib/customers, …). */
export const tenantData = createTenantData(db);

/** Token lookups for public document pages (lib/tenant/public.ts). */
export const publicLinks = createPublicLinks(db);
