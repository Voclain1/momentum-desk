import { expect, test } from "@playwright/test";

test("the health check reports the app and database as up, and is never cached", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toMatchObject({ status: "ok", checks: { database: "ok" } });
});
