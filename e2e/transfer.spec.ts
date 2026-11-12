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
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${200 + ip++}` });
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

async function upload(page: Page, name: string, csv: string) {
  await page.getByLabel("CSV file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Import" }).click();
}

test("an owner imports, exports, spots a duplicate and converts a lead into an existing customer", async ({ page }) => {
  await newUserWithWorkspace(page, "Ola Owner", "Sun Power");

  // A bad file imports nothing and says which rows to fix.
  await page.goto("/app/customers");
  await page.goto((await page.getByRole("link", { name: "Import" }).getAttribute("href"))!);
  await expect(page.getByRole("heading", { level: 1, name: "Import customers" })).toBeVisible();
  await upload(page, "customers.csv", "displayName,email\nOkafor Farms,info@okafor.ng\n,not-an-email\n");
  await expect(page.getByRole("form", { name: "Import customers" }).getByRole("alert")).toHaveText(
    "Nothing was imported. Fix these rows and try again.",
  );
  const errors = page.getByRole("table", { name: "Rows to fix" });
  await expect(errors).toContainText("displayName");
  await expect(errors).toContainText("must be a valid email address");

  await upload(page, "customers.csv", "displayName,email,phone,tags\nOkafor Farms,info@okafor.ng,'+234 801 234 5678,\"solar, vip\"\nBello Stores,,,\n");
  await expect(page.getByRole("status")).toHaveText("Imported 2 customers.");
  await page.goto("/app/customers");
  await expect(page.getByRole("link", { name: "Okafor Farms" })).toBeVisible();

  // Export: a CSV of this workspace's customers, phone restored on import.
  const exported = await page.request.get("/app/customers/export");
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-type"]).toContain("text/csv");
  const text = await exported.text();
  expect(text).toContain("Okafor Farms,,info@okafor.ng,'+234 801 234 5678");
  expect(text).toContain("Bello Stores");

  // A lead sharing the customer's phone in another format.
  await page.goto("/app/import?type=leads");
  await upload(page, "leads.csv", "contactName,companyName,phone,stage\nChidi Okafor,Okafor Farms Ltd,0801 234 5678,Qualified\n");
  await expect(page.getByRole("status")).toHaveText("Imported 1 lead.");
  await page.goto("/app/leads");
  await page.goto((await page.getByRole("link", { name: "Chidi Okafor · Okafor Farms Ltd" }).getAttribute("href"))!);
  await expect(page.getByRole("heading", { level: 1, name: "Chidi Okafor · Okafor Farms Ltd" })).toBeVisible();

  const duplicates = page.getByRole("complementary", { name: "Possible duplicates" });
  await expect(duplicates.getByRole("link", { name: "Okafor Farms", exact: true })).toBeVisible();
  await expect(duplicates).toContainText("same phone");

  const conversion = page.getByRole("form", { name: "Convert to customer" });
  await conversion.getByLabel(/Link to Okafor Farms/).check();
  await conversion.getByRole("button", { name: "Convert to customer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Okafor Farms" })).toBeVisible();
  const leads = page.getByRole("complementary", { name: "Leads" });
  await expect(leads.getByRole("link", { name: "Chidi Okafor · Okafor Farms Ltd" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Contacts" })).toContainText("Chidi Okafor");

  // The lead keeps its page and now links to the customer.
  await leads.getByRole("link", { name: "Chidi Okafor · Okafor Farms Ltd" }).click();
  await expect(page.getByRole("complementary", { name: "Customer" })).toContainText("Converted to Okafor Farms");
  await expect(page.getByRole("form", { name: "Convert to customer" })).toHaveCount(0);
});

test("a salesperson cannot export or import, but can convert a lead", async ({ browser }) => {
  const owner = await browser.newPage();
  await newUserWithWorkspace(owner, "Kemi Owner", "Trade Co");

  const sales = await browser.newPage();
  const salesEmail = await newUserWithWorkspace(sales, "Seyi Sales", "Own Shop");
  const [{ organizationId }] = await sql(
    `SELECT "organizationId" FROM member m JOIN "user" u ON u.id = m."userId" WHERE u.name = $1`,
    ["Kemi Owner"],
  );
  const [{ id: userId }] = await sql(`SELECT id FROM "user" WHERE email = $1`, [salesEmail]);
  await sql(`INSERT INTO member (id, "organizationId", "userId", role) VALUES (gen_random_uuid()::text, $1, $2, 'sales')`, [organizationId, userId]);
  await sql(`UPDATE session SET "activeOrganizationId" = $1 WHERE "userId" = $2`, [organizationId, userId]);

  await sales.goto("/app/customers");
  await expect(sales.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
  await expect(sales.getByRole("link", { name: "Export" })).toHaveCount(0);
  await expect(sales.getByRole("link", { name: "Import" })).toHaveCount(0);
  for (const path of ["/app/customers/export", "/app/leads/export"]) {
    const response = await sales.request.get(path);
    expect(response.status()).toBe(403);
    expect(await response.text()).not.toContain(",");
  }
  await sales.goto("/app/import?type=leads");
  await expect(sales.getByText("Your role does not include access to this page.")).toBeVisible();

  await sales.goto("/app/leads/new");
  await sales.getByLabel("Contact name").fill("Musa Bello");
  await sales.getByRole("button", { name: "Add lead" }).click();
  await expect(sales).toHaveURL(/\/app\/leads\/[0-9a-f-]+$/);
  await sales.goto(sales.url());
  await sales.getByRole("button", { name: "Convert to customer" }).click();
  await expect(sales.getByRole("heading", { level: 1, name: "Musa Bello" })).toBeVisible();
  await expect(sales.locator("header.topbar p")).toContainText("CUSTOMERS");
});
