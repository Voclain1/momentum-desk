import { createDbClient } from "@/lib/db/client";

/**
 * Connection string for database tests. Tests delete every row they can
 * reach, so they only run against a database whose name ends in "_test".
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("Set TEST_DATABASE_URL to run database tests, e.g. postgresql://postgres@localhost:5432/momentum_test");
  }
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run database tests against "${name}": the database name must end in "_test".`);
  }
  return url;
}

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
