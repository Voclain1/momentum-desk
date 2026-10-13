import { createDbClient } from "@/lib/db/client";
import { testDatabaseUrl, testMigrationDatabaseUrl } from "./database-url";

export { testDatabaseUrl };

/** Connects as the app role, exactly as the application does. */
export function createTestDb() {
  return createDbClient(testDatabaseUrl());
}

/** Connects as the database owner, for test setup only. */
export function createTestOwnerDb() {
  return createDbClient(testMigrationDatabaseUrl());
}

export type TestDb = ReturnType<typeof createTestDb>;

let ownerDb: TestDb | undefined;

/**
 * Empties every application table. Keeps Prisma's migration history. Runs as
 * the owner: the app role is not allowed to truncate.
 */
export async function resetDatabase() {
  const db = (ownerDb ??= createTestOwnerDb());
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}

export async function disconnectOwnerDb() {
  await ownerDb?.$disconnect();
  ownerDb = undefined;
}
