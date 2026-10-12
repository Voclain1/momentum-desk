import { createDbClient } from "@/lib/db/client";
import { testDatabaseUrl } from "./database-url";

export { testDatabaseUrl };

export function createTestDb() {
  return createDbClient(testDatabaseUrl());
}

export type TestDb = ReturnType<typeof createTestDb>;

/** Empties every application table. Keeps Prisma's migration history. */
export async function resetDatabase(db: TestDb) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}
