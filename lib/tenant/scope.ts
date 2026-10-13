/**
 * Rewrites Prisma query arguments so they can only touch one organization's
 * rows. Pure functions: lib/tenant/index.ts applies them to every call.
 *
 * Fails closed: an operation not listed here is refused, and an argument that
 * names another organization throws instead of being silently overridden.
 */

type Args = Record<string, unknown> | undefined;
type Kind = "uniqueWhere" | "manyWhere" | "create" | "createMany" | "update" | "updateMany" | "upsert";

const OPERATION_KINDS: Record<string, Kind> = {
  findUnique: "uniqueWhere",
  findUniqueOrThrow: "uniqueWhere",
  findFirst: "manyWhere",
  findFirstOrThrow: "manyWhere",
  findMany: "manyWhere",
  count: "manyWhere",
  aggregate: "manyWhere",
  groupBy: "manyWhere",
  delete: "uniqueWhere",
  deleteMany: "manyWhere",
  create: "create",
  createMany: "createMany",
  createManyAndReturn: "createMany",
  update: "update",
  updateMany: "updateMany",
  updateManyAndReturn: "updateMany",
  upsert: "upsert",
};

export const SCOPED_OPERATIONS = Object.keys(OPERATION_KINDS);

export class TenantViolationError extends Error {
  constructor(message: string) {
    super(`Tenant isolation: ${message}`);
    this.name = "TenantViolationError";
  }
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TenantViolationError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

/** A unique `where` keeps its shape; organizationId is added beside the unique key. */
function scopeUniqueWhere(where: unknown, organizationId: string) {
  const scoped = asRecord(where, "where");
  if ("organizationId" in scoped && scoped.organizationId !== organizationId) {
    throw new TenantViolationError("where.organizationId names another organization");
  }
  return { ...scoped, organizationId };
}

/** A filter `where` is wrapped, so nothing inside it (OR, NOT, …) can widen it. */
function scopeManyWhere(where: unknown, organizationId: string) {
  const scoped = asRecord(where, "where");
  return Object.keys(scoped).length === 0
    ? { organizationId }
    : { AND: [scoped, { organizationId }] };
}

function scopeCreateData(data: unknown, organizationId: string) {
  const scoped = asRecord(data, "data");
  if ("organization" in scoped) {
    throw new TenantViolationError("set the organization through tenantDb, not a relation write");
  }
  if ("organizationId" in scoped && scoped.organizationId !== organizationId) {
    throw new TenantViolationError("data.organizationId names another organization");
  }
  return { ...scoped, organizationId };
}

function checkUpdateData(data: unknown) {
  const scoped = asRecord(data, "data");
  if ("organizationId" in scoped || "organization" in scoped) {
    throw new TenantViolationError("a record cannot be moved to another organization");
  }
  return scoped;
}

export function scopeArgs(operation: string, args: Args, organizationId: string): Record<string, unknown> {
  if (!organizationId) throw new TenantViolationError("no organization id");
  const kind = OPERATION_KINDS[operation];
  if (!kind) throw new TenantViolationError(`operation "${operation}" is not supported on tenant models`);
  const input = asRecord(args, "arguments");

  switch (kind) {
    case "uniqueWhere":
      return { ...input, where: scopeUniqueWhere(input.where, organizationId) };
    case "manyWhere":
      return { ...input, where: scopeManyWhere(input.where, organizationId) };
    case "create":
      return { ...input, data: scopeCreateData(input.data, organizationId) };
    case "createMany": {
      const rows = Array.isArray(input.data) ? input.data : [input.data];
      return { ...input, data: rows.map((row) => scopeCreateData(row, organizationId)) };
    }
    case "update":
      return {
        ...input,
        where: scopeUniqueWhere(input.where, organizationId),
        data: checkUpdateData(input.data),
      };
    case "updateMany":
      return {
        ...input,
        where: scopeManyWhere(input.where, organizationId),
        data: checkUpdateData(input.data),
      };
    case "upsert":
      return {
        ...input,
        where: scopeUniqueWhere(input.where, organizationId),
        create: scopeCreateData(input.create, organizationId),
        update: checkUpdateData(input.update),
      };
  }
}
