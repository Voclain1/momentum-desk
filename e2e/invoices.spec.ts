import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { lastEmailTo } from "./outbox";

const PASSWORD = "correct horse battery staple";
let ip = 1;

async function newUserWithWorkspace(page: Page, name: string, workspace: string) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${160 + ip++}` });
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

async function sql(query: string, values: unknown[]) {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(query, values)).rows;
  } finally {
    await client.end();
  }
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

const unique = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
const confirmNext = (page: Page) => page.once("dialog", (dialog) => dialog.accept());
const pill = (page: Page) => page.locator(".topbar .status-pill");

test("lead → quote → customer accepts → invoice → partly paid → paid (spec scenario 1)", async ({ page, browser }) => {
  await newUserWithWorkspace(page, "Wale Owner", "Sun Power");
  await page.goto("/app/settings");
  const invoices = page.getByRole("region", { name: "Invoice settings" });
  await invoices.getByLabel("How to pay").fill("Test Bank · Sun Power Ltd · 0123456789");
  await invoices.getByLabel("Days until due").fill("30");
  await invoices.getByRole("button", { name: "Save invoice settings" }).click();
  await expect(invoices.getByText("Invoice settings saved.")).toBeVisible();

  // Lead → customer → quote.
  const customerEmail = unique("chidi");
  await page.goto("/app/leads/new");
  await page.getByLabel("Contact name").fill("Chidi Okafor");
  await page.getByLabel("Company").fill("Okafor Farms");
  await page.getByRole("textbox", { name: "Email" }).fill(customerEmail);
  await page.getByRole("button", { name: "Add lead" }).click();
  await expect(page).toHaveURL(/\/app\/leads\/[0-9a-f-]+$/);
  await page.goto(page.url());
  await page.getByRole("button", { name: "Convert to customer" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  // A company lead's contact person carries the email; send the quote to them.
  await page.goto((await page.getByRole("link", { name: "＋ New quote" }).getAttribute("href"))!);
  const builder = page.getByRole("form", { name: "Quote" });
  await builder.getByLabel("Description 1").fill("Solar installation");
  await builder.getByLabel("Quantity 1").fill("2");
  await builder.getByLabel("Unit price 1").fill("185000");
  await builder.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/app\/quotes\/[0-9a-f-]+$/);
  confirmNext(page);
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(pill(page)).toHaveText("Sent");
  const quoteUrl = page.url();
  await page.getByRole("button", { name: `Email to ${customerEmail}` }).click();
  const link = /(http:\/\/localhost:\d+\/q\/[A-Za-z0-9_-]{43})/.exec((await lastEmailTo(customerEmail, /Quote Q-0001/)).text)![1];

  // The customer accepts.
  const customer = await (await browser.newContext()).newPage();
  await customer.goto(link);
  await customer.getByLabel("Your full name").fill("Chidi Okafor");
  await customer.getByRole("button", { name: "Email me a code" }).click();
  await expect(customer.getByText(/We sent a 6-digit code/)).toBeVisible();
  const code = /is: (\d{6})/.exec((await lastEmailTo(customerEmail, /to accept quote Q-0001/)).text)![1];
  await customer.getByLabel(/6-digit code/).fill(code);
  await customer.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(customer.getByText(/Accepted by Chidi Okafor/)).toBeVisible();

  // The accepted quote becomes an invoice, amounts copied exactly.
  await page.goto(quoteUrl);
  await page.getByRole("button", { name: "Invoice this quote" }).click();
  await expect(page).toHaveURL(/\/app\/invoices\/[0-9a-f-]+$/);
  await expect(pill(page)).toHaveText("Draft");
  await expect(page.getByRole("article", { name: "Draft invoice" })).toContainText("₦370,000.00");
  await expect(page.getByRole("form", { name: "Quote" })).toHaveCount(0);
  confirmNext(page);
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(pill(page)).toHaveText("Issued");
  const invoice = page.getByRole("article", { name: "Invoice INV-0001" });
  await expect(invoice).toContainText("Test Bank · Sun Power Ltd · 0123456789");
  await expect(invoice).toContainText("₦370,000.00");
  const invoiceUrl = page.url();
  const staffPdf = await page.request.get(`${invoiceUrl}/pdf`);
  expect(staffPdf.status()).toBe(200);
  expect(staffPdf.headers()["content-disposition"]).toContain('filename="INV-0001.pdf"');

  // The customer gets the invoice by email and opens it without an account.
  await page.getByRole("button", { name: `Email to ${customerEmail}` }).click();
  await expect(page.getByText(`Invoice emailed to ${customerEmail}.`)).toBeVisible();
  const invoiceEmail = await lastEmailTo(customerEmail, /Invoice INV-0001 from Sun Power/);
  expect(invoiceEmail.text).toContain("₦370,000.00");
  const invoiceLink = /(http:\/\/localhost:\d+\/i\/[A-Za-z0-9_-]{43})/.exec(invoiceEmail.text)![1];
  await customer.goto(invoiceLink);
  await expect(customer.getByText(/₦370,000\.00 due by/)).toBeVisible();
  await expect(customer.getByRole("article", { name: "Invoice INV-0001" })).toContainText("Test Bank · Sun Power Ltd · 0123456789");
  const customerPdf = await customer.request.get(`${invoiceLink}/pdf`);
  expect(customerPdf.status()).toBe(200);
  expect((await customerPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.reload();
  await expect(pill(page)).toHaveText("Viewed");
  await expect(page.getByRole("region", { name: "Customer activity" })).toContainText("Viewed");

  // Partial payment, a refused overpayment, then the rest.
  const payments = page.getByRole("region", { name: "Payments" });
  await payments.getByLabel("Amount (NGN)").fill("100000");
  await payments.getByLabel("Reference").fill("TRF-001");
  await payments.getByRole("button", { name: "Record payment" }).click();
  await expect(pill(page)).toHaveText("Partly paid");
  await expect(payments).toContainText("owed ₦270,000.00");
  await expect(invoice).toContainText("Balance due (NGN)");
  await payments.getByLabel("Amount (NGN)").fill("270000.01");
  await payments.getByRole("button", { name: "Record payment" }).click();
  await expect(payments.getByText("Amount is more than the ₦270,000.00 still owed")).toBeVisible();
  await payments.getByLabel("Amount (NGN)").fill("270000");
  await payments.getByRole("button", { name: "Record payment" }).click();
  await expect(pill(page)).toHaveText("Paid");
  await expect(payments.getByRole("button", { name: "Record payment" })).toHaveCount(0);
  await customer.goto(invoiceLink);
  await expect(customer.getByText("Paid in full. Thank you.")).toBeVisible();

  // A bounced payment is voided; the balance returns.
  await payments.getByRole("listitem").filter({ hasText: "₦270,000.00" }).getByRole("button", { name: "Void" }).click();
  await payments.getByLabel("Reason").fill("Transfer bounced");
  await payments.getByRole("button", { name: "Void payment" }).click();
  await expect(pill(page)).toHaveText("Partly paid");
  await expect(payments).toContainText("Voided: Transfer bounced");

  await page.goto("/app/invoices?status=unpaid");
  await expect(page.getByRole("row", { name: /INV-0001/ })).toContainText("₦270,000.00");
  await page.goto(quoteUrl);
  await expect(page.getByRole("region", { name: "Invoice" }).getByRole("link", { name: "INV-0001" })).toBeVisible();
});

test("a direct invoice in another currency is issued and voided; roles are enforced", async ({ page, browser }) => {
  const ownerEmail = await newUserWithWorkspace(page, "Xena Owner", "Global Co");
  await page.goto("/app/customers/new");
  await page.getByLabel("Name", { exact: true }).fill("Acme Inc");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);

  await page.goto("/app/invoices/new");
  const builder = page.getByRole("form", { name: "Invoice" });
  await builder.getByRole("combobox", { name: /^Customer/ }).selectOption({ label: "Acme Inc" });
  await builder.getByLabel("Currency").selectOption("USD");
  await builder.getByLabel("Description 1").fill("Consulting");
  await builder.getByLabel("Quantity 1").fill("10");
  await builder.getByLabel("Unit price 1").fill("150");
  await builder.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/app\/invoices\/[0-9a-f-]+$/);
  confirmNext(page);
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(pill(page)).toHaveText("Issued");
  await expect(page.getByRole("article", { name: "Invoice INV-0001" })).toContainText("$1,500.00");
  const invoiceUrl = page.url();

  // Finance records payments but cannot void; sales cannot see invoices.
  const finance = await joinAs(browser, ownerEmail, "finance", "Fifi Finance");
  await finance.goto(invoiceUrl);
  await expect(finance.getByRole("button", { name: "Void invoice" })).toHaveCount(0);
  await expect(finance.getByRole("region", { name: "Payments" }).getByRole("button", { name: "Record payment" })).toBeVisible();
  const sales = await joinAs(browser, ownerEmail, "sales", "Sam Sales");
  expect((await sales.request.get(`${invoiceUrl}/pdf`)).status()).toBe(403);
  for (const path of ["/app/invoices", invoiceUrl]) {
    await sales.goto(path);
    await expect(sales.getByText("Your role does not include access to this page.")).toBeVisible();
  }

  await page.goto(invoiceUrl);
  await page.getByRole("button", { name: "Void invoice" }).click();
  await page.getByLabel("Reason").fill("Raised against the wrong entity");
  await page.getByRole("button", { name: "Void invoice" }).click();
  await expect(pill(page)).toHaveText("Void");
  await expect(page.getByText("Void: Raised against the wrong entity")).toBeVisible();
  await expect(page.getByRole("region", { name: "Payments" }).getByRole("button", { name: "Record payment" })).toHaveCount(0);
});
