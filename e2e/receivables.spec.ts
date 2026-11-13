import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct horse battery staple";
let ip = 1;

async function newUserWithWorkspace(page: Page, name: string, workspace: string) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${120 + ip++}` });
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
}

const unique = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
const confirmNext = (page: Page) => page.once("dialog", (dialog) => dialog.accept());
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test("an owner sets up reminders and rates, works an invoice's collection, and a customer stops reminders", async ({ page, browser }) => {
  await newUserWithWorkspace(page, "Bisi Owner", "Collect Co");

  // Reminders are off until turned on; rates can be entered by hand.
  await page.goto("/app/settings");
  const reminders = page.getByRole("region", { name: "Payment reminders" });
  await expect(reminders).toContainText("Off.");
  await expect(reminders).toContainText("3 days before due");
  const reminderForm = reminders.getByRole("form", { name: "Reminder settings" });
  await reminderForm.getByLabel("Send payment reminders").check();
  await reminderForm.getByRole("button", { name: "Save reminders" }).click();
  await expect(reminders.getByText("Reminder settings saved.")).toBeVisible();
  await page.reload();
  await expect(reminders).toContainText("On.");

  const rates = page.getByRole("region", { name: "Exchange rates" });
  const rateForm = rates.getByRole("form", { name: "Add an exchange rate" });
  await rateForm.getByLabel("Currency").fill("USD");
  await rateForm.getByLabel("NGN per unit").fill("1580.25");
  await rateForm.getByRole("button", { name: "Add rate" }).click();
  await expect(rates.getByText("1 USD = 1580.25 NGN")).toBeVisible();
  await expect(rates).toContainText("entered by Bisi Owner");

  // An issued invoice to a customer with an email.
  await page.goto("/app/customers/new");
  await page.getByLabel("Name", { exact: true }).fill("Adeyemi Foods");
  await page.getByLabel("Email").fill(unique("adeyemi"));
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  const customerUrl = page.url();
  await page.goto("/app/invoices/new");
  const builder = page.getByRole("form", { name: "Invoice" });
  await builder.getByRole("combobox", { name: /^Customer/ }).selectOption({ label: "Adeyemi Foods" });
  await builder.getByLabel("Description 1").fill("Cold room hire");
  await builder.getByLabel("Unit price 1").fill("80000");
  await builder.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/app\/invoices\/[0-9a-f-]+$/);
  confirmNext(page);
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.locator(".topbar .status-pill")).toHaveText("Issued");
  const invoiceUrl = page.url();

  // It shows up in receivables, in the current bucket.
  await page.goto("/app/receivables");
  await expect(page.getByRole("region", { name: "Ageing" })).toContainText("₦80,000.00");
  await expect(page.getByRole("region", { name: "Open invoices" })).toContainText("Adeyemi Foods");

  // Owner, promise, note; then the promise is cancelled.
  await page.goto(invoiceUrl);
  const collection = page.getByRole("region", { name: "Collection" });
  await expect(collection).toContainText("No owner yet.");
  const owner = collection.getByRole("form", { name: "Collection owner" });
  await owner.getByLabel("Owner").selectOption({ label: "Bisi Owner" });
  await owner.getByRole("button", { name: "Save owner" }).click();
  await expect(collection.getByText("Owner saved.")).toBeVisible();
  await expect(collection).toContainText("Owner: Bisi Owner");

  await collection.getByRole("button", { name: "Promise to pay" }).click();
  const promise = collection.getByRole("form", { name: "Promise to pay" });
  await promise.getByLabel("Amount (NGN)").fill("30000");
  await promise.getByLabel("By").fill(inDays(5));
  await promise.getByRole("button", { name: "Record promise" }).click();
  await expect(collection.getByText("Promise recorded; reminders wait for it.")).toBeVisible();
  await expect(collection).toContainText("Promise: ₦30,000.00");

  await collection.getByRole("button", { name: "Add note" }).click();
  const note = collection.getByRole("form", { name: "Collection note" });
  await note.getByLabel("Note (internal)").fill("Finance said Friday");
  await note.getByRole("button", { name: "Add note" }).click();
  await expect(collection.getByText("Finance said Friday")).toBeVisible();

  await collection.getByRole("button", { name: "Cancel promise" }).click();
  await expect(collection).toContainText("Cancelled");

  // Staff can stop and restart reminders for a customer.
  await page.goto(customerUrl);
  const remindersNote = page.getByLabel("Payment reminders");
  await remindersNote.getByRole("button", { name: "Stop reminders" }).click();
  await expect(remindersNote).toContainText("by your team");
  await remindersNote.getByRole("button", { name: "Restart reminders" }).click();
  await expect(remindersNote).toContainText("sent when the workspace has them on");

  // The customer stops them from the invoice link.
  await page.goto(invoiceUrl);
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByLabel("Share link").inputValue();
  const customer = await (await browser.newContext()).newPage();
  await customer.goto(link);
  await customer.getByRole("button", { name: "Stop payment reminders" }).click();
  await expect(customer.getByText("You will not get payment reminders from this business.")).toBeVisible();
  await page.goto(customerUrl);
  await expect(page.getByLabel("Payment reminders")).toContainText("by the customer");
});
