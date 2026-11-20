import { afterAll, describe, expect, it } from "vitest";
import { createDbClient } from "@/lib/db/client";
import { heartbeat } from "@/lib/jobs/queue-core";
import { createTestDb, resetDatabase } from "@/test/db";
import { checkHealth } from "./health";

const db = createTestDb();
afterAll(() => db.$disconnect());

describe("checkHealth", () => {
  it("reports ok when the database answers", async () => {
    expect(await checkHealth(db)).toMatchObject({ status: "ok", checks: { database: "ok" } });
  });

  it("reports the background worker, and fails strict checks when it has stopped", async () => {
    await resetDatabase();
    const now = new Date("2026-11-20T12:00:00Z");
    expect(await checkHealth(db, { now })).toMatchObject({ status: "ok", checks: { worker: "missing" } });
    expect(await checkHealth(db, { now, strict: true })).toMatchObject({ status: "unavailable", checks: { worker: "missing" } });
    await heartbeat(db, "host:1", new Date("2026-11-20T11:58:00Z"));
    expect(await checkHealth(db, { now, strict: true })).toMatchObject({ status: "ok", checks: { worker: "ok" } });
    const later = new Date("2026-11-20T12:10:00Z");
    expect(await checkHealth(db, { now: later })).toMatchObject({ status: "ok", checks: { worker: "stale" } });
    expect(await checkHealth(db, { now: later, strict: true })).toMatchObject({ status: "unavailable" });
  });

  it("reports unavailable, without details, when the database cannot be reached", async () => {
    const unreachable = createDbClient("postgresql://nobody:wrong@127.0.0.1:1/none");
    try {
      const report = await checkHealth(unreachable);
      expect(report).toEqual({ status: "unavailable", checks: { database: "error", worker: "unknown" }, version: null });
    } finally {
      await unreachable.$disconnect();
    }
  });
});
