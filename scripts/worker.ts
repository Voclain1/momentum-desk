/**
 * The background worker (decision D18): `pnpm worker`. Runs alongside the web
 * server on the VPS (see docs/go-live.md); several can run at once.
 * Stops cleanly on SIGTERM/SIGINT after the job in hand.
 */
import { hostname } from "node:os";
import { db } from "@/lib/db";
import { parseEnv } from "@/lib/env";
import { createJobHandlers, DAILY_JOBS } from "@/lib/jobs/handlers";
import { providerHttp } from "@/lib/payments/http";
import { runWorker } from "@/lib/jobs/worker";
import { tenantData } from "@/lib/tenant";

const env = parseEnv(process.env);
const JOB_HANDLERS = createJobHandlers({
  organization: (id) => db.organization.findUnique({ where: { id }, select: { baseCurrency: true, timezone: true } }),
  fxProviderKey: env.FX_PROVIDER_KEY,
  http: providerHttp(env),
});

const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => controller.abort());

const log = (message: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), level: "info", message, ...fields }));

async function main() {
  log("worker started", { kinds: Object.keys(JOB_HANDLERS), daily: DAILY_JOBS });
  await runWorker(
    { db, data: tenantData, handlers: JOB_HANDLERS, daily: DAILY_JOBS, workerId: `${hostname()}:${process.pid}`, log },
    { signal: controller.signal, intervalMs: Number(process.env.WORKER_INTERVAL_MS ?? 15_000) },
  );
  log("worker stopped");
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
