import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryEmailSender } from "@/lib/email";
import { createTenantDb } from "@/lib/tenant/core";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { createAuth } from "./server";

const db = createTestDb();
const email = createMemoryEmailSender();
const auth = createAuth({
  db,
  email,
  secret: "test-secret-that-is-at-least-32-characters",
  baseURL: "http://localhost:3000",
  rateLimit: false,
});

beforeEach(async () => {
  await resetDatabase();
  email.sent.length = 0;
});
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

const PASSWORD = "correct horse battery";

/** Turns Set-Cookie response headers into a Cookie request header. */
function cookieHeaders(response: Headers): Headers {
  const cookies = response
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  return new Headers({ cookie: cookies });
}

async function signUp(address = "ada@example.com", password = PASSWORD) {
  const { headers } = await auth.api.signUpEmail({
    body: { name: "Ada Obi", email: address, password },
    returnHeaders: true,
  });
  return cookieHeaders(headers);
}

function linkFrom(text: string): URL {
  const match = text.match(/https?:\/\/\S+/);
  if (!match) throw new Error(`No link in email: ${text}`);
  return new URL(match[0]);
}

const settings = {
  baseCurrency: "USD",
  countryCode: "NG",
  locale: "en-NG",
  timezone: "Africa/Lagos",
  defaultLanguage: "en",
};

describe("email and password", () => {
  it("creates a user with a hashed password and a session", async () => {
    const headers = await signUp();
    const session = await auth.api.getSession({ headers });
    expect(session?.user.email).toBe("ada@example.com");

    const account = await db.account.findFirstOrThrow({ where: { userId: session!.user.id } });
    expect(account.providerId).toBe("credential");
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain(PASSWORD);
  });

  it("sends a verification email on sign-up without blocking sign-in", async () => {
    await signUp();
    expect(email.lastTo("ada@example.com")?.subject).toMatch(/confirm your email/i);
  });

  it("rejects passwords shorter than 12 characters", async () => {
    await expect(signUp("ada@example.com", "short-pass")).rejects.toMatchObject({
      body: { code: "PASSWORD_TOO_SHORT" },
    });
    expect(await db.user.count()).toBe(0);
  });

  it("rejects a second account for the same email", async () => {
    await signUp();
    await expect(signUp()).rejects.toThrow();
    expect(await db.user.count()).toBe(1);
  });

  it("signs in with the right password only", async () => {
    await signUp();
    await expect(
      auth.api.signInEmail({ body: { email: "ada@example.com", password: "wrong password!" } }),
    ).rejects.toMatchObject({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } });
    const result = await auth.api.signInEmail({ body: { email: "ada@example.com", password: PASSWORD } });
    expect(result.user.email).toBe("ada@example.com");
  });

  it("resets a password by emailed link and signs out other sessions", async () => {
    const oldSession = await signUp();
    await auth.api.requestPasswordReset({
      body: { email: "ada@example.com", redirectTo: "/reset-password" },
    });
    const link = linkFrom(email.lastTo("ada@example.com")!.text);
    const token = link.pathname.split("/").pop()!;

    await auth.api.resetPassword({ body: { token, newPassword: "a brand new passphrase" } });

    expect(await auth.api.getSession({ headers: oldSession })).toBeNull();
    await expect(
      auth.api.signInEmail({ body: { email: "ada@example.com", password: PASSWORD } }),
    ).rejects.toThrow();
    await auth.api.signInEmail({
      body: { email: "ada@example.com", password: "a brand new passphrase" },
    });
  });
});

describe("magic link", () => {
  it("signs in with a single-use link and never stores the raw token", async () => {
    await auth.api.signInMagicLink({ body: { email: "new@example.com" }, headers: new Headers() });
    const link = linkFrom(email.lastTo("new@example.com")!.text);
    const token = link.searchParams.get("token")!;
    expect(token).toBeTruthy();

    const stored = await db.verification.findMany();
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(token);

    const { headers } = await auth.api.magicLinkVerify({
      query: { token },
      headers: new Headers(),
      returnHeaders: true,
    });
    const session = await auth.api.getSession({ headers: cookieHeaders(headers) });
    expect(session?.user).toMatchObject({ email: "new@example.com", emailVerified: true });

    await expect(
      auth.api.magicLinkVerify({ query: { token }, headers: new Headers() }),
    ).rejects.toThrow();
  });
});

