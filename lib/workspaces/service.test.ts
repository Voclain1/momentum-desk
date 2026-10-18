import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { AuthorizationError, type Membership } from "../tenancy/authorization";
import { parseOrganizationSettings, WorkspaceValidationError } from "./settings";
import {
  createWorkspaceService, WorkspaceConflictError,
  type StoredSettings, type Workspace, type WorkspaceAuditEvent, type WorkspaceDependencies,
} from "./service";

const values = parseOrganizationSettings({
  baseCurrency: "GBP", countryCode: "GB", locale: "en-GB", timezone: "Europe/London", defaultLanguage: "en",
});
const newWorkspace = { name: "Acme", slug: "acme", settings: values };

/** Unit-test transaction double. This does not prove real Postgres rollback. */
function setup() {
  let userId: string | null = "alice";
  let data: {
    organizations: Workspace[]; memberships: Membership[];
    settings: StoredSettings[]; audits: WorkspaceAuditEvent[];
  } = {
    organizations: [{ id: "org-a", name: "Existing", slug: "existing" }],
    memberships: [{ organizationId: "org-a", userId: "alice", role: "owner" }],
    settings: [{ organizationId: "org-a", version: 1, values }], audits: [],
  };
  let transactions = 0;
  let auditFailure = false;
  let settingsRace = false;
  const dependencies: WorkspaceDependencies = {
    getSessionUserId: async () => userId,
    transaction: async (work) => {
      transactions++;
      const draft = structuredClone(data);
      const result = await work({
        createOrganization: async (input) => {
          if (draft.organizations.some((item) => item.slug === input.slug)) throw new Error("Unique slug violation");
          const workspace = { id: "org-new", ...input };
          draft.organizations.push(workspace);
          return workspace;
        },
        createOwnerMembership: async (input) => { draft.memberships.push({ ...input, role: "owner" }); },
        createSettings: async (input) => { draft.settings.push(input); },
        findMembership: async (user, org) => draft.memberships.find((item) => item.userId === user && item.organizationId === org) ?? null,
        findSettings: async (org) => draft.settings.find((item) => item.organizationId === org) ?? null,
        replaceSettings: async (input, version) => {
          if (settingsRace) return false;
          const index = draft.settings.findIndex((item) => item.organizationId === input.organizationId && item.version === version);
          if (index === -1) return false;
          draft.settings[index] = input;
          return true;
        },
        appendAuditLog: async (event) => {
          if (auditFailure) throw new Error("Audit storage failed");
          draft.audits.push(event);
        },
      });
      data = draft;
      return result;
    },
  };
  return {
    ...createWorkspaceService(dependencies),
    data: () => data,
    transactions: () => transactions,
    setUser: (user: string | null) => { userId = user; },
    failAudit: () => { auditFailure = true; },
    race: () => { settingsRace = true; },
  };
}

describe("workspace onboarding service", () => {
  it("creates organization, session owner's membership, explicit settings and audit in one transaction", async () => {
    const service = setup();
    const result = await service.createWorkspace(newWorkspace);
    assert.equal(service.transactions(), 1);
    assert.equal(result.workspace.id, "org-new");
    assert.deepEqual(service.data().memberships[1], { organizationId: "org-new", userId: "alice", role: "owner" });
    assert.deepEqual(result.settings, { organizationId: "org-new", version: 1, values });
    assert.equal(service.data().audits[0].actorUserId, "alice");
    assert.equal(service.data().audits[0].action, "workspace.created");
    assert.equal(service.data().audits[0].organizationId, "org-new");
  });

  it("rejects anonymous and invalid input before opening a transaction", async () => {
    const service = setup();
    service.setUser(null);
    await assert.rejects(service.createWorkspace(newWorkspace), AuthorizationError);
    service.setUser("alice");
    await assert.rejects(service.createWorkspace({ ...newWorkspace, userId: "bob" }), WorkspaceValidationError);
    assert.equal(service.transactions(), 0);
  });

  it("does not commit partial onboarding when audit persistence fails", async () => {
    const service = setup();
    const before = structuredClone(service.data());
    service.failAudit();
    await assert.rejects(service.createWorkspace(newWorkspace), /Audit storage failed/);
    assert.deepEqual(service.data(), before);
  });

  it("propagates duplicate slug errors without granting another membership", async () => {
    const service = setup();
    await assert.rejects(service.createWorkspace({ ...newWorkspace, slug: "existing" }), /Unique slug/);
    assert.equal(service.data().memberships.length, 1);
    assert.equal(service.data().audits.length, 0);
  });
});

