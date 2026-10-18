import { parseEnv } from "@/lib/env";
import { createDbClient, type DbClient } from "./client";

export type { DbClient } from "./client";

// Reuse one client across hot reloads in development so each edit does not
// open a new connection pool.
const globalForDb = globalThis as unknown as { db?: DbClient };

/**
 * The shared database client. Server-only: never import it from a client
 * component. Organization-owned records must be read and written through the
 * tenant guard (added with authentication), not queried directly by an
 * organization id taken from user input.
 */
export const db: DbClient = globalForDb.db ?? createDbClient(parseEnv(process.env).DATABASE_URL);

if (process.env.NODE_ENV !== "production") globalForDb.db = db;
