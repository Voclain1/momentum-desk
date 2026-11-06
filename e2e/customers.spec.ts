import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

const PASSWORD = "correct horse battery staple";
let ip = 1;

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

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
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${100 + ip++}` });
  const email = uniqueEmail(name.split(" ")[0].toLowerCase());
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

async function addCustomer(page: Page, name: string, extra: (page: Page) => Promise<void> = async () => {}) {
  await page.goto("/app/customers/new");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await extra(page);
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return page.url();
}

test("an owner adds, edits, searches, archives and restores customers with contacts", async ({ page, context }) => {
  await newUserWithWorkspace(page, "Olu Owner", "Sunlight Installers");

  await page.locator("aside").getByRole("link", { name: "Customers" }).click();
  await expect(page.getByText("No customers yet.")).toBeVisible();

  const url = await addCustomer(page, "Acme Solar", async (p) => {
    await p.getByLabel("Email").fill("Billing@Acme.ng");
    await p.getByLabel("Country").selectOption("NG");
    await p.getByLabel("Preferred currency").selectOption("USD");
    await p.getByLabel("Tags").fill("solar, lagos");
  });
  await expect(page.getByLabel("Email")).toHaveValue("billing@acme.ng");

  // Contacts: the first becomes primary; a new primary replaces it.
  const contacts = page.getByRole("complementary", { name: "Contacts" });
  await contacts.getByRole("button", { name: "＋ Add" }).click();
  await contacts.getByRole("form", { name: "Add a contact" }).getByLabel("Name").fill("Ada Obi");
  await contacts.getByRole("button", { name: "Add contact" }).click();
  await expect(contacts.getByRole("listitem").filter({ hasText: "Ada Obi" })).toContainText("Primary");
  await contacts.getByRole("button", { name: "＋ Add" }).click();
  const second = contacts.getByRole("form", { name: "Add a contact" });
  await second.getByLabel("Name").fill("Bayo Ade");
  await second.getByLabel("Primary contact").check();
  await second.getByRole("button", { name: "Add contact" }).click();
  await expect(contacts.getByRole("listitem").filter({ hasText: "Bayo Ade" })).toContainText("Primary");
  await expect(contacts.getByRole("listitem").filter({ hasText: "Ada Obi" })).not.toContainText("Primary");

  // Edit twice from the same tab, then a stale tab is refused.
  const stale = await context.newPage();
  await stale.goto(url);
  await page.getByLabel("Phone").fill("+234 801 234 5678");
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByRole("status")).toHaveText("Customer saved.");
  await page.getByLabel("City", { exact: true }).fill("Lagos");
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByRole("status")).toHaveText("Customer saved.");
  await stale.getByLabel("City", { exact: true }).fill("Abuja");
  await stale.getByRole("button", { name: "Save customer" }).click();
  await expect(stale.locator("form.customer-form").getByRole("alert")).toContainText("changed by someone else");

  // Search and archive.
  await addCustomer(page, "Bola Ade", async (p) => {
    await p.getByLabel("Type").selectOption("person");
  });
  await page.goto("/app/customers");
  await page.getByRole("searchbox", { name: "Search customers" }).fill("bayo");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Acme Solar" })).toBeVisible();

  await page.goto(url);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("CUSTOMERS · ARCHIVED")).toBeVisible();
  await page.goto("/app/customers");
  await expect(page.getByRole("link", { name: "Acme Solar" })).toHaveCount(0);
  await page.getByRole("link", { name: "Show archived" }).click();
  await page.getByRole("link", { name: "Acme Solar" }).click();
  await page.getByRole("button", { name: "Restore customer" }).click();
  await page.goto("/app/customers");
  await expect(page.getByRole("link", { name: "Acme Solar" })).toBeVisible();

  await page.goto("/app");
  await expect(page.getByRole("region", { name: "Recent activity" })).toContainText("Olu Owner restored a customer");
});

test("a member without customer access is shown no customers, and other workspaces get a 404", async ({ browser }) => {
  const owner = await browser.newPage();
  await newUserWithWorkspace(owner, "Ola Owner", "Private Co");
  const customerUrl = await addCustomer(owner, "Secret Client");

  const outsider = await browser.newPage();
  const outsiderEmail = await newUserWithWorkspace(outsider, "Uche Outsider", "Other Co");
  const response = await outsider.goto(customerUrl);
  expect(response?.status()).toBe(404);
  await outsider.goto("/app/customers");
  await expect(outsider.getByText("Secret Client")).toHaveCount(0);

  // Make the outsider a plain member of the first workspace and switch to it.
  const [{ organizationId }] = await sql(
    `SELECT "organizationId" FROM member m JOIN "user" u ON u.id = m."userId" WHERE u.name = $1`,
    ["Ola Owner"],
  );
  const [{ id: userId }] = await sql(`SELECT id FROM "user" WHERE email = $1`, [outsiderEmail]);
  await sql(`INSERT INTO member (id, "organizationId", "userId", role) VALUES (gen_random_uuid()::text, $1, $2, 'member')`, [
    organizationId,
    userId,
  ]);
  await sql(`UPDATE session SET "activeOrganizationId" = $1 WHERE "userId" = $2`, [organizationId, userId]);

  await outsider.goto("/app/customers");
  await expect(outsider.getByText("Your role does not include access to this page.")).toBeVisible();
  await expect(outsider.getByText("Secret Client")).toHaveCount(0);
  await outsider.goto(customerUrl);
  await expect(outsider.getByText("Your role does not include access to this page.")).toBeVisible();
});
