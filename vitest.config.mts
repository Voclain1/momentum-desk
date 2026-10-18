import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Pick up TEST_DATABASE_URL from the same env files Next.js and the Prisma
// CLI read. Values already in the environment win.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const exclude = ["node_modules/**", ".next/**"];

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["**/*.test.ts", "**/*.test.tsx"],
          exclude: [...exclude, "**/*.db.test.ts"],
        },
      },
      {
        // Integration tests against a real PostgreSQL database
        // (TEST_DATABASE_URL). They share one database, so files run serially.
        extends: true,
        test: {
          name: "db",
          include: ["**/*.db.test.ts"],
          exclude,
          globalSetup: ["test/db-global-setup.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
