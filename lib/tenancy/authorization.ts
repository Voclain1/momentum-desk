/**
 * Server authorization core. Wire these dependencies to the verified auth
 * session and database; never supply a user or membership from request input.
 * This module does not authenticate requests or protect routes by itself.
 */
export const PERMISSIONS = [
  "workspace:read",
  "customers:read", "customers:write",
  "sales:read", "sales:write",
  "quotes:read", "quotes:write",
  "invoices:read", "invoices:write", "invoices:void",
  "payments:read", "payments:record",
  "collections:read", "collections:write",
  "data:export", "settings:write", "members:manage",
  "providers:manage", "ownership:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type Role = "owner" | "admin" | "sales" | "finance" | "member";

/** Explicit, least-privilege baseline; see docs/authorization.md. */
const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((permission) => permission !== "ownership:manage"),
  sales: [
    "workspace:read", "customers:read", "customers:write",
    "sales:read", "sales:write", "quotes:read", "quotes:write",
  ],
  finance: [
    "workspace:read", "customers:read", "customers:write",
    "invoices:read", "invoices:write", "payments:read", "payments:record",
    "collections:read", "collections:write",
  ],
  member: ["workspace:read"],
};

export function hasPermission(role: string, permission: Permission): boolean {
  if (!Object.hasOwn(ROLE_PERMISSIONS, role)) return false;
  return ROLE_PERMISSIONS[role as Role].includes(permission);
}

export type Membership = Readonly<{
  userId: string;
  organizationId: string;
  role: string;
}>;

export type AuthorizationDependencies = {
  /** Resolve identity from a verified server session, on each call. */
  getSessionUserId: () => Promise<string | null>;
  /** Query by BOTH userId and organizationId, excluding revoked memberships. */
  findMembership: (userId: string, organizationId: string) => Promise<Membership | null>;
};

export class AuthorizationError extends Error {
  readonly status: 401 | 403 | 404;

  constructor(status: 401 | 403 | 404) {
    super(status === 401 ? "Authentication required" : status === 403 ? "Access denied" : "Record not found");
    this.name = "AuthorizationError";
    this.status = status;
  }
}

export type TenantAccess = Readonly<{
  userId: string;
  organizationId: string;
  role: Role;
}>;

export function createTenantAuthorizer(dependencies: AuthorizationDependencies) {
  async function requireOrganizationAccess(
    organizationId: string,
    permission: Permission,
  ): Promise<TenantAccess> {
    const userId = await dependencies.getSessionUserId();
    if (!userId) throw new AuthorizationError(401);
    if (!organizationId.trim()) throw new AuthorizationError(403);

    const membership = await dependencies.findMembership(userId, organizationId);
    if (
      !membership ||
      membership.userId !== userId ||
      membership.organizationId !== organizationId ||
      !hasPermission(membership.role, permission)
    ) {
      throw new AuthorizationError(403);
    }

    return Object.freeze({ userId, organizationId, role: membership.role as Role });
  }

  async function requireResourceAccess<T extends { organizationId: string }>(
    organizationId: string,
    permission: Permission,
    /** Always query with the supplied tenant scope as well as the record ID. */
    loadResource: (tenant: TenantAccess) => Promise<T | null>,
  ): Promise<{ tenant: TenantAccess; resource: T }> {
    const tenant = await requireOrganizationAccess(organizationId, permission);
    const resource = await loadResource(tenant);
    // Missing and cross-tenant records have the same public response.
    if (!resource || resource.organizationId !== tenant.organizationId) {
      throw new AuthorizationError(404);
    }
    return { tenant, resource };
  }

  return { requireOrganizationAccess, requireResourceAccess };
}
