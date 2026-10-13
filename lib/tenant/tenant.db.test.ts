import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { createTenantDb, runTenantTransaction } from "./core";
import { AUTH_MANAGED_MODELS, TENANT_MODELS } from "./models";
import { TenantViolationError } from "./scope";

/** Connected as the restricted app role, exactly like the application. */
const db = createTestDb();

beforeEach(() => resetDatabase());
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

const settings = {
  baseCurrency: "USD",
  countryCode: "NG",
  locale: "en-NG",
  timezone: "Africa/Lagos",
  defaultLanguage: "en",
};

async function workspace(name: string) {
  const id = randomUUID();
  await db.organization.create({ data: { id, name, slug: `${name}-${id.slice(0, 8)}`, ...settings } });
  const userId = randomUUID();
  await db.user.create({ data: { id: userId, name, email: `${userId}@example.com` } });
  await db.member.create({ data: { id: randomUUID(), organizationId: id, userId, role: "owner" } });
  const tenant = createTenantDb(db, id);
  const entry = await tenant.auditLog.create({
    data: { action: "test.created", actorUserId: userId, metadata: { name } },
  });
  return { id, userId, tenant, entry };
}

describe("the database connection", () => {
  it("cannot bypass row-level security", async () => {
    const [role] = await db.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe("tenant model registry", () => {
  it("covers every table with an organizationId", async () => {
    const tables = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'organizationId'`;
    const known = new Set<string>([...TENANT_MODELS, ...AUTH_MANAGED_MODELS]);
    expect(tables.map((t) => t.table_name).filter((name) => !known.has(name))).toEqual([]);
  });

  it.each(TENANT_MODELS)("%s has forced row-level security and a policy", async (table) => {
    const [row] = await db.$queryRaw<{ rls: boolean; forced: boolean; policies: bigint }[]>`
      SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies
      FROM pg_class c WHERE c.relname = ${table}`;
    expect(row).toMatchObject({ rls: true, forced: true });
    expect(Number(row.policies)).toBeGreaterThan(0);
  });
});

describe("tenantDb", () => {
  it("reads only its own organization's rows", async () => {
    const a = await workspace("alpha");
    const b = await workspace("bravo");

    expect((await a.tenant.auditLog.findMany()).map((e) => e.organizationId)).toEqual([a.id]);
    expect(await a.tenant.auditLog.count()).toBe(1);
    expect(await a.tenant.auditLog.findUnique({ where: { id: b.entry.id } })).toBeNull();
    await expect(
      a.tenant.auditLog.findUniqueOrThrow({ where: { id: b.entry.id } }),
    ).rejects.toThrow();
  });

  it("cannot be widened by filters that name another organization", async () => {
    const a = await workspace("alpha");
    const b = await workspace("bravo");
    const rows = await a.tenant.auditLog.findMany({
      where: { OR: [{ organizationId: b.id }, { id: b.entry.id }, { action: { not: "" } }] },
    });
    expect(rows.map((r) => r.id)).toEqual([a.entry.id]);
    await expect(
      a.tenant.auditLog.findUnique({ where: { id: b.entry.id, organizationId: b.id } }),
    ).rejects.toThrow(TenantViolationError);
  });

  it("cannot create rows in another organization", async () => {
    const a = await workspace("alpha");
    const b = await workspace("bravo");
    await expect(
      a.tenant.auditLog.create({ data: { action: "test.forged", organizationId: b.id } as never }),
    ).rejects.toThrow(TenantViolationError);
    await expect(
      a.tenant.auditLog.create({
        data: { action: "test.forged", organization: { connect: { id: b.id } } },
      } as never),
    ).rejects.toThrow(TenantViolationError);
    expect(await b.tenant.auditLog.count()).toBe(1);
  });

  it("cannot update or delete another organization's rows", async () => {
    const a = await workspace("alpha");
    const b = await workspace("bravo");
    await expect(
      a.tenant.auditLog.update({ where: { id: b.entry.id }, data: { action: "test.changed" } }),
    ).rejects.toThrow();
    await expect(a.tenant.auditLog.delete({ where: { id: b.entry.id } })).rejects.toThrow();
    expect(await b.tenant.auditLog.findUnique({ where: { id: b.entry.id } })).toMatchObject({
      action: "test.created",
    });
  });

  it("does not expose non-tenant models or unsupported operations", async () => {
    const a = await workspace("alpha");
    expect("user" in a.tenant).toBe(false);
    expect(() => (a.tenant.auditLog as unknown as { findRaw: unknown }).findRaw).toThrow(
      TenantViolationError,
    );
  });

  it("refuses to run without an organization", () => {
    expect(() => createTenantDb(db, "")).toThrow(TenantViolationError);
  });
});

describe("row-level security", () => {
  it("hides every tenant row from queries that skip tenantDb", async () => {
    await workspace("alpha");
    await workspace("bravo");
    expect(await db.auditLog.findMany()).toEqual([]);
    expect(await db.$queryRaw`SELECT * FROM "auditLog"`).toEqual([]);
  });

  it("limits raw SQL to the organization set for the transaction", async () => {
    const a = await workspace("alpha");
    const b = await workspace("bravo");
    const rows = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${a.id}, true)`;
      return tx.$queryRaw<{ organizationId: string }[]>`SELECT "organizationId" FROM "auditLog"`;
    });
    expect(rows).toEqual([{ organizationId: a.id }]);

    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.organization_id', ${a.id}, true)`;
        await tx.$executeRaw`INSERT INTO "auditLog" (id, "organizationId", action)
                             VALUES (${randomUUID()}, ${b.id}, 'test.forged')`;
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not leak the organization setting to the next query on the connection", async () => {
    const a = await workspace("alpha");
    await a.tenant.auditLog.findMany();
    const [row] = await db.$queryRaw<{ org: string | null }[]>`SELECT app_current_organization_id() AS org`;
    expect(row.org).toBeNull();
  });
});

describe("tenantTransaction", () => {
  it("commits several writes together and rolls back on failure", async () => {
    const a = await workspace("alpha");
    await runTenantTransaction(db, a.id, async (tenant) => {
      await tenant.auditLog.create({ data: { action: "test.first" } });
      await tenant.auditLog.create({ data: { action: "test.second" } });
    });
    expect(await a.tenant.auditLog.count()).toBe(3);

    await expect(
      runTenantTransaction(db, a.id, async (tenant) => {
        await tenant.auditLog.create({ data: { action: "test.third" } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await a.tenant.auditLog.count()).toBe(3);
  });
});

describe("audit log", () => {
  it("is append-only", async () => {
    const a = await workspace("alpha");
    await expect(
      a.tenant.auditLog.update({ where: { id: a.entry.id }, data: { action: "test.changed" } }),
    ).rejects.toThrow(/append-only/);
    await expect(a.tenant.auditLog.delete({ where: { id: a.entry.id } })).rejects.toThrow(
      /append-only/,
    );
  });

  it("rejects malformed action names", async () => {
    const a = await workspace("alpha");
    await expect(a.tenant.auditLog.create({ data: { action: "Settings Updated" } })).rejects.toThrow(
      /auditLog_action_check/,
    );
  });

  it("keeps entries when the actor's account is deleted, and goes with the organization", async () => {
    const a = await workspace("alpha");
    await db.user.delete({ where: { id: a.userId } });
    expect(await a.tenant.auditLog.findUnique({ where: { id: a.entry.id } })).toMatchObject({
      actorUserId: null,
    });

    await db.organization.delete({ where: { id: a.id } });
    expect(await a.tenant.auditLog.count()).toBe(0);
  });
});
