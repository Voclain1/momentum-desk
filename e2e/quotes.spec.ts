import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

const PASSWORD = "correct horse battery staple";
let ip = 1;

async function sql(query: string, values: unknown[]) {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(query, values)).rows;
  } finally {
    await client.end();
  }
}

async function newUserWithWorkspace(page: Page, name: string, workspace: string) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${60 + ip++}` });
  const email = `${name.split(" ")[0].toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Business name").fill(workspace);
  await page.getByLabel("Country").selectOption("NG");
  await page.getByLabel("Base currency").selectOption("NGN");
  await page.getByLabel("Timezone").selectOption("Africa/Lagos");
  await page.getByLabel("Formatting locale").fill("en-NG");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}

/** Adds a new user to the owner's workspace (found by the owner's unique email). */
async function joinAs(browser: import("@playwright/test").Browser, ownerEmail: string, role: string, name: string) {
  const page = await browser.newPage();
  const email = await newUserWithWorkspace(page, name, `${name} Shop`);
  const [{ organizationId }] = await sql(
    `SELECT "organizationId" FROM member m JOIN "user" u ON u.id = m."userId" WHERE u.email = $1`,
    [ownerEmail],
  );
  const [{ id: userId }] = await sql(`SELECT id FROM "user" WHERE email = $1`, [email]);
  await sql(`INSERT INTO member (id, "organizationId", "userId", role) VALUES (gen_random_uuid()::text, $1, $2, $3)`, [organizationId, userId, role]);
  await sql(`UPDATE session SET "activeOrganizationId" = $1 WHERE "userId" = $2`, [organizationId, userId]);
  return page;
}

