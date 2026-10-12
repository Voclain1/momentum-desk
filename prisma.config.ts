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
    // Optional here so `prisma generate` works without a database.
    url: process.env.DATABASE_URL,
  },
});
