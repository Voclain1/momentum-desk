import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Workspace roles from docs/product-spec.md §10.
 *
 * These statements cover workspace administration only (the organization,
 * its members and invitations). Business permissions such as "record a manual
 * payment" or "void an invoice" join this matrix as those modules are built,
 * each with server-side checks and tests.
 */
export const statements = { ...defaultStatements } as const;

export const ac = createAccessControl(statements);

export const roles = {
  /** Full access, including deleting the workspace. */
  owner: ac.newRole(ownerAc.statements),
  /** Manages the workspace and its people, but cannot delete it. */
  admin: ac.newRole(adminAc.statements),
  /** Leads, customers, opportunities and quotes (business permissions to come). */
  sales: ac.newRole(memberAc.statements),
  /** Customers, invoices, payments and collections (business permissions to come). */
  finance: ac.newRole(memberAc.statements),
  /** Restricted access based on explicit permissions. */
  member: ac.newRole(memberAc.statements),
};

export type Role = keyof typeof roles;
export const ROLES = Object.keys(roles) as Role[];
