import { execFileSync } from "node:child_process";
import { testMigrationDatabaseUrl } from "./database-url";

/** Applies all migrations to the test database once before database tests run. */
export default function setup() {
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, MIGRATION_DATABASE_URL: testMigrationDatabaseUrl() },
    stdio: "inherit",
  });
}