describe("workspace settings service", () => {
  it("updates only the authorized tenant with version and field-level audit metadata", async () => {
    const service = setup();
    const result = await service.updateSettings("org-a", 1, { ...values, locale: "fr-FR", defaultInvoiceCurrency: "JPY" });
    assert.equal(result.version, 2);
    assert.equal(result.organizationId, "org-a");
    assert.deepEqual(service.data().audits, [{
      organizationId: "org-a", actorUserId: "alice", action: "workspace.settings.updated",
      settingsVersion: 2, changedFields: ["locale", "defaultInvoiceCurrency"],
    }]);
  });

  it("denies cross-tenant updates even to an owner of another organization", async () => {
    const service = setup();
    await assert.rejects(service.updateSettings("org-b", 1, values), AuthorizationError);
    assert.equal(service.data().audits.length, 0);
  });

  it("requires settings permission from current membership", async () => {
    for (const role of ["sales", "finance", "member"]) {
      const service = setup();
      service.data().memberships[0] = { organizationId: "org-a", userId: "alice", role };
      await assert.rejects(service.updateSettings("org-a", 1, values), AuthorizationError);
    }
  });

  it("allows an admin to update global settings", async () => {
    const service = setup();
    service.data().memberships[0] = { organizationId: "org-a", userId: "alice", role: "admin" };
    assert.equal((await service.updateSettings("org-a", 1, { ...values, countryCode: "US" })).values.baseCurrency, "GBP");
  });

  it("rejects anonymous sessions and revoked memberships", async () => {
    const service = setup();
    service.setUser(null);
    await assert.rejects(service.updateSettings("org-a", 1, values), AuthorizationError);
    service.setUser("alice");
    service.data().memberships = [];
    await assert.rejects(service.updateSettings("org-a", 1, values), AuthorizationError);
  });

  it("rejects stale versions and compare-and-set races without writing audit", async () => {
    const service = setup();
    await assert.rejects(service.updateSettings("org-a", 2, values), WorkspaceConflictError);
    service.race();
    await assert.rejects(service.updateSettings("org-a", 1, { ...values, locale: "fr-FR" }), WorkspaceConflictError);
    assert.equal(service.data().settings[0].version, 1);
    assert.equal(service.data().audits.length, 0);
  });

  it("rejects invalid versions, settings and base currency rebasing", async () => {
    const service = setup();
    for (const version of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      await assert.rejects(service.updateSettings("org-a", version, values), WorkspaceValidationError);
    }
    await assert.rejects(service.updateSettings("org-a", 1, { ...values, baseCurrency: "USD" }), WorkspaceValidationError);
    await assert.rejects(service.updateSettings("org-a", 1, { ...values, timezone: "invalid" }), WorkspaceValidationError);
    assert.equal(service.data().audits.length, 0);
  });

  it("treats unchanged settings as a no-op without bumping version", async () => {
    const service = setup();
    assert.equal((await service.updateSettings("org-a", 1, values)).version, 1);
    assert.equal(service.data().audits.length, 0);
  });

  it("aborts settings changes when the audit insert fails", async () => {
    const service = setup();
    service.failAudit();
    await assert.rejects(service.updateSettings("org-a", 1, { ...values, locale: "fr-FR" }), /Audit storage failed/);
    assert.equal(service.data().settings[0].version, 1);
    assert.equal(service.data().settings[0].values.locale, "en-GB");
  });

  it("does not update missing settings", async () => {
    const service = setup();
    service.data().settings = [];
    await assert.rejects(service.updateSettings("org-a", 1, values), (error) => error instanceof AuthorizationError && error.status === 404);
  });
});
