import { expect, test } from "@playwright/test";

test("the health check reports the app and database as up, and is never cached", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toMatchObject({ status: "ok", checks: { database: "ok" } });
});

test("every response carries the security headers", async ({ request }) => {
  for (const path of ["/", "/sign-in", "/privacy"]) {
    const headers = (await request.get(path)).headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-powered-by"]).toBeUndefined();
  }
});
