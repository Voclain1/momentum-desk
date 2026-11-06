import type { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { TenantData, TenantDb } from "@/lib/tenant/core";
import { addDays, dateValue } from "@/lib/dates";
import { fieldErrors, type LeadInput, leadInputSchema, type LeadSource } from "./schema";

/**
 * Leads and the pipeline (spec §7.2). Services receive TenantData, so every
 * query is scoped to one workspace; every write is audited in the same
 * transaction, by field name only. Callers check sales:read / sales:write.
 */

export interface Actor {
  organizationId: string;
  userId: string;
}

/** Who may own a lead: the workspace's current members (from the caller). */
export interface LeadContext {
  memberIds: ReadonlySet<string>;
}

export const DEFAULT_STAGES = [
  { key: "new", name: "New", kind: "open" },
  { key: "contacted", name: "Contacted", kind: "open" },
  { key: "qualified", name: "Qualified", kind: "open" },
  { key: "proposal", name: "Quote / proposal", kind: "open" },
  { key: "won", name: "Won", kind: "won" },
  { key: "lost", name: "Lost", kind: "lost" },
] as const;

export type StageKind = "open" | "won" | "lost";

/** Creates the default stages the first time a workspace needs them. Safe to race. */
async function ensureStages(tenant: TenantDb) {
  if ((await tenant.pipelineStage.count()) > 0) return;
  await tenant.pipelineStage.createMany({
    data: DEFAULT_STAGES.map((stage, position) => ({ ...stage, position })),
    skipDuplicates: true,
  });
}

export async function listStages(data: TenantData, organizationId: string) {
  return data.transaction(organizationId, async (tenant) => {
    await ensureStages(tenant);
    return tenant.pipelineStage.findMany({ orderBy: { position: "asc" } });
  });
}

export const PAGE_SIZE = 25;
export const LEAD_SORTS = ["recent", "followup", "created"] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export interface LeadQuery {
  q?: string;
  stageId?: string;
  /** "me", "unassigned" or a user id. */
  owner?: string;
  source?: LeadSource;
  /** Relative to `today` in the workspace's timezone. */
  followUp?: "overdue" | "today" | "week";
  status?: "open" | "won" | "lost" | "all";
  archived?: boolean;
  sort?: LeadSort;
  page?: number;
}

const ORDER: Record<LeadSort, Prisma.LeadOrderByWithRelationInput[]> = {
  recent: [{ updatedAt: "desc" }, { id: "desc" }],
  followup: [{ nextFollowUpOn: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  created: [{ createdAt: "desc" }, { id: "desc" }],
};

export async function listLeads(
  data: TenantData,
  actor: Actor,
  query: LeadQuery,
  /** "YYYY-MM-DD" in the workspace's timezone. */
  today: string,
) {
  const tenant = data.scoped(actor.organizationId);
  const q = query.q?.trim().slice(0, 100);
  const status = query.status ?? "open";
  const where: Prisma.LeadWhereInput = {
    archivedAt: query.archived ? { not: null } : null,
    ...(status !== "all" ? { stage: { kind: status } } : {}),
    ...(query.stageId ? { stageId: query.stageId } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.owner === "me"
      ? { ownerUserId: actor.userId }
      : query.owner === "unassigned"
        ? { ownerUserId: null }
        : query.owner
          ? { ownerUserId: query.owner }
          : {}),
    ...(query.followUp === "overdue"
      ? { nextFollowUpOn: { lt: dateValue(today) } }
      : query.followUp === "today"
        ? { nextFollowUpOn: dateValue(today) }
        : query.followUp === "week"
          ? { nextFollowUpOn: { gte: dateValue(today), lte: dateValue(addDays(today, 7)) } }
          : {}),
    ...(q
      ? {
          OR: [
            { contactName: { contains: q, mode: "insensitive" } },
            { companyName: { contains: q, mode: "insensitive" } },
            { email: { contains: q.toLowerCase() } },
            { summary: { contains: q, mode: "insensitive" } },
            { tags: { has: q } },
          ],
        }
      : {}),
  };
  const total = await tenant.lead.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(query.page ?? 1) || 1), pageCount);
  const items = await tenant.lead.findMany({
    where,
    orderBy: ORDER[query.sort ?? "recent"],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: { stage: true, owner: { select: { name: true } } },
  });
  return { items, total, page, pageCount };
}

/** Per-currency totals; amounts in different currencies are never added together (spec §5.5). */
export type CurrencyTotals = { currency: string; amountMinor: bigint }[];

export const BOARD_CARD_LIMIT = 50;

/** The pipeline board: every stage with its leads, count and per-currency totals. */
export async function getBoard(data: TenantData, organizationId: string) {
  const stages = await listStages(data, organizationId);
  const tenant = data.scoped(organizationId);
  const [leads, counts, sums] = await Promise.all([
    tenant.lead.findMany({
      where: { archivedAt: null },
      orderBy: [{ stageChangedAt: "desc" }, { id: "desc" }],
      include: { owner: { select: { name: true } } },
    }),
    tenant.lead.groupBy({ by: ["stageId"], where: { archivedAt: null }, _count: { _all: true } }),
    tenant.lead.groupBy({
      by: ["stageId", "currency"],
      where: { archivedAt: null, currency: { not: null } },
      _sum: { estimatedValueMinor: true },
    }),
  ]);
  return stages.map((stage) => ({
    stage,
    count: counts.find((row) => row.stageId === stage.id)?._count._all ?? 0,
    totals: sums
      .filter((row) => row.stageId === stage.id && row.currency)
      .map((row) => ({ currency: row.currency!, amountMinor: row._sum.estimatedValueMinor ?? BigInt(0) }))
      .sort((a, b) => a.currency.localeCompare(b.currency)) as CurrencyTotals,
    leads: leads.filter((lead) => lead.stageId === stage.id).slice(0, BOARD_CARD_LIMIT),
  }));
}

export async function getLead(data: TenantData, organizationId: string, id: string) {
  const lead = await data.scoped(organizationId).lead.findUnique({
    where: { id },
    include: { stage: true, owner: { select: { name: true } }, createdBy: { select: { name: true } } },
  });
  if (!lead) throw new RecordNotFoundError("Lead");
  return lead;
}

function parse(input: unknown): LeadInput {
  const result = leadInputSchema.safeParse(input);
  if (!result.success) throw new InputValidationError(fieldErrors(result.error as z.ZodError));
  return result.data;
}

/** Checks the stage is this workspace's and the owner a current member (or unchanged). */
async function checkReferences(tenant: TenantDb, input: LeadInput, context: LeadContext, currentOwner?: string | null) {
  const stage = await tenant.pipelineStage.findUnique({ where: { id: input.stageId } });
  const fields: Record<string, string> = {};
  if (!stage) fields.stageId = "is not a stage of this pipeline";
  if (input.ownerUserId && input.ownerUserId !== currentOwner && !context.memberIds.has(input.ownerUserId)) {
    fields.ownerUserId = "must be a member of this workspace";
  }
  if (Object.keys(fields).length) throw new InputValidationError(fields);
  return stage!;
}

/** Closing fields follow the stage's kind, never its name. */
function closing(kind: string, previous?: { closedAt: Date | null }) {
  if (kind === "open") return { closedAt: null };
  return { closedAt: previous?.closedAt ?? new Date() };
}

export async function createLead(data: TenantData, actor: Actor, input: unknown, context: LeadContext) {
  const values = parse(input);
  return data.transaction(actor.organizationId, async (tenant) => {
    await ensureStages(tenant);
    const stage = await checkReferences(tenant, values, context);
    const lead = await tenant.lead.create({
      data: {
        ...values,
        ...closing(stage.kind),
        lostReason: stage.kind === "lost" ? values.lostReason : null,
        createdById: actor.userId,
      },
    });
    await recordAudit(tenant, {
      action: "lead.created",
      actorUserId: actor.userId,
      targetType: "lead",
      targetId: lead.id,
      metadata: { stage: stage.key },
    });
    return lead;
  });
}

const COMPARED: (keyof LeadInput)[] = [
  "contactName", "companyName", "email", "phone", "source", "ownerUserId", "stageId",
  "estimatedValueMinor", "currency", "summary", "nextFollowUpOn", "tags", "notes", "lostReason",
];

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null, (_, value) => (typeof value === "bigint" ? value.toString() : value)) ===
  JSON.stringify(b ?? null, (_, value) => (typeof value === "bigint" ? value.toString() : value));

