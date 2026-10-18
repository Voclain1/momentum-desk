/**
 * Business permissions per role (docs/product-spec.md §10, docs/authorization.md).
 * Ported from the Codex workspace-foundations branch (e0e033d).
 *
 * Workspace administration through Better Auth (members, invitations,
 * deleting the workspace) is governed by lib/auth/permissions.ts; this matrix
 * governs everything MomentumDesk itself serves. Every server query and
 * mutation asks for one specific permission via requireTenant().
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

/** Explicit, least-privilege baseline. Changes here need a test change too. */
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

/**
 * Whether a membership role grants a permission. Better Auth stores several
 * roles as a comma-separated list; any of them may grant it. Unknown roles
 * grant nothing.
 */
export function hasPermission(role: string, permission: Permission): boolean {
  return role
    .split(",")
    .map((part) => part.trim())
    .some((part) => Object.hasOwn(ROLE_PERMISSIONS, part) && ROLE_PERMISSIONS[part as Role].includes(permission));
}

export class AuthorizationError extends Error {
  readonly status: 401 | 403 | 404;

  constructor(status: 401 | 403 | 404) {
    super(status === 401 ? "Authentication required" : status === 403 ? "Access denied" : "Record not found");
    this.name = "AuthorizationError";
    this.status = status;
  }
}
