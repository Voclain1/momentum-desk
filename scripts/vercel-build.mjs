/**
 * Vercel runs this instead of `next build` (package.json "vercel-build").
 * Applies pending migrations as the database owner, then builds.
 *
 * Production refuses to deploy without MIGRATION_DATABASE_URL, so a deploy
 * can never run new code against an old schema. Previews without one (no
 * Neon branch) build without migrating and say so.
 */
import { execFileSync } from "node:child_process";

const run = (args) => execFileSync("pnpm", args, { stdio: "inherit" });
const environment = process.env.VERCEL_ENV ?? "local";

if (process.env.MIGRATION_DATABASE_URL) {
  console.log(`[vercel-build] Applying migrations (${environment})`);
  run(["exec", "prisma", "migrate", "deploy"]);
} else if (environment === "production") {
  console.error("[vercel-build] MIGRATION_DATABASE_URL is not set: refusing to deploy production without migrating.");
  process.exit(1);
} else {
  console.warn(`[vercel-build] MIGRATION_DATABASE_URL is not set: skipping migrations (${environment}).`);
}

run(["exec", "next", "build"]);
