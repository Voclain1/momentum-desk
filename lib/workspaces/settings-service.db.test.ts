import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/auth/authorization";
import { createTenantDb } from "@/lib/tenant/core";
import { createTestDb, createTestOwnerDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import {
  updateWorkspaceSettings,
  WorkspaceConflictError,
  WorkspaceValidationError,
} from "./settings-service";

/** As the restricted app role, like the application. */
const db = createTestDb();

beforeEach(() => resetDatabase());
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

const current = {
  name: "Acme Solar",
  countryCode: "NG",
  locale: "en-NG",
  timezone: "Africa/Lagos",
  defaultLanguage: "en",
  defaultInvoiceCurrency: null,
};

async function workspace(role = "owner") {
  const organizationId = randomUUID();
  await db.organization.create({
    data: { id: organizationId, slug: `acme-${organizationId.slice(0, 8)}`, baseCurrency: "USD", ...current },
  });
  const userId = randomUUID();
  await db.user.create({ data: { id: userId, name: "Ada", email: `${userId}@example.com` } });
  await db.member.create({ data: { id: randomUUID(), organizationId, userId, role } });
  return { organizationId, userId };
}

const audit = (organizationId: string) =>
  createTenantDb(db, organizationId).auditLog.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const organization = (id: string) => db.organization.findUniqueOrThrow({ where: { id } });

describe("updateWorkspaceSettings", () => {
  it("saves, bumps the version and records exactly what changed, by whom", async () => {
    const { organizationId, userId } = await workspace();
    const next = await updateWorkspaceSettings(db, {
      userId,
      organizationId,
      expectedVersion: 1,
      input: { ...current, timezone: "Europe/London", defaultInvoiceCurrency: "GBP" },
    });

    expect(next).toMatchObject({ settingsVersion: 2, timezone: "Europe/London", defaultInvoiceCurrency: "GBP", baseCurrency: "USD" });
    expect(await audit(organizationId)).toEqual([
      expect.objectContaining({
        action: "organization.updated",
        actorUserId: userId,
        metadata: {
          settingsVersion: 2,
          changes: {
            timezone: { from: "Africa/Lagos", to: "Europe/London" },
            defaultInvoiceCurrency: { from: null, to: "GBP" },
          },
        },
      }),
    ]);
  });

  it("normalises input and treats an unchanged save as a no-op", async () => {
    const { organizationId, userId } = await workspace();
    const result = await updateWorkspaceSettings(db, {
      userId,
      organizationId,
      expectedVersion: 1,
      input: { ...current, countryCode: " ng ", locale: "EN-ng" },
    });
    expect(result.settingsVersion).toBe(1);
    expect(await audit(organizationId)).toEqual([]);
  });

  it("lets an admin save", async () => {
    const { organizationId, userId } = await workspace("admin");
    const next = await updateWorkspaceSettings(db, {
      userId, organizationId, expectedVersion: 1, input: { ...current, locale: "en-GB" },
    });
    expect(next.locale).toBe("en-GB");
  });

  it.each(["sales", "finance", "member", "superadmin"])("refuses %s and changes nothing", async (role) => {
    const { organizationId, userId } = await workspace(role);
    await expect(
      updateWorkspaceSettings(db, { userId, organizationId, expectedVersion: 1, input: { ...current, name: "Hijacked" } }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await organization(organizationId)).name).toBe("Acme Solar");
    expect(await audit(organizationId)).toEqual([]);
  });

  it("refuses an owner of a different workspace", async () => {
    const target = await workspace();
    const other = await workspace();
    await expect(
      updateWorkspaceSettings(db, {
        userId: other.userId, organizationId: target.organizationId, expectedVersion: 1, input: { ...current, name: "Hijacked" },
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect((await organization(target.organizationId)).name).toBe("Acme Solar");
  });

  it("re-checks membership at save time, so a removed member cannot save", async () => {
    const { organizationId, userId } = await workspace();
    await db.member.deleteMany({ where: { organizationId, userId } });
    await expect(
      updateWorkspaceSettings(db, { userId, organizationId, expectedVersion: 1, input: { ...current, name: "Late" } }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a save based on an old version", async () => {
    const { organizationId, userId } = await workspace();
    await updateWorkspaceSettings(db, { userId, organizationId, expectedVersion: 1, input: { ...current, name: "First" } });
    await expect(
      updateWorkspaceSettings(db, { userId, organizationId, expectedVersion: 1, input: { ...current, name: "Second" } }),
    ).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect((await organization(organizationId)).name).toBe("First");
  });

  it("lets exactly one of two simultaneous saves win", async () => {
    const { organizationId, userId } = await workspace();
    const results = await Promise.allSettled(
      ["Alpha", "Bravo"].map((name) =>
        updateWorkspaceSettings(db, { userId, organizationId, expectedVersion: 1, input: { ...current, name } }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(WorkspaceConflictError);
    expect((await organization(organizationId)).settingsVersion).toBe(2);
    expect(await audit(organizationId)).toHaveLength(1);
  });

  it("rolls the change back when the audit entry cannot be written", async () => {
    const { organizationId, userId } = await workspace();
    const owner = createTestOwnerDb();
    await owner.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_audit() RETURNS trigger LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'audit storage unavailable'; END $$`);
    await owner.$executeRawUnsafe(
      `CREATE TRIGGER test_fail_audit BEFORE INSERT ON "auditLog" FOR EACH ROW EXECUTE FUNCTION test_fail_audit()`,
    );
    try {
      await expect(
        updateWorkspaceSettings(db, { userId, organizationId, expectedVersion: 1, input: { ...current, name: "Unaudited" } }),
      ).rejects.toThrow(/audit storage unavailable/);
      expect(await organization(organizationId)).toMatchObject({ name: "Acme Solar", settingsVersion: 1 });
    } finally {
      await owner.$executeRawUnsafe(`DROP TRIGGER test_fail_audit ON "auditLog"`);
      await owner.$executeRawUnsafe(`DROP FUNCTION test_fail_audit()`);
      await owner.$disconnect();
    }
  });

  it("refuses to change the base currency", async () => {
    const { organizationId, userId } = await workspace();
    await expect(
      updateWorkspaceSettings(db, { userId, organizationId, expectedVersion: 1, input: { ...current, baseCurrency: "EUR" } }),
    ).rejects.toMatchObject({ fields: { baseCurrency: expect.stringMatching(/cannot be changed/) } });
    // The database refuses it from any other path too.
    await expect(db.organization.update({ where: { id: organizationId }, data: { baseCurrency: "EUR" } })).rejects.toThrow(
      /baseCurrency cannot be changed/,
    );
    expect((await organization(organizationId)).baseCurrency).toBe("USD");
  });

  it("names invalid and unknown fields without repeating what was sent", async () => {
    const { organizationId, userId } = await workspace();
    const secret = "do-not-echo-this";
    await expect(
      updateWorkspaceSettings(db, {
        userId, organizationId, expectedVersion: 1,
        input: { ...current, timezone: secret, name: "", organizationId: "other" },
      }),
    ).rejects.toSatisfy((error) => {
      expect(error).toBeInstanceOf(WorkspaceValidationError);
      const { fields, message } = error as WorkspaceValidationError;
      expect(Object.keys(fields).sort()).toEqual(["name", "organizationId", "timezone"]);
      expect(JSON.stringify(fields) + message).not.toContain(secret);
      return true;
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects version %s", async (expectedVersion) => {
    const { organizationId, userId } = await workspace();
    await expect(
      updateWorkspaceSettings(db, { userId, organizationId, expectedVersion, input: current }),
    ).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it("requires a user", async () => {
    const { organizationId } = await workspace();
    await expect(
      updateWorkspaceSettings(db, { userId: "", organizationId, expectedVersion: 1, input: current }),
    ).rejects.toMatchObject({ status: 401 });
  });
});