export async function updateLead(
  data: TenantData,
  actor: Actor,
  id: string,
  expectedVersion: number,
  input: unknown,
  context: LeadContext,
) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new InputValidationError({ version: "is invalid" });
  }
  const values = parse(input);
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.lead.findUnique({ where: { id }, include: { stage: true } });
    if (!current) throw new RecordNotFoundError("Lead");
    if (current.version !== expectedVersion) throw new RecordConflictError("This lead");
    const stage = await checkReferences(tenant, values, context, current.ownerUserId);
    const lostReason = stage.kind === "lost" ? values.lostReason : null;
    const changedFields = COMPARED.filter((field) =>
      !same(current[field as keyof typeof current], field === "lostReason" ? lostReason : values[field]),
    );
    if (changedFields.length === 0) return current;

    const stageChanged = stage.id !== current.stageId;
    const { count } = await tenant.lead.updateMany({
      where: { id, version: expectedVersion },
      data: {
        ...values,
        lostReason,
        ...(stageChanged ? { stageChangedAt: new Date(), ...closing(stage.kind) } : {}),
        version: { increment: 1 },
      },
    });
    if (count !== 1) throw new RecordConflictError("This lead");
    await recordAudit(tenant, {
      action: "lead.updated",
      actorUserId: actor.userId,
      targetType: "lead",
      targetId: id,
      metadata: { changedFields, version: expectedVersion + 1 },
    });
    if (stageChanged) {
      await recordAudit(tenant, {
        action: "lead.stage_changed",
        actorUserId: actor.userId,
        targetType: "lead",
        targetId: id,
        metadata: { from: current.stage.key, to: stage.key },
      });
    }
    return (await tenant.lead.findUnique({ where: { id } }))!;
  });
}

