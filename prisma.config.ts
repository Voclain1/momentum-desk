import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// The Prisma CLI does not read Next.js env files. Load them the way Next does:
// values already in the environment win, then .env.local, then .env.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations run as the database owner. The app itself connects with
    // DATABASE_URL as a restricted role that cannot change the schema or
    // bypass row-level security. Optional so `prisma generate` needs no database.
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  },
});
