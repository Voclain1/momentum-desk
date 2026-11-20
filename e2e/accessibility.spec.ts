import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct horse battery staple";

/** Serious and critical WCAG 2.1 A/AA problems on the page, described briefly. */
async function problems(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} ${JSON.stringify((n.any[0]?.data ?? {}) as object)}`).join(" | ")}`);
}

test("the main pages have no serious accessibility problems", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const found: Record<string, string[]> = {};
  const check = async (label: string) => {
    const list = await problems(page);
    if (list.length) found[label] = list;
  };

  await page.goto("/sign-up");
  await check("sign-up");
  await page.goto("/sign-in");
  await check("sign-in");

  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.250" });
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Ola Access");
  await page.getByLabel("Work email").fill(`ola-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await check("onboarding");
  await page.getByLabel("Business name").fill("Access Co");
  await page.getByLabel("Country").selectOption("NG");
  await page.getByLabel("Base currency").selectOption("NGN");
  await page.getByLabel("Timezone").selectOption("Africa/Lagos");
  await page.getByLabel("Formatting locale").fill("en-NG");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await check("dashboard");

  await page.goto("/app/customers/new");
  await check("new customer");
  await page.getByLabel("Name", { exact: true }).fill("Ade Stores");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  await check("customer");
  await page.goto("/app/leads/new");
  await check("new lead");
  await page.goto("/app/quotes/new");
  await check("new quote");
  await page.goto("/app/invoices/new");
  const builder = page.getByRole("form", { name: "Invoice" });
  await builder.getByRole("combobox", { name: /^Customer/ }).selectOption({ label: "Ade Stores" });
  await builder.getByLabel("Description 1").fill("Service");
  await builder.getByLabel("Unit price 1").fill("1000");
  await check("new invoice");
  await builder.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/app\/invoices\/[0-9a-f-]+$/);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.locator(".topbar .status-pill")).toHaveText("Issued");
  await check("invoice");
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByLabel("Share link").inputValue();

  for (const [label, path] of [
    ["customers", "/app/customers"], ["leads", "/app/leads"], ["pipeline", "/app/pipeline"], ["quotes", "/app/quotes"],
    ["invoices", "/app/invoices"], ["payments", "/app/payments"], ["collections", "/app/receivables"], ["metrics", "/app/metrics"],
    ["settings", "/app/settings"], ["team", "/app/team"], ["catalogue", "/app/catalogue"], ["tasks", "/app/tasks"],
  ] as const) {
    await page.goto(path);
    await check(label);
  }

  const customer = await (await browser.newContext()).newPage();
  await customer.goto(link);
  const list = await problems(customer);
  if (list.length) found["public invoice"] = list;
  for (const path of ["/", "/privacy"]) {
    await customer.goto(path);
    const more = await problems(customer);
    if (more.length) found[path] = more;
  }

  expect(found).toEqual({});
});