test("a lead becomes a customer, gets a quote built from the catalogue, sent and revised", async ({ page }) => {
  await newUserWithWorkspace(page, "Quinn Owner", "Bright Solar");

  await page.goto("/app/settings");
  const taxes = page.getByRole("region", { name: "Tax rates" });
  await taxes.getByRole("button", { name: "＋ Add" }).click();
  await taxes.getByLabel("Name").fill("VAT");
  await taxes.getByLabel("Rate (%)").fill("7.5");
  await taxes.getByRole("button", { name: "Add rate" }).click();
  await expect(taxes.getByText("VAT — 7.5%")).toBeVisible();

  await page.goto("/app/catalogue/new");
  await page.getByLabel("Name", { exact: true }).fill("Solar panel");
  await page.getByLabel("Unit", { exact: true }).fill("unit");
  await page.getByLabel("Default tax").selectOption({ label: "VAT (7.5%)" });
  await page.getByLabel("Unit price 1").fill("185000");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page).toHaveURL(/\/app\/catalogue\/[0-9a-f-]+$/);

  // Lead → customer → quote (spec acceptance scenario 1, up to sending).
  await page.goto("/app/leads/new");
  await page.getByLabel("Contact name").fill("Chidi Okafor");
  await page.getByLabel("Company").fill("Okafor Farms");
  await page.getByRole("button", { name: "Add lead" }).click();
  await expect(page).toHaveURL(/\/app\/leads\/[0-9a-f-]+$/);
  const leadUrl = page.url();
  await page.goto(leadUrl);
  await page.getByRole("button", { name: "Convert to customer" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Okafor Farms", exact: true })).toBeVisible();
  await page.goto(leadUrl);
  await page.goto((await page.getByRole("link", { name: "＋ New quote" }).getAttribute("href"))!);
  await expect(page.getByRole("heading", { level: 1, name: "New quote" })).toBeVisible();

  const quote = page.getByRole("form", { name: "Quote" });
  await quote.getByLabel("Add from catalogue").selectOption({ label: "Solar panel" });
  await quote.getByLabel("Quantity 1").fill("0");
  await quote.getByLabel("Discount type 1").selectOption("percent");
  await quote.getByLabel("Discount 1").fill("10");
  await quote.getByRole("button", { name: "＋ Add a line" }).click();
  await quote.getByLabel("Description 2").fill("Installation");
  await quote.getByLabel("Quantity 2").fill("6.5");
  await quote.getByLabel("Unit 2", { exact: true }).fill("hour");
  await quote.getByLabel("Unit price 2").fill("7500.50");
  await quote.getByLabel("Tax 2").selectOption({ label: "VAT (7.5%)" });
  await quote.getByRole("button", { name: "Save draft" }).click();
  await expect(quote.getByText("Quantity must be a number above zero with up to 3 decimals")).toBeVisible();

  await quote.getByLabel("Quantity 1").fill("2");
  // 2 × 185,000 − 10% = 333,000; 6.5 × 7,500.50 = 48,753.25; VAT 7.5% on 381,753.25 = 28,631.49.
  const totals = quote.getByRole("definition").last();
  await expect(quote.getByLabel("Amount 1")).toContainText("333,000.00");
  await expect(quote.getByLabel("Amount 2")).toContainText("48,753.25");
  await expect(totals).toContainText("410,384.74");
  await quote.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/app\/quotes\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Q-0001");
  await expect(page.locator(".topbar .status-pill")).toHaveText("Draft");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.locator(".topbar .status-pill")).toHaveText("Sent");
  const document = page.getByRole("article", { name: "Quote Q-0001" });
  await expect(document).toContainText("Okafor Farms");
  await expect(document).toContainText("VAT 7.5% on ₦381,753.25");
  await expect(document).toContainText("₦410,384.74");
  const sentUrl = page.url();

  // A revision is a new draft; sending it supersedes the first version.
  await page.getByRole("button", { name: "Revise" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("revision 2");
  await page.goto(page.url());
  await page.getByRole("form", { name: "Quote" }).getByLabel("Unit price 2").fill("7000");
  await page.getByRole("form", { name: "Quote" }).getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.locator(".topbar .status-pill")).toHaveText("Sent");
  const revisions = page.getByRole("region", { name: "Revisions" });
  await expect(revisions.getByRole("listitem").filter({ hasText: "Revision 1" })).toContainText("Superseded");

  // The first version is kept exactly as sent.
  await page.goto(sentUrl);
  await expect(page.locator(".topbar .status-pill")).toHaveText("Superseded");
  await expect(page.getByRole("article", { name: "Quote Q-0001" })).toContainText("₦410,384.74");
  await expect(page.getByRole("button", { name: "Revise" })).toHaveCount(0);

  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Q-0002");

  await page.goto("/app/quotes?status=all");
  await expect(page.getByRole("row", { name: /Q-0001/ })).toContainText("Revision 2");
  await expect(page.getByRole("row", { name: /Q-0002/ })).toContainText("Draft");
});

test("finance cannot see quotes", async ({ browser }) => {
  const owner = await browser.newPage();
  const ownerEmail = await newUserWithWorkspace(owner, "Rae Owner", "Quote Co");
  await owner.goto("/app/customers/new");
  await owner.getByLabel("Name", { exact: true }).fill("Bello Stores");
  await owner.getByRole("button", { name: "Add customer" }).click();
  await expect(owner).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  await owner.goto((await owner.getByRole("link", { name: "＋ New quote" }).getAttribute("href"))!);
  const quote = owner.getByRole("form", { name: "Quote" });
  await quote.getByLabel("Description 1").fill("Shelving");
  await quote.getByLabel("Unit price 1").fill("50000");
  await quote.getByRole("button", { name: "Save draft" }).click();
  await expect(owner).toHaveURL(/\/app\/quotes\/[0-9a-f-]+$/);
  const quoteUrl = owner.url();

  const finance = await joinAs(browser, ownerEmail, "finance", "Fola Finance");
  expect((await finance.request.get(`${quoteUrl}/pdf`)).status()).toBe(403);
  for (const path of ["/app/quotes", quoteUrl, "/app/quotes/new"]) {
    await finance.goto(path);
    await expect(finance.getByText("Your role does not include access to this page.")).toBeVisible();
    await expect(finance.getByText("Shelving")).toHaveCount(0);
  }
});
