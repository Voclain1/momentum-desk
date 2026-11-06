import { afterAll, describe, expect, it } from "vitest";
import { createDbClient } from "@/lib/db/client";
import { createTestDb } from "@/test/db";
import { checkHealth } from "./health";

const db = createTestDb();
afterAll(() => db.$disconnect());

describe("checkHealth", () => {
  it("reports ok when the database answers", async () => {
    expect(await checkHealth(db)).toMatchObject({ status: "ok", checks: { database: "ok" } });
  });

  it("reports unavailable, without details, when the database cannot be reached", async () => {
    const unreachable = createDbClient("postgresql://nobody:wrong@127.0.0.1:1/none");
    try {
      const report = await checkHealth(unreachable);
      expect(report).toEqual({ status: "unavailable", checks: { database: "error" }, version: null });
    } finally {
      await unreachable.$disconnect();
    }
  });
});
