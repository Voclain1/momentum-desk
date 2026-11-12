import type { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { zonedTimeToUtc } from "@/lib/dates";
import { AuthorizationError } from "@/lib/auth/authorization";
import { InputValidationError, RecordNotFoundError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import { type Parent, parentFields, requireParent } from "@/lib/records/parent";
import type { TenantData } from "@/lib/tenant/core";
import { activityInputSchema, fieldErrors } from "./schema";

/**
 * Notes and logged interactions on a lead or customer, and the record's
 * timeline: those activities merged with its history from the audit log.
 * Callers check the parent's read/write permission (sales or customers).
 */

export interface Actor {
  organizationId: string;
  userId: string;
  /** The workspace's timezone, for wall-clock times entered in forms. */
  timezone: string;
}

/** Latest entries shown on a record. */
export const TIMELINE_LIMIT = 100;
/** Logged times may be at most this far in the future (clock drift). */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

function parse(input: unknown, timezone: string) {
  const result = activityInputSchema.safeParse(input);
  if (!result.success) throw new InputValidationError(fieldErrors(result.error as z.ZodError));
  const { occurredAt, ...rest } = result.data;
  const when = occurredAt ? zonedTimeToUtc(occurredAt, timezone) : new Date();
  if (when.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    throw new InputValidationError({ occurredAt: "cannot be in the future" });
  }
  return { ...rest, occurredAt: when };
}

export async function addActivity(data: TenantData, actor: Actor, parent: Parent, input: unknown) {
  const values = parse(input, actor.timezone);
  return data.transaction(actor.organizationId, async (tenant) => {
    await requireParent(tenant, parent);
    // Adding is visible in the timeline itself; edits and removals are audited.
    return tenant.activity.create({ data: { ...values, ...parentFields(parent), authorUserId: actor.userId } });
  });
}

export async function getActivity(data: TenantData, organizationId: string, id: string) {
  const activity = await data.scoped(organizationId).activity.findUnique({ where: { id } });
  if (!activity) throw new RecordNotFoundError("Note");
  return activity;
}

/** Only the author edits an activity. */
export async function updateActivity(data: TenantData, actor: Actor, id: string, input: unknown) {
  const values = parse(input, actor.timezone);
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.activity.findUnique({ where: { id } });
    if (!current) throw new RecordNotFoundError("Note");
    if (current.authorUserId !== actor.userId) throw new AuthorizationError(403);
    const activity = await tenant.activity.update({ where: { id }, data: { ...values, editedAt: new Date() } });
    await recordAudit(tenant, {
      action: "activity.updated",
      actorUserId: actor.userId,
      targetType: "activity",
      targetId: id,
      metadata: { kind: activity.kind, leadId: current.leadId, customerId: current.customerId },
    });
    return activity;
  });
}

/** The author, or someone who manages the workspace, removes an activity. */
export async function removeActivity(data: TenantData, actor: Actor, id: string, canModerate: boolean) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.activity.findUnique({ where: { id } });
    if (!current) throw new RecordNotFoundError("Note");
    if (current.authorUserId !== actor.userId && !canModerate) throw new AuthorizationError(403);
    await tenant.activity.delete({ where: { id } });
    await recordAudit(tenant, {
      action: "activity.removed",
      actorUserId: actor.userId,
      targetType: "activity",
      targetId: id,
      metadata: { kind: current.kind, leadId: current.leadId, customerId: current.customerId },
    });
  });
}

export type TimelineEntry =
  | {
      type: "activity";
      at: Date;
      id: string;
      kind: string;
      body: string;
      authorUserId: string | null;
      authorName: string | null;
      edited: boolean;
    }
  | { type: "event"; at: Date; id: string; action: string; actorName: string | null; metadata: Prisma.JsonValue };

/** Activities and audit history for one record, newest first. */
export async function getTimeline(data: TenantData, organizationId: string, parent: Parent): Promise<TimelineEntry[]> {
  const tenant = data.scoped(organizationId);
  const key = parent.type === "lead" ? "leadId" : "customerId";
  const [activities, events] = await Promise.all([
    tenant.activity.findMany({
      where: { [key]: parent.id },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: TIMELINE_LIMIT,
      include: { author: { select: { name: true } } },
    }),
    tenant.auditLog.findMany({
      where: {
        OR: [
          { targetType: parent.type, targetId: parent.id },
          // Contacts, tasks and removed notes name their record in metadata.
          { metadata: { path: [key], equals: parent.id } },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TIMELINE_LIMIT,
      include: { actor: { select: { name: true } } },
    }),
  ]);
  return [
    ...activities.map((activity) => ({
      type: "activity" as const,
      at: activity.occurredAt,
      id: activity.id,
      kind: activity.kind,
      body: activity.body,
      authorUserId: activity.authorUserId,
      authorName: activity.author?.name ?? null,
      edited: Boolean(activity.editedAt),
    })),
    ...events.map((event) => ({
      type: "event" as const,
      at: event.createdAt,
      id: event.id,
      action: event.action,
      actorName: event.actor?.name ?? null,
      metadata: event.metadata,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, TIMELINE_LIMIT);
}
