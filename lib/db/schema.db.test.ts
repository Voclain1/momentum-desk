import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, resetDatabase } from "@/test/db";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

const settings = {
  baseCurrency: "USD",
  countryCode: "NG",
  locale: "en-NG",
  timezone: "Africa/Lagos",
  defaultLanguage: "en",
};

function createUser(email = `${randomUUID()}@example.com`) {
  return db.user.create({ data: { id: randomUUID(), name: "Ada", email } });
}

function createOrganization(overrides: Partial<typeof settings & { slug: string }> = {}) {
  return db.organization.create({
    data: { id: randomUUID(), name: "Acme Solar", slug: `acme-${randomUUID()}`, ...settings, ...overrides },
  });
}

describe("organization", () => {
  it("stores global settings without deriving one from another", async () => {
    const org = await createOrganization({ baseCurrency: "GBP", countryCode: "KE" });
    expect(await db.organization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({
      baseCurrency: "GBP",
      countryCode: "KE",
      locale: "en-NG",
      timezone: "Africa/Lagos",
      defaultLanguage: "en",
      defaultInvoiceCurrency: null,
    });
  });

  it.each([
    ["baseCurrency", "usd"],
    ["baseCurrency", "US"],
    ["defaultInvoiceCurrency", "EURO"],
    ["countryCode", "NGA"],
    ["locale", ""],
    ["timezone", ""],
    ["defaultLanguage", ""],
    ["slug", "Acme Solar"],
  ])("rejects a malformed %s (%j) at the database level", async (field, value) => {
    await expect(createOrganization({ [field]: value })).rejects.toThrow(
      `organization_${field}_check`,
    );
  });

  it("requires a unique slug", async () => {
    await createOrganization({ slug: "acme" });
    await expect(createOrganization({ slug: "acme" })).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("member", () => {
  it("allows a user to belong to several organizations", async () => {
    const user = await createUser();
    const [a, b] = [await createOrganization(), await createOrganization()];
    for (const org of [a, b]) {
      await db.member.create({ data: { id: randomUUID(), organizationId: org.id, userId: user.id } });
    }
    expect(await db.member.count({ where: { userId: user.id } })).toBe(2);
  });

  it("allows only one membership per user per organization", async () => {
    const [user, org] = [await createUser(), await createOrganization()];
    const data = { organizationId: org.id, userId: user.id };
    await db.member.create({ data: { id: randomUUID(), ...data } });
    await expect(
      db.member.create({ data: { id: randomUUID(), ...data, role: "admin" } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("defaults the role to member", async () => {
    const [user, org] = [await createUser(), await createOrganization()];
    const member = await db.member.create({
      data: { id: randomUUID(), organizationId: org.id, userId: user.id },
    });
    expect(member.role).toBe("member");
  });
});

describe("invitation", () => {
  it("rejects an unknown status", async () => {
    const [inviter, org] = [await createUser(), await createOrganization()];
    await expect(
      db.invitation.create({
        data: {
          id: randomUUID(),
          organizationId: org.id,
          inviterId: inviter.id,
          email: "new@example.com",
          role: "member",
          status: "expired",
        },
      }),
    ).rejects.toThrow("invitation_status_check");
  });
});

describe("deletion", () => {
  it("removes an organization's memberships and invitations with it, but not its users", async () => {
    const [user, org] = [await createUser(), await createOrganization()];
    await db.member.create({ data: { id: randomUUID(), organizationId: org.id, userId: user.id } });
    await db.invitation.create({
      data: { id: randomUUID(), organizationId: org.id, inviterId: user.id, email: "x@example.com", role: "member" },
    });

    await db.organization.delete({ where: { id: org.id } });

    expect(await db.member.count()).toBe(0);
    expect(await db.invitation.count()).toBe(0);
    expect(await db.user.count()).toBe(1);
  });

  it("removes a user's sessions, accounts and memberships with them, but not the organization", async () => {
    const [user, org] = [await createUser(), await createOrganization()];
    await db.member.create({ data: { id: randomUUID(), organizationId: org.id, userId: user.id } });
    await db.session.create({
      data: { id: randomUUID(), token: randomUUID(), userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    });
    await db.account.create({
      data: { id: randomUUID(), accountId: user.id, providerId: "credential", userId: user.id },
    });

    await db.user.delete({ where: { id: user.id } });

    expect(await db.member.count()).toBe(0);
    expect(await db.session.count()).toBe(0);
    expect(await db.account.count()).toBe(0);
    expect(await db.organization.count()).toBe(1);
  });
});

describe("timestamps", () => {
  it("are all stored with a time zone", async () => {
    const columns = await db.$queryRaw<{ table_name: string; column_name: string; data_type: string }[]>`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
        AND data_type LIKE 'timestamp%'`;
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.filter((column) => column.data_type !== "timestamp with time zone")).toEqual([]);
  });
});
