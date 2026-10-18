import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  AuthorizationError,
  createTenantAuthorizer,
  hasPermission,
  PERMISSIONS,
  type Membership,
  type Permission,
} from "./authorization";

const membership: Membership = { userId: "alice", organizationId: "org-a", role: "sales" };

function setup(initialUser: string | null = "alice", initialMembership: Membership | null = membership) {
  let userId = initialUser;
  let record = initialMembership;
  const lookups: string[][] = [];
  const guard = createTenantAuthorizer({
    getSessionUserId: async () => userId,
    findMembership: async (user, organization) => {
      lookups.push([user, organization]);
      return record;
    },
  });
  return {
    ...guard, lookups,
    setUser: (value: string | null) => { userId = value; },
    setMembership: (value: Membership | null) => { record = value; },
  };
}

const denied = (status: number) => (error: unknown) => {
  assert.ok(error instanceof AuthorizationError);
  assert.equal(error.status, status);
  return true;
};

describe("role permissions", () => {
  const expected: Record<string, readonly Permission[]> = {
    owner: PERMISSIONS,
    admin: PERMISSIONS.filter((permission) => permission !== "ownership:manage"),
    sales: ["workspace:read", "customers:read", "customers:write", "sales:read", "sales:write", "quotes:read", "quotes:write"],
    finance: ["workspace:read", "customers:read", "customers:write", "invoices:read", "invoices:write", "payments:read", "payments:record", "collections:read", "collections:write"],
    member: ["workspace:read"],
  };

  for (const [role, permissions] of Object.entries(expected)) {
    it(`enforces every permission for ${role}`, () => {
      for (const permission of PERMISSIONS) {
        assert.equal(hasPermission(role, permission), permissions.includes(permission), `${role} / ${permission}`);
      }
    });
  }

  it("denies unknown, inherited and wrongly cased roles", () => {
    for (const role of ["Owner", "superadmin", "toString", "__proto__", ""]) {
      for (const permission of PERMISSIONS) assert.equal(hasPermission(role, permission), false);
    }
  });
});

describe("organization authorization", () => {
  it("rejects anonymous requests before looking up membership", async () => {
    const guard = setup(null);
    await assert.rejects(guard.requireOrganizationAccess("org-a", "quotes:read"), denied(401));
    assert.deepEqual(guard.lookups, []);
  });

  it("uses the session identity and requested organization together", async () => {
    const guard = setup();
    const tenant = await guard.requireOrganizationAccess("org-a", "quotes:write");
    assert.deepEqual(guard.lookups, [["alice", "org-a"]]);
    assert.deepEqual(tenant, membership);
    assert.ok(Object.isFrozen(tenant));
  });

  it("rejects missing membership, wrong tenant, wrong user and invalid role", async () => {
    for (const record of [
      null,
      { ...membership, organizationId: "org-b" },
      { ...membership, userId: "bob" },
      { ...membership, role: "superadmin" },
    ]) {
      await assert.rejects(setup("alice", record).requireOrganizationAccess("org-a", "quotes:read"), denied(403));
    }
  });

  it("does not permit an owner of one tenant into another tenant", async () => {
    const guard = setup("alice", { ...membership, role: "owner" });
    await assert.rejects(guard.requireOrganizationAccess("org-b", "workspace:read"), denied(403));
  });

  it("rejects blank tenant IDs before querying membership", async () => {
    const guard = setup();
    await assert.rejects(guard.requireOrganizationAccess("  ", "workspace:read"), denied(403));
    assert.deepEqual(guard.lookups, []);
  });

  it("requires the permission even for a valid member", async () => {
    await assert.rejects(setup().requireOrganizationAccess("org-a", "payments:record"), denied(403));
  });

  it("rechecks session and membership rather than caching authorization", async () => {
    const guard = setup();
    await guard.requireOrganizationAccess("org-a", "quotes:read");
    guard.setMembership(null);
    await assert.rejects(guard.requireOrganizationAccess("org-a", "quotes:read"), denied(403));
    guard.setUser(null);
    await assert.rejects(guard.requireOrganizationAccess("org-a", "quotes:read"), denied(401));
  });

  it("propagates storage failures without allowing access", async () => {
    const failure = new Error("storage unavailable");
    const guard = createTenantAuthorizer({
      getSessionUserId: async () => "alice",
      findMembership: async () => { throw failure; },
    });
    await assert.rejects(guard.requireOrganizationAccess("org-a", "quotes:read"), (error) => error === failure);
  });
});

describe("resource authorization", () => {
  it("never loads business data before membership and permissions pass", async () => {
    let loaded = false;
    await assert.rejects(setup().requireResourceAccess("org-b", "quotes:read", async () => {
      loaded = true;
      return { organizationId: "org-b" };
    }), denied(403));
    assert.equal(loaded, false);
  });

  it("passes verified tenant scope to the repository query", async () => {
    const resource = { id: "quote-a", organizationId: "org-a" };
    const result = await setup().requireResourceAccess("org-a", "quotes:read", async (tenant) => {
      assert.deepEqual(tenant, membership);
      return resource;
    });
    assert.equal(result.resource, resource);
  });

  it("gives the same not-found response for absent and foreign records", async () => {
    for (const resource of [null, { id: "quote-b", organizationId: "org-b" }]) {
      await assert.rejects(setup().requireResourceAccess("org-a", "quotes:read", async () => resource), denied(404));
    }
  });
});
