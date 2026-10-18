import type { DbClient } from "@/lib/db/client";
import type { AuditLog, Prisma } from "@/lib/generated/prisma/client";
import { TENANT_MODELS, type TenantModel } from "./models";
import { SCOPED_OPERATIONS, scopeArgs, TenantViolationError } from "./scope";

/** Per-model create input and row types. Add each new tenant model here. */
interface TenantModelTypes {
  auditLog: { create: Prisma.AuditLogUncheckedCreateInput; row: AuditLog };
}

/** Create input without the organization, which tenantDb always sets. */
type TenantCreateData<M extends TenantModel> = Omit<TenantModelTypes[M]["create"], "organizationId">;

/**
 * A model delegate whose create methods take data without an organization.
 * Upsert and createManyAndReturn are left out of the type until needed.
 */
type TenantDelegate<M extends TenantModel> = Omit<
  DbClient[M],
  "create" | "createMany" | "createManyAndReturn" | "upsert"
> & {
  create(args: { data: TenantCreateData<M> }): Promise<TenantModelTypes[M]["row"]>;
  createMany(args: { data: TenantCreateData<M>[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
};

/** Only organization-owned models: `tenantDb(id).user` does not type-check. */
export type TenantDb = { [M in TenantModel]: TenantDelegate<M> };

type Transaction = Parameters<Parameters<DbClient["$transaction"]>[0]>[0];
type Runner = (client: DbClient | Transaction, query: Promise<unknown>) => Promise<unknown>;

/** Sets the organization row-level security sees, for the current transaction only. */
function setOrganization(client: DbClient | Transaction, organizationId: string) {
  return client.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
}

function scopedModel(
  client: DbClient | Transaction,
  model: TenantModel,
  organizationId: string,
  run: Runner,
) {
  const delegate = client[model] as unknown as Record<string, (args: unknown) => Promise<unknown>>;
  return new Proxy(
    {},
    {
      get(_, operation) {
        if (typeof operation !== "string" || !SCOPED_OPERATIONS.includes(operation)) {
          throw new TenantViolationError(`${model}.${String(operation)} is not available through tenantDb`);
        }
        // Async so a refused call rejects like any other query error.
        return async (args?: Record<string, unknown>) =>
          run(client, delegate[operation](scopeArgs(operation, args, organizationId)));
      },
    },
  );
}

function build(client: DbClient | Transaction, organizationId: string, run: Runner): TenantDb {
  if (!organizationId) throw new TenantViolationError("no organization id");
  return Object.fromEntries(
    TENANT_MODELS.map((model) => [model, scopedModel(client, model, organizationId, run)]),
  ) as unknown as TenantDb;
}

/**
 * Organization-scoped access to tenant models. Every call adds the
 * organization to its filter or data (lib/tenant/scope.ts) and runs in a
 * transaction that sets the same organization for row-level security, so the
 * application check and the database policy must both agree.
 */
export function createTenantDb(client: DbClient, organizationId: string): TenantDb {
  return build(client, organizationId, async (db, query) => {
    const [, result] = await (db as DbClient).$transaction([
      setOrganization(db, organizationId),
      query as never,
    ]);
    return result;
  });
}

export type { Transaction };

/**
 * Tenant access inside a transaction the caller already opened, for work that
 * also writes non-tenant rows (e.g. the organization itself) atomically.
 */
export async function tenantInTransaction(tx: Transaction, organizationId: string): Promise<TenantDb> {
  if (!organizationId) throw new TenantViolationError("no organization id");
  await setOrganization(tx, organizationId);
  return build(tx, organizationId, (_, query) => query);
}

/** Several tenant operations in one database transaction. */
export function runTenantTransaction<T>(
  client: DbClient,
  organizationId: string,
  work: (tenant: TenantDb) => Promise<T>,
): Promise<T> {
  if (!organizationId) throw new TenantViolationError("no organization id");
  return client.$transaction(async (tx) => work(await tenantInTransaction(tx, organizationId)));
}