/** Moves a lead to another stage (the board). */
export async function moveLead(data: TenantData, actor: Actor, id: string, stageId: string) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.lead.findUnique({ where: { id }, include: { stage: true } });
    if (!current) throw new RecordNotFoundError("Lead");
    const stage = await tenant.pipelineStage.findUnique({ where: { id: stageId } });
    if (!stage) throw new InputValidationError({ stageId: "is not a stage of this pipeline" });
    if (stage.id === current.stageId) return current;
    const lead = await tenant.lead.update({
      where: { id },
      data: {
        stageId: stage.id,
        stageChangedAt: new Date(),
        ...closing(stage.kind),
        ...(stage.kind === "lost" ? {} : { lostReason: null }),
        version: { increment: 1 },
      },
    });
    await recordAudit(tenant, {
      action: "lead.stage_changed",
      actorUserId: actor.userId,
      targetType: "lead",
      targetId: id,
      metadata: { from: current.stage.key, to: stage.key },
    });
    return lead;
  });
}

export async function setLeadArchived(data: TenantData, actor: Actor, id: string, archived: boolean) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.lead.findUnique({ where: { id } });
    if (!current) throw new RecordNotFoundError("Lead");
    if (Boolean(current.archivedAt) === archived) return current;
    const lead = await tenant.lead.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } },
    });
    await recordAudit(tenant, {
      action: archived ? "lead.archived" : "lead.restored",
      actorUserId: actor.userId,
      targetType: "lead",
      targetId: id,
    });
    return lead;
  });
}