describe("workspace creation", () => {
  it("creates the organization with its settings, makes the creator owner and activates it", async () => {
    const headers = await signUp();
    const org = await auth.api.createOrganization({
      body: { name: "Acme Solar", slug: "acme-solar", ...settings, defaultInvoiceCurrency: "GBP" },
      headers,
    });

    expect(await db.organization.findUniqueOrThrow({ where: { id: org!.id } })).toMatchObject({
      ...settings,
      defaultInvoiceCurrency: "GBP",
    });
    const member = await db.member.findFirstOrThrow({ where: { organizationId: org!.id } });
    expect(member.role).toBe("owner");
    const session = await auth.api.getSession({ headers });
    expect(session?.session.activeOrganizationId).toBe(org!.id);
  });

  it("stores no default invoice currency unless one is chosen", async () => {
    const headers = await signUp();
    const org = await auth.api.createOrganization({
      body: { name: "Acme Solar", slug: "acme-solar", ...settings },
      headers,
    });
    expect(
      (await db.organization.findUniqueOrThrow({ where: { id: org!.id } })).defaultInvoiceCurrency,
    ).toBeNull();
  });

  it.each([
    ["baseCurrency", "XXX"],
    ["countryCode", "ZZ"],
    ["locale", "en_GB"],
    ["timezone", "+01:00"],
    ["defaultLanguage", "english"],
    ["defaultInvoiceCurrency", "usd"],
    ["slug", "Acme Solar"],
  ])("rejects an invalid %s (%j) and creates nothing", async (field, value) => {
    const headers = await signUp();
    await expect(
      auth.api.createOrganization({
        body: { name: "Acme Solar", slug: "acme-solar", ...settings, [field]: value },
        headers,
      }),
    ).rejects.toMatchObject({ statusCode: 400, body: { message: expect.stringContaining(field) } });
    expect(await db.organization.count()).toBe(0);
    expect(await db.member.count()).toBe(0);
  });

  it("requires a signed-in user", async () => {
    await expect(
      auth.api.createOrganization({
        body: { name: "Acme Solar", slug: "acme-solar", ...settings },
        headers: new Headers(),
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe("workspace settings", () => {
  async function workspaceWithMember(role: "admin" | "sales" | "finance" | "member") {
    const ownerHeaders = await signUp("owner@example.com");
    const org = await auth.api.createOrganization({
      body: { name: "Acme Solar", slug: "acme-solar", ...settings },
      headers: ownerHeaders,
    });
    const memberHeaders = await signUp("teammate@example.com");
    const teammate = await db.user.findUniqueOrThrow({ where: { email: "teammate@example.com" } });
    await auth.api.addMember({ body: { organizationId: org!.id, userId: teammate.id, role } });
    await auth.api.setActiveOrganization({ body: { organizationId: org!.id }, headers: memberHeaders });
    return { org: org!, ownerHeaders, memberHeaders };
  }

  it("lets the owner change settings, validating only what changes", async () => {
    const { org, ownerHeaders } = await workspaceWithMember("member");
    await auth.api.updateOrganization({
      body: { organizationId: org.id, data: { timezone: "Europe/London" } },
      headers: ownerHeaders,
    });
    expect(await db.organization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({
      timezone: "Europe/London",
      baseCurrency: "USD",
    });

    await expect(
      auth.api.updateOrganization({
        body: { organizationId: org.id, data: { baseCurrency: "DOLLARS" } },
        headers: ownerHeaders,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("lets an admin change settings", async () => {
    const { org, memberHeaders } = await workspaceWithMember("admin");
    await auth.api.updateOrganization({
      body: { organizationId: org.id, data: { locale: "en-GB" } },
      headers: memberHeaders,
    });
    expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).locale).toBe("en-GB");
  });

  it.each(["sales", "finance", "member"] as const)("does not let %s change settings", async (role) => {
    const { org, memberHeaders } = await workspaceWithMember(role);
    await expect(
      auth.api.updateOrganization({
        body: { organizationId: org.id, data: { baseCurrency: "EUR" } },
        headers: memberHeaders,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).baseCurrency).toBe("USD");
  });

  it("does not let an admin delete the workspace", async () => {
    const { org, memberHeaders } = await workspaceWithMember("admin");
    await expect(
      auth.api.deleteOrganization({ body: { organizationId: org.id }, headers: memberHeaders }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("does not let a non-member change another workspace", async () => {
    const { org } = await workspaceWithMember("member");
    const outsider = await signUp("outsider@example.com");
    await expect(
      auth.api.updateOrganization({
        body: { organizationId: org.id, data: { name: "Hijacked" } },
        headers: outsider,
      }),
    ).rejects.toMatchObject({ body: { message: expect.stringMatching(/not a member/i) } });
    expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).name).toBe("Acme Solar");
  });
});

describe("audit trail", () => {
  async function auditFor(organizationId: string) {
    return createTenantDb(db, organizationId).auditLog.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  }

  it("records workspace creation with its full starting settings", async () => {
    const headers = await signUp();
    const user = await db.user.findUniqueOrThrow({ where: { email: "ada@example.com" } });
    const org = await auth.api.createOrganization({
      body: { name: "Acme Solar", slug: "acme-solar", ...settings },
      headers,
    });

    const [joined, created] = await auditFor(org!.id);
    expect(joined).toMatchObject({
      action: "member.added",
      actorUserId: user.id,
      metadata: { userId: user.id, role: "owner" },
    });
    expect(created).toMatchObject({
      action: "organization.created",
      actorUserId: user.id,
      targetType: "organization",
      targetId: org!.id,
      metadata: { name: "Acme Solar", slug: "acme-solar", ...settings, defaultInvoiceCurrency: null },
    });
  });

  it("records settings changes, role changes and invitations with who made them", async () => {
    const ownerHeaders = await signUp("owner@example.com");
    const owner = await db.user.findUniqueOrThrow({ where: { email: "owner@example.com" } });
    const org = await auth.api.createOrganization({
      body: { name: "Acme Solar", slug: "acme-solar", ...settings },
      headers: ownerHeaders,
    });
    await signUp("teammate@example.com");
    const teammate = await db.user.findUniqueOrThrow({ where: { email: "teammate@example.com" } });
    const member = await auth.api.addMember({
      body: { organizationId: org!.id, userId: teammate.id, role: "member" },
    });

    await auth.api.updateOrganization({
      body: { organizationId: org!.id, data: { timezone: "Europe/London" } },
      headers: ownerHeaders,
    });
    await auth.api.updateMemberRole({
      body: { organizationId: org!.id, memberId: member!.id, role: "finance" },
      headers: ownerHeaders,
    });
    await auth.api.createInvitation({
      body: { organizationId: org!.id, email: "new@example.com", role: "sales" },
      headers: ownerHeaders,
    });

    const entries = await auditFor(org!.id);
    expect(entries.map(({ action, actorUserId, metadata }) => ({ action, actorUserId, metadata }))).toEqual([
      { action: "member.added", actorUserId: owner.id, metadata: { userId: owner.id, role: "owner" } },
      expect.objectContaining({ action: "organization.created", actorUserId: owner.id }),
      // Added from server code with no signed-in user.
      { action: "member.added", actorUserId: null, metadata: { userId: teammate.id, role: "member" } },
      expect.objectContaining({
        action: "organization.updated",
        actorUserId: owner.id,
        metadata: expect.objectContaining({ timezone: "Europe/London", baseCurrency: "USD" }),
      }),
      {
        action: "member.role_updated",
        actorUserId: owner.id,
        metadata: { userId: teammate.id, from: "member", to: "finance" },
      },
      { action: "invitation.created", actorUserId: owner.id, metadata: { email: "new@example.com", role: "sales" } },
    ]);
  });

  it("is not visible from another workspace", async () => {
    const headersA = await signUp("a@example.com");
    const orgA = await auth.api.createOrganization({
      body: { name: "Alpha", slug: "alpha", ...settings },
      headers: headersA,
    });
    const headersB = await signUp("b@example.com");
    const orgB = await auth.api.createOrganization({
      body: { name: "Bravo", slug: "bravo", ...settings },
      headers: headersB,
    });
    expect((await auditFor(orgA!.id)).every((entry) => entry.organizationId === orgA!.id)).toBe(true);
    expect((await auditFor(orgB!.id)).every((entry) => entry.organizationId === orgB!.id)).toBe(true);
    expect(await db.auditLog.count()).toBe(0);
  });
});
