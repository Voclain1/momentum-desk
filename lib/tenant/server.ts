import { AuthorizationError, hasPermission, type Permission } from "@/lib/auth/authorization";
import { requireWorkspace, type Workspace } from "@/lib/auth/session";
import { tenantDb, type TenantDb } from "./index";

export interface Tenant extends Workspace {
  /** Data access scoped to `organization.id`. */
  db: TenantDb;
  /** Whether the current member's role grants a permission (e.g. to show an edit button). */
  can(permission: Permission): boolean;
}

/**
 * Entry point for server components, server actions and route handlers that
 * touch organization data. Checks the session and membership on the server,
 * then the specific permission the caller needs, and returns data access
 * scoped to that workspace. Throws AuthorizationError(403) without it.
 *
 * Mutations must re-check inside their own transaction (see
 * lib/workspaces/settings-service.ts): a role can change between this check
 * and the write.
 */
export async function requireTenant(permission: Permission): Promise<Tenant> {
  const workspace = await requireWorkspace();
  if (!hasPermission(workspace.role, permission)) throw new AuthorizationError(403);
  return {
    ...workspace,
    db: tenantDb(workspace.organization.id),
    can: (other) => hasPermission(workspace.role, other),
  };
}
