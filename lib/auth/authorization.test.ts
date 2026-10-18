import { describe, expect, it } from "vitest";
import { hasPermission, PERMISSIONS, type Permission } from "./authorization";

// Every role is checked against every permission, so any change to the
// matrix must be made here deliberately too.
const expected: Record<string, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((permission) => permission !== "ownership:manage"),
  sales: ["workspace:read", "customers:read", "customers:write", "sales:read", "sales:write", "quotes:read", "quotes:write"],
  finance: [
    "workspace:read", "customers:read", "customers:write", "invoices:read", "invoices:write",
    "payments:read", "payments:record", "collections:read", "collections:write",
  ],
  member: ["workspace:read"],
};

describe("hasPermission", () => {
  for (const [role, permissions] of Object.entries(expected)) {
    it(`grants exactly the ${role} permissions`, () => {
      for (const permission of PERMISSIONS) {
        expect(hasPermission(role, permission), `${role} / ${permission}`).toBe(permissions.includes(permission));
      }
    });
  }

  it("denies unknown, inherited and wrongly cased roles", () => {
    for (const role of ["Owner", "superadmin", "toString", "__proto__", "constructor", ""]) {
      for (const permission of PERMISSIONS) expect(hasPermission(role, permission)).toBe(false);
    }
  });

  it("combines a comma-separated list of roles", () => {
    expect(hasPermission("sales,finance", "quotes:write")).toBe(true);
    expect(hasPermission("sales, finance", "payments:record")).toBe(true);
    expect(hasPermission("sales,finance", "settings:write")).toBe(false);
    expect(hasPermission("member,superadmin", "settings:write")).toBe(false);
  });

  it("keeps sensitive actions to owners and admins", () => {
    for (const permission of ["invoices:void", "data:export", "providers:manage", "members:manage", "settings:write"] as const) {
      expect(["owner", "admin", "sales", "finance", "member"].filter((role) => hasPermission(role, permission))).toEqual([
        "owner",
        "admin",
      ]);
    }
    expect(["owner", "admin"].filter((role) => hasPermission(role, "ownership:manage"))).toEqual(["owner"]);
  });
});
