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
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${150 + ip++}` });
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

async function addLead(page: Page, fields: { name: string; company?: string; value?: string; currency?: string; followUp?: string }) {
  await page.goto("/app/leads/new");
  await page.getByLabel("Contact name").fill(fields.name);
  if (fields.company) await page.getByLabel("Company").fill(fields.company);
  if (fields.value) await page.getByLabel("Estimated value").fill(fields.value);
  if (fields.currency) await page.getByLabel("Currency").selectOption(fields.currency);
  if (fields.followUp) await page.getByLabel("Next follow-up").fill(fields.followUp);
  await page.getByRole("button", { name: "Add lead" }).click();
  await expect(page).toHaveURL(/\/app\/leads\/[0-9a-f-]+$/);
}

test("a salesperson works leads through the pipeline, with totals kept per currency", async ({ page }) => {
  await newUserWithWorkspace(page, "Sade Seller", "Bright Solar");

  await addLead(page, { name: "Ada Obi", company: "Obi Farms", value: "1,500,000", currency: "NGN", followUp: "2026-01-05" });
  await expect(page.getByLabel("Owner")).toHaveValue(/.+/);
  await addLead(page, { name: "Tom Hart", value: "2000", currency: "USD" });

  // Wrong decimals for the currency are explained, not rounded.
  await page.getByLabel("Estimated value").fill("10.5");
  await page.getByLabel("Currency").selectOption("JPY");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByText("Estimated value has too many decimal places for JPY")).toBeVisible();

  await page.locator("aside").getByRole("link", { name: "Pipeline" }).click();
  const newColumn = page.getByRole("region", { name: "New", exact: true });
  await expect(newColumn.locator("h3")).toContainText("2");
  const totals = newColumn.locator(".column-totals");
  await expect(totals).toContainText("1,500,000.00");
  await expect(totals).toContainText("2,000.00");
  await expect(totals).not.toContainText("1,502,000");

  await newColumn.getByLabel("Move Ada Obi · Obi Farms").selectOption({ label: "Move to Won" });
  const wonColumn = page.getByRole("region", { name: "Won", exact: true });
  await expect(wonColumn.getByText("Ada Obi · Obi Farms")).toBeVisible();
  await expect(newColumn.getByText("Ada Obi · Obi Farms")).toHaveCount(0);

  await page.goto("/app/leads");
  await expect(page.getByRole("link", { name: "Tom Hart" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ada Obi · Obi Farms" })).toHaveCount(0);
  await page.getByLabel("Status").selectOption("won");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByRole("link", { name: "Ada Obi · Obi Farms" })).toBeVisible();

  // Reopen it and check the overdue filter. Open the page directly so the
  // form is not edited while a client-side navigation is still settling.
  await page.goto((await page.getByRole("link", { name: "Ada Obi · Obi Farms" }).getAttribute("href"))!);
  await expect(page.getByRole("heading", { level: 1, name: "Ada Obi · Obi Farms" })).toBeVisible();
  await page.getByLabel("Stage").selectOption({ label: "Qualified" });
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("status")).toHaveText("Lead saved.");
  await expect(page.locator("header.topbar p")).toContainText("QUALIFIED");
  await page.goto("/app/leads?followUp=overdue");
  await expect(page.getByRole("row", { name: /Ada Obi/ })).toContainText("Overdue");
  await expect(page.getByRole("link", { name: "Tom Hart" })).toHaveCount(0);

  await page.goto("/app");
  await expect(page.getByRole("region", { name: "Recent activity" })).toContainText("Sade Seller moved a lead");
});

test("finance members have no access to leads or the pipeline", async ({ browser }) => {
  const owner = await browser.newPage();
  await newUserWithWorkspace(owner, "Olu Owner", "Sales Co");
  await addLead(owner, { name: "Private Prospect" });
  const leadUrl = owner.url();

  const finance = await browser.newPage();
  const financeEmail = await newUserWithWorkspace(finance, "Funmi Finance", "Elsewhere");
  const [{ organizationId }] = await sql(
    `SELECT "organizationId" FROM member m JOIN "user" u ON u.id = m."userId" WHERE u.name = $1`,
    ["Olu Owner"],
  );
  const [{ id: userId }] = await sql(`SELECT id FROM "user" WHERE email = $1`, [financeEmail]);
  await sql(`INSERT INTO member (id, "organizationId", "userId", role) VALUES (gen_random_uuid()::text, $1, $2, 'finance')`, [organizationId, userId]);
  await sql(`UPDATE session SET "activeOrganizationId" = $1 WHERE "userId" = $2`, [organizationId, userId]);

  for (const path of ["/app/leads", "/app/pipeline", leadUrl]) {
    await finance.goto(path);
    await expect(finance.getByText("Your role does not include access to this page.")).toBeVisible();
    await expect(finance.getByText("Private Prospect")).toHaveCount(0);
  }
});
