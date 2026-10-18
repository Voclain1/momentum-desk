import {
  AuthorizationError,
  createTenantAuthorizer,
  type Membership,
} from "../tenancy/authorization";
import {
  parseNewWorkspace,
  parseOrganizationSettings,
  WorkspaceValidationError,
  type OrganizationSettings,
} from "./settings";

export type Workspace = Readonly<{ id: string; name: string; slug: string }>;
export type StoredSettings = Readonly<{
  organizationId: string;
  version: number;
  values: OrganizationSettings;
}>;
export type WorkspaceAuditEvent = Readonly<{
  organizationId: string;
  actorUserId: string;
  action: "workspace.created" | "workspace.settings.updated";
  settingsVersion: number;
  changedFields: readonly string[];
}>;

/**
 * Database integration contract. All operations MUST use the same transaction
 * client. Creation must enforce unique slug and unique (organizationId,userId)
 * membership. The database supplies IDs, audit timestamps, and referential FKs.
 */
export type WorkspaceTransaction = {
  createOrganization: (input: { name: string; slug: string }) => Promise<Workspace>;
  createOwnerMembership: (input: { organizationId: string; userId: string }) => Promise<void>;
  createSettings: (input: StoredSettings) => Promise<void>;
  findMembership: (userId: string, organizationId: string) => Promise<Membership | null>;
  findSettings: (organizationId: string) => Promise<StoredSettings | null>;
  /** Atomic compare-and-set on BOTH organizationId and version; false if stale. */
  replaceSettings: (input: StoredSettings, expectedVersion: number) => Promise<boolean>;
  appendAuditLog: (event: WorkspaceAuditEvent) => Promise<void>;
};

export type WorkspaceDependencies = {
  getSessionUserId: () => Promise<string | null>;
  /** Roll back ALL writes when the callback throws, including on audit failure. */
  transaction: <T>(work: (tx: WorkspaceTransaction) => Promise<T>) => Promise<T>;
};

export class WorkspaceConflictError extends Error {
  constructor() {
    super("Workspace settings changed; reload before saving");
    this.name = "WorkspaceConflictError";
  }
}

/** Framework-independent server service; no production adapter is installed yet. */
export function createWorkspaceService(dependencies: WorkspaceDependencies) {
  async function sessionUserId(): Promise<string> {
    const userId = await dependencies.getSessionUserId();
    if (!userId) throw new AuthorizationError(401);
    return userId;
  }

  async function createWorkspace(input: unknown): Promise<{ workspace: Workspace; settings: StoredSettings }> {
    const userId = await sessionUserId();
    const parsed = parseNewWorkspace(input);
    return dependencies.transaction(async (tx) => {
      const workspace = await tx.createOrganization({ name: parsed.name, slug: parsed.slug });
      await tx.createOwnerMembership({ organizationId: workspace.id, userId });
      const settings: StoredSettings = { organizationId: workspace.id, version: 1, values: parsed.settings };
      await tx.createSettings(settings);
      await tx.appendAuditLog({
        organizationId: workspace.id,
        actorUserId: userId,
        action: "workspace.created",
        settingsVersion: 1,
        changedFields: Object.keys(parsed.settings),
      });
      return { workspace, settings };
    });
  }

  async function updateSettings(organizationId: string, expectedVersion: number, input: unknown): Promise<StoredSettings> {
    const userId = await sessionUserId();
    return dependencies.transaction(async (tx) => {
      // Membership is checked inside the write transaction, not from cached UI state.
      const guard = createTenantAuthorizer({ getSessionUserId: async () => userId, findMembership: tx.findMembership });
      await guard.requireOrganizationAccess(organizationId, "settings:write");
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || expectedVersion >= Number.MAX_SAFE_INTEGER) {
        throw new WorkspaceValidationError(["version"]);
      }
      const values = parseOrganizationSettings(input);
      const current = await tx.findSettings(organizationId);
      if (!current || current.organizationId !== organizationId) throw new AuthorizationError(404);
      if (current.version !== expectedVersion) throw new WorkspaceConflictError();
      // M0 deliberately disallows rebasing; future changes require explicit FX/history rules.
      if (current.values.baseCurrency !== values.baseCurrency) throw new WorkspaceValidationError(["baseCurrency"]);
      const changedFields = (Object.keys(values) as (keyof OrganizationSettings)[])
        .filter((key) => current.values[key] !== values[key]);
      if (!changedFields.length) return current;
      const next: StoredSettings = { organizationId, version: current.version + 1, values };
      if (!await tx.replaceSettings(next, expectedVersion)) throw new WorkspaceConflictError();
      await tx.appendAuditLog({
        organizationId, actorUserId: userId, action: "workspace.settings.updated",
        settingsVersion: next.version, changedFields,
      });
      return next;
    });
  }

  return { createWorkspace, updateSettings };
}
