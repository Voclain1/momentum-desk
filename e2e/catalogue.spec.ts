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
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${30 + ip++}` });
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

test("an owner sets up tax rates and a product priced in several currencies", async ({ page }) => {
  await newUserWithWorkspace(page, "Ife Owner", "Lagos Solar");

  await page.goto("/app/settings");
  const taxes = page.getByRole("region", { name: "Tax rates" });
  await taxes.getByRole("button", { name: "＋ Add" }).click();
  const add = taxes.getByRole("form", { name: "Add a tax rate" });
  await add.getByLabel("Name").fill("VAT");
  await add.getByLabel("Rate (%)").fill("7.5555");
  await add.getByRole("button", { name: "Add rate" }).click();
  await expect(add.getByText("Rate must be a percentage from 0 to 100, with up to 3 decimals")).toBeVisible();
  await add.getByLabel("Rate (%)").fill("7.5");
  await add.getByRole("button", { name: "Add rate" }).click();
  await expect(taxes.getByText("VAT — 7.5%")).toBeVisible();

  await page.goto("/app/catalogue/new");
  await page.getByLabel("Name", { exact: true }).fill("Solar panel 400W");
  await page.getByLabel("SKU / code").fill("SP-400");
  await page.getByLabel("Unit", { exact: true }).fill("unit");
  await page.getByLabel("Default tax").selectOption({ label: "VAT (7.5%)" });
  await page.getByLabel("Unit price 1").fill("185,000");
  await page.getByRole("button", { name: "＋ Add a price" }).click();
  await page.getByLabel("Currency 2").selectOption("JPY");
  await page.getByLabel("Unit price 2").fill("18000.5");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByText("Prices has too many decimal places for JPY")).toBeVisible();
  await page.getByLabel("Unit price 2").fill("18000");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page).toHaveURL(/\/app\/catalogue\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Solar panel 400W" })).toBeVisible();

  await page.goto("/app/catalogue");
  const row = page.getByRole("row", { name: /Solar panel 400W/ });
  await expect(row).toContainText("185,000.00");
  await expect(row).toContainText("18,000");
  await expect(row).toContainText("VAT (7.5%)");

  // Deactivated products leave the list but stay reachable.
  await page.goto((await row.getByRole("link").getAttribute("href"))!);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Deactivate" }).click();
  await expect(page.locator("header.topbar p")).toContainText("INACTIVE");
  await page.goto("/app/catalogue");
  await expect(page.getByText("No products yet.")).toBeVisible();
  await page.goto("/app/catalogue?inactive=1");
  await expect(page.getByRole("link", { name: "Solar panel 400W" })).toBeVisible();
});

test("sales can read the catalogue but not change it; members cannot see it", async ({ browser }) => {
  const owner = await browser.newPage();
  const ownerEmail = await newUserWithWorkspace(owner, "Tayo Owner", "Tools Co");
  await owner.goto("/app/catalogue/new");
  await owner.getByLabel("Name", { exact: true }).fill("Drill");
  await owner.getByLabel("Unit price 1").fill("25000");
  await owner.getByRole("button", { name: "Add product" }).click();
  await expect(owner).toHaveURL(/\/app\/catalogue\/[0-9a-f-]+$/);
  const productUrl = owner.url();

  const sales = await joinAs(browser, ownerEmail, "sales", "Sola Sales");
  await sales.goto("/app/catalogue");
  await expect(sales.getByRole("link", { name: "Drill" })).toBeVisible();
  await expect(sales.getByRole("link", { name: "New product" })).toHaveCount(0);
  await sales.goto(productUrl);
  await expect(sales.getByLabel("Name", { exact: true })).toBeDisabled();
  await expect(sales.getByRole("button", { name: "Save product" })).toHaveCount(0);
  await sales.goto("/app/catalogue/new");
  await expect(sales.getByText("Your role does not include access to this page.")).toBeVisible();
  await sales.goto("/app/settings");
  await expect(sales.getByRole("region", { name: "Tax rates" }).getByRole("button", { name: "＋ Add" })).toHaveCount(0);

  const member = await joinAs(browser, ownerEmail, "member", "Mo Member");
  for (const path of ["/app/catalogue", productUrl]) {
    await member.goto(path);
    await expect(member.getByText("Your role does not include access to this page.")).toBeVisible();
    await expect(member.getByText("Drill")).toHaveCount(0);
  }
});
