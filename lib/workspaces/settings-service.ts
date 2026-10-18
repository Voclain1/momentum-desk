import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { AuthorizationError, hasPermission } from "@/lib/auth/authorization";
import type { DbClient } from "@/lib/db/client";
import { Prisma } from "@/lib/generated/prisma/client";
import { organizationSettingsSchema } from "@/lib/organizations/settings";
import { tenantInTransaction } from "@/lib/tenant/core";

/**
 * The only way to change a workspace's name or settings. Design from the
 * Codex workspace-foundations branch (e0e033d), implemented on Postgres:
 *
 * - Membership and the settings:write permission are re-checked inside the
 *   write transaction, so a role removed a moment ago cannot still save.
 * - Saves name the settings version they were based on; a stale version is a
 *   conflict, never a silent overwrite of someone else's change.
 * - The audit entry is written in the same transaction: no change without it.
 * - The base currency cannot change (also enforced by a database trigger).
 *
 * Better Auth's own organization update endpoint is disabled (lib/auth/server.ts).
 */

const EDITABLE_FIELDS = [
  "name",
  "countryCode",
  "locale",
  "timezone",
  "defaultLanguage",
  "defaultInvoiceCurrency",
] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

const updateSchema = organizationSettingsSchema
  .omit({ baseCurrency: true })
  .extend({ name: z.string().trim().min(1, { error: "is required" }).max(100) });

export type WorkspaceSettingsUpdate = z.input<typeof updateSchema>;

export class WorkspaceValidationError extends Error {
  /** Field name → message. Messages never repeat the submitted value. */
  constructor(readonly fields: Readonly<Record<string, string>>) {
    super(`Invalid workspace settings: ${Object.keys(fields).join(", ")}`);
    this.name = "WorkspaceValidationError";
  }
}

export class WorkspaceConflictError extends Error {
  constructor() {
    super("Workspace settings were changed by someone else. Reload and try again.");
    this.name = "WorkspaceConflictError";
  }
}

export interface UpdateWorkspaceSettings {
  /** From the verified session, never from the request. */
  userId: string;
  /** From requireTenant(), never from the request. */
  organizationId: string;
  /** The settingsVersion the form was loaded with. */
  expectedVersion: number;
  input: unknown;
}

function parseInput(input: unknown) {
  if (typeof input === "object" && input !== null && "baseCurrency" in input) {
    throw new WorkspaceValidationError({ baseCurrency: "cannot be changed after the workspace is created" });
  }
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field =
        issue.code === "unrecognized_keys" ? issue.keys.join(", ") : String(issue.path[0] ?? "input");
      fields[field] ??= issue.code === "unrecognized_keys" ? "is not a workspace setting" : issue.message;
    }
    throw new WorkspaceValidationError(fields);
  }
  return parsed.data;
}

export async function updateWorkspaceSettings(db: DbClient, request: UpdateWorkspaceSettings) {
  const { userId, organizationId, expectedVersion } = request;
  if (!userId) throw new AuthorizationError(401);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new WorkspaceValidationError({ version: "is invalid" });
  }
  const values = parseInput(request.input);

  try {
    return await db.$transaction(
      async (tx) => {
        const membership = await tx.member.findUnique({
          where: { organizationId_userId: { organizationId, userId } },
          select: { role: true },
        });
        if (!membership || !hasPermission(membership.role, "settings:write")) {
          throw new AuthorizationError(403);
        }

        const current = await tx.organization.findUnique({ where: { id: organizationId } });
        if (!current) throw new AuthorizationError(404);
        if (current.settingsVersion !== expectedVersion) throw new WorkspaceConflictError();

        const changes: Partial<Record<EditableField, { from: string | null; to: string | null }>> = {};
        for (const field of EDITABLE_FIELDS) {
          if (current[field] !== values[field]) changes[field] = { from: current[field], to: values[field] };
        }
        if (Object.keys(changes).length === 0) return current;

        // Compare-and-set: only one of two concurrent saves can win.
        const updated = await tx.organization.updateManyAndReturn({
          where: { id: organizationId, settingsVersion: expectedVersion },
          data: { ...values, settingsVersion: { increment: 1 } },
        });
        if (updated.length !== 1) throw new WorkspaceConflictError();
        const [next] = updated;

        await recordAudit(await tenantInTransaction(tx, organizationId), {
          action: "organization.updated",
          actorUserId: userId,
          targetType: "organization",
          targetId: organizationId,
          metadata: { settingsVersion: next.settingsVersion, changes },
        });
        return next;
      },
      // Membership-sensitive write: serialisable, so a concurrent role change
      // and this save cannot both succeed against stale reads.
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    // A serialisation failure means another write raced this one.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new WorkspaceConflictError();
    }
    throw error;
  }
}
