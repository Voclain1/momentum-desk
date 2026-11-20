import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { clientAddress, createRateLimiter } from "./rate-limit";

const db = createTestDb();
const limiter = createRateLimiter(db);

beforeEach(() => resetDatabase());
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

describe("rate limits", () => {
  it("allow up to the limit per window, separately per scope and subject, then reset", async () => {
    const now = new Date("2026-11-20T10:00:10Z");
    const hits = [];
    for (let i = 0; i < 4; i++) hits.push(await limiter.hit("checkout", "203.0.113.9", 3, 60, now));
    expect(hits.map((h) => h.allowed)).toEqual([true, true, true, false]);
    expect(hits[3].retryAfter).toBe(50);
    expect((await limiter.hit("checkout", "203.0.113.10", 3, 60, now)).allowed).toBe(true);
    expect((await limiter.hit("documentView", "203.0.113.9", 3, 60, now)).allowed).toBe(true);
    expect((await limiter.hit("checkout", "203.0.113.9", 3, 60, new Date("2026-11-20T10:01:00Z"))).allowed).toBe(true);
  });

  it("never stores the address itself", async () => {
    await limiter.hit("checkout", "203.0.113.9", 3, 60);
    const rows = await db.rateLimitBucket.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.9");
  });

  it("takes the client's address from the proxy's header", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.2" }))).toBe("203.0.113.9");
    expect(clientAddress(new Headers())).toBe("unknown");
  });
});
