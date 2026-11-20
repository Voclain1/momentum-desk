import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

const fits = async (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("on a phone, every main page fits the screen and the navigation is reachable", async ({ page, browser }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.252" });
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Mo Bile");
  await page.getByLabel("Work email").fill(`mo-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Business name").fill("Mobile Co");
  await page.getByLabel("Country").selectOption("NG");
  await page.getByLabel("Base currency").selectOption("NGN");
  await page.getByLabel("Timezone").selectOption("Africa/Lagos");
  await page.getByLabel("Formatting locale").fill("en-NG");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // The navigation is a scrolling row on phones.
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await nav.getByRole("link", { name: "Customers" }).click();
  await expect(page).toHaveURL(/\/app\/customers$/);
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();

  await page.goto("/app/customers/new");
  await page.getByLabel("Name", { exact: true }).fill("Ade Stores");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  await page.goto("/app/invoices/new");
  const builder = page.getByRole("form", { name: "Invoice" });
  await builder.getByRole("combobox", { name: /^Customer/ }).selectOption({ label: "Ade Stores" });
  await builder.getByLabel("Description 1").fill("Service");
  await builder.getByLabel("Unit price 1").fill("1000");
  await builder.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/app\/invoices\/[0-9a-f-]+$/);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.locator(".topbar .status-pill")).toHaveText("Issued");
  expect(await fits(page)).toBe(true);
  // Sharing works from a phone.
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByLabel("Share link").inputValue();

  for (const path of ["/app", "/app/customers", "/app/leads", "/app/quotes", "/app/invoices", "/app/payments", "/app/receivables", "/app/metrics", "/app/settings"]) {
    await page.goto(path);
    expect(await fits(page), path).toBe(true);
  }
  const customer = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await customer.goto(link);
  await expect(customer.getByRole("article", { name: "Invoice INV-0001" })).toBeVisible();
  expect(await fits(customer)).toBe(true);
});
