import { expect, test } from "@playwright/test";
import { lastEmailTo } from "./outbox";

test("an owner exports everything, erases a customer on request, and can close the workspace with 30 days to cancel", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.253" });
  const email = `rights-${Date.now()}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Rita Owner");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Business name").fill("Rights Co");
  await page.getByLabel("Country").selectOption("NG");
  await page.getByLabel("Base currency").selectOption("NGN");
  await page.getByLabel("Timezone").selectOption("Africa/Lagos");
  await page.getByLabel("Formatting locale").fill("en-NG");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/customers/new");
  await page.getByLabel("Name", { exact: true }).fill("Chidi Okafor");
  await page.getByLabel("Email").fill(`chidi-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  const customerUrl = page.url();

  // Everything in one ZIP.
  await page.goto("/app/settings");
  const download = await page.request.get("/app/export");
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("application/zip");
  expect((await download.body()).subarray(0, 2).toString()).toBe("PK");

  // Erasure needs the exact name, then the record is anonymised and locked.
  await page.goto(customerUrl);
  const erase = page.getByRole("region", { name: "Erase personal data" });
  await erase.getByLabel(/Type the customer's name/).fill("chidi");
  await erase.getByRole("button", { name: "Erase personal data" }).click();
  await expect(erase.getByText("The name must be the customer's name exactly.")).toBeVisible();
  await erase.getByLabel(/Type the customer's name/).fill("Chidi Okafor");
  await erase.getByRole("button", { name: "Erase personal data" }).click();
  await expect(page.getByRole("note").filter({ hasText: "Personal data erased on" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Erased customer");
  await expect(page.getByText("Chidi Okafor")).toHaveCount(0);

  // Closing: every page warns, owners are emailed, and an owner can cancel.
  await page.goto("/app/settings");
  const closure = page.getByRole("region", { name: "Close workspace" });
  await closure.getByLabel(/Type the workspace's name/).fill("Rights Co");
  await closure.getByRole("button", { name: "Close workspace" }).click();
  await expect(closure.getByText(/The workspace will be deleted on/)).toBeVisible();
  await page.goto("/app");
  await expect(page.getByRole("alert").filter({ hasText: "This workspace is closing." })).toBeVisible();
  expect((await lastEmailTo(email, /will be deleted on/)).text).toContain("cancel the closure there");
  await page.goto("/app/settings");
  await closure.getByRole("button", { name: "Cancel closing" }).click();
  await expect(closure.getByText("Closure cancelled. Nothing will be deleted.")).toBeVisible();
  await page.goto("/app");
  await expect(page.getByText("This workspace is closing.")).toHaveCount(0);
});
