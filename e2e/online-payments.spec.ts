import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

const PASSWORD = "correct horse battery staple";
let ip = 1;

async function newUserWithWorkspace(page: Page, name: string, workspace: string) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${10 + ip++}` });
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

const unique = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
const confirmNext = (page: Page) => page.once("dialog", (dialog) => dialog.accept());
const pill = (page: Page) => page.locator(".topbar .status-pill");

const PAYSTACK_TEST_KEY = "sk_test_e2e_paystack_0001";

test("a customer pays an invoice online through Paystack; duplicate webhooks change nothing", async ({ page, browser }) => {
  await newUserWithWorkspace(page, "Yemi Owner", "Pay Co");

  // Connect the workspace's own (test) Paystack account.
  await page.goto("/app/settings");
  const providers = page.getByRole("region", { name: "Payment providers" });
  await expect(providers.getByText("No provider connected.")).toBeVisible();
  const connect = providers.getByRole("form", { name: "Connect a provider" });
  await connect.getByRole("combobox", { name: /^Provider/ }).selectOption("paystack");
  await connect.getByRole("textbox", { name: /^Secret key/ }).fill(PAYSTACK_TEST_KEY);
  await connect.getByLabel("NGN").check();
  await connect.getByRole("button", { name: "Connect Paystack" }).click();
  await expect(providers.getByText("Key sk_test_…0001 · NGN")).toBeVisible();
  await expect(providers).not.toContainText(PAYSTACK_TEST_KEY);
  const webhookUrl = (await providers.locator("code").textContent())!;
  expect(webhookUrl).toMatch(/\/api\/webhooks\/paystack\/[0-9a-f-]+$/);

  // An issued invoice, shared with the customer.
  const customerEmail = unique("ngozi");
  await page.goto("/app/customers/new");
  await page.getByLabel("Name", { exact: true }).fill("Eze Stores");
  await page.getByLabel("Email").fill(customerEmail);
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  await page.goto("/app/invoices/new");
  const builder = page.getByRole("form", { name: "Invoice" });
  await builder.getByRole("combobox", { name: /^Customer/ }).selectOption({ label: "Eze Stores" });
  await builder.getByLabel("Description 1").fill("Inverter servicing");
  await builder.getByLabel("Unit price 1").fill("45000");
  await builder.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/app\/invoices\/[0-9a-f-]+$/);
  confirmNext(page);
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(pill(page)).toHaveText("Issued");
  const invoiceUrl = page.url();
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByLabel("Share link").inputValue();

  // The customer pays through the provider's checkout and comes back.
  const customer = await (await browser.newContext()).newPage();
  await customer.goto(link);
  await customer.getByRole("button", { name: "Pay ₦45,000.00 with Paystack" }).click();
  await expect(customer.getByRole("heading", { name: "Test checkout" })).toBeVisible();
  await customer.getByRole("button", { name: "Pay" }).click();
  await expect(customer).toHaveURL(/\/i\/[A-Za-z0-9_-]{43}\?attempt=/);
  await expect(customer.getByText("Paid in full. Thank you.")).toBeVisible();
  await expect(customer.getByRole("button", { name: /Pay .* with Paystack/ })).toHaveCount(0);

  await page.goto(invoiceUrl);
  await expect(pill(page)).toHaveText("Paid");
  const payments = page.getByRole("region", { name: "Payments" });
  await expect(payments).toContainText("Paystack · Card");
  await expect(payments).toContainText("confirmed by Paystack");

  // The provider's webhooks, delivered three times, signed with the key: one payment still.
  const reference = /attempt=([0-9a-f-]+)/.exec(customer.url())![1];
  const body = JSON.stringify({ event: "charge.success", data: { id: 1000, reference } });
  const signature = createHmac("sha512", PAYSTACK_TEST_KEY).update(body).digest("hex");
  for (let i = 0; i < 3; i++) {
    const response = await page.request.post(webhookUrl, { data: body, headers: { "content-type": "application/json", "x-paystack-signature": signature } });
    expect(response.status()).toBe(200);
  }
  const forged = await page.request.post(webhookUrl, { data: body, headers: { "content-type": "application/json", "x-paystack-signature": "0".repeat(128) } });
  expect(forged.status()).toBe(400);
  await page.reload();
  await expect(payments.getByRole("listitem").filter({ hasText: "₦45,000.00" })).toHaveCount(1);
});
