import { describe, expect, it } from "vitest";
import { scopeArgs, TenantViolationError } from "./scope";

const ORG = "org_a";

describe("scopeArgs", () => {
  it("adds the organization to a unique lookup without changing its shape", () => {
    expect(scopeArgs("findUnique", { where: { id: "1" }, select: { id: true } }, ORG)).toEqual({
      where: { id: "1", organizationId: ORG },
      select: { id: true },
    });
  });

  it("wraps filters so OR clauses cannot widen them", () => {
    const where = { OR: [{ organizationId: "org_b" }, { action: "x.y" }] };
    expect(scopeArgs("findMany", { where }, ORG)).toEqual({
      where: { AND: [where, { organizationId: ORG }] },
    });
  });

  it("scopes calls with no arguments", () => {
    expect(scopeArgs("count", undefined, ORG)).toEqual({ where: { organizationId: ORG } });
    expect(scopeArgs("deleteMany", {}, ORG)).toEqual({ where: { organizationId: ORG } });
  });

  it.each(["findUnique", "delete", "update", "upsert"])(
    "refuses a unique %s that names another organization",
    (operation) => {
      expect(() =>
        scopeArgs(operation, { where: { id: "1", organizationId: "org_b" }, data: {}, create: {}, update: {} }, ORG),
      ).toThrow(TenantViolationError);
    },
  );

  it("sets the organization on created rows", () => {
    expect(scopeArgs("create", { data: { action: "a.b" } }, ORG)).toEqual({
      data: { action: "a.b", organizationId: ORG },
    });
    expect(scopeArgs("createMany", { data: [{ action: "a.b" }, { action: "c.d" }] }, ORG)).toEqual({
      data: [
        { action: "a.b", organizationId: ORG },
        { action: "c.d", organizationId: ORG },
      ],
    });
  });

  it("refuses to create rows for another organization", () => {
    expect(() => scopeArgs("create", { data: { organizationId: "org_b" } }, ORG)).toThrow(
      TenantViolationError,
    );
    expect(() =>
      scopeArgs("create", { data: { organization: { connect: { id: "org_b" } } } }, ORG),
    ).toThrow(TenantViolationError);
    expect(() =>
      scopeArgs("createMany", { data: [{}, { organizationId: "org_b" }] }, ORG),
    ).toThrow(TenantViolationError);
  });

  it.each(["update", "updateMany", "upsert"])("refuses to move a record with %s", (operation) => {
    expect(() =>
      scopeArgs(
        operation,
        { where: { id: "1" }, data: { organizationId: "org_b" }, create: {}, update: { organizationId: "org_b" } },
        ORG,
      ),
    ).toThrow(/cannot be moved/);
  });

  it("refuses unknown operations and a missing organization", () => {
    expect(() => scopeArgs("findRaw", {}, ORG)).toThrow(/not supported/);
    expect(() => scopeArgs("findMany", {}, "")).toThrow(/no organization id/);
  });
});
