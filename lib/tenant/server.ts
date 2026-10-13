import { requireWorkspace, type Workspace } from "@/lib/auth/session";
import { tenantDb, type TenantDb } from "./index";

export interface Tenant extends Workspace {
  /** Data access scoped to `organization.id`. */
  db: TenantDb;
}

/**
 * Entry point for server components, server actions and route handlers that
 * touch organization data: checks the session and membership on the server
 * and returns data access scoped to that workspace.
 */
export async function requireTenant(): Promise<Tenant> {
  const workspace = await requireWorkspace();
  return { ...workspace, db: tenantDb(workspace.organization.id) };
}
