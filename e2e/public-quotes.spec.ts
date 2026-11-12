import { expect, test, type Page } from "@playwright/test";
import { lastEmailTo } from "./outbox";

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
  return email;
}

/** A customer with an email and a sent quote; returns the quote page URL. */
async function sentQuote(page: Page, customerEmail: string) {
  await page.goto("/app/customers/new");
  await page.getByLabel("Name", { exact: true }).fill("Okafor Farms");
  await page.getByLabel("Email").fill(customerEmail);
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  await page.goto((await page.getByRole("link", { name: "＋ New quote" }).getAttribute("href"))!);
  const quote = page.getByRole("form", { name: "Quote" });
  await quote.getByLabel("Description 1").fill("Solar installation");
  await quote.getByLabel("Quantity 1").fill("2");
  await quote.getByLabel("Unit price 1").fill("185000");
  await quote.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/app\/quotes\/[0-9a-f-]+$/);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.locator(".topbar .status-pill")).toHaveText("Sent");
  return page.url();
}

const unique = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

test("the customer opens the emailed quote and accepts it with a code; the evidence is kept", async ({ page, browser }) => {
  await newUserWithWorkspace(page, "Uche Owner", "Sun Power");
  const customerEmail = unique("chidi");
  const quoteUrl = await sentQuote(page, customerEmail);

  await page.getByRole("button", { name: `Email to ${customerEmail}` }).click();
  await expect(page.getByText(`Quote emailed to ${customerEmail}.`)).toBeVisible();
  const invitation = await lastEmailTo(customerEmail, /Quote Q-0001 from Sun Power/);
  const link = /(http:\/\/localhost:\d+\/q\/[A-Za-z0-9_-]{43})/.exec(invitation.text)![1];

  // The customer has no account and no session.
  const customer = await (await browser.newContext()).newPage();
  await customer.goto(link);
  const pdf = await customer.request.get(`${link}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect(pdf.headers()["content-disposition"]).toContain('filename="Q-0001.pdf"');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const document = customer.getByRole("article", { name: "Quote Q-0001" });
  await expect(document).toContainText("Okafor Farms");
  await expect(document).toContainText("₦370,000.00");

  await customer.getByLabel("Your full name").fill("Chidi Okafor");
  await customer.getByRole("button", { name: "Email me a code" }).click();
  await expect(customer.getByText(/We sent a 6-digit code to c•+@example\.com\./)).toBeVisible();
  const code = /is: (\d{6})/.exec((await lastEmailTo(customerEmail, /to accept quote Q-0001/)).text)![1];
  await customer.getByLabel(/6-digit code/).fill(code === "000000" ? "111111" : "000000");
  await customer.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(customer.getByText("That code is not right. 4 tries left.")).toBeVisible();
  await customer.getByLabel(/6-digit code/).fill(code);
  await customer.getByRole("button", { name: "Confirm acceptance" }).click();
  // The page turns into its answered state.
  await expect(customer.getByText(/Accepted by Chidi Okafor on .*Thank you; Sun Power has your acceptance of this version\./)).toBeVisible();
  await customer.reload();
  await expect(customer.getByText(/Accepted by Chidi Okafor on/)).toBeVisible();
  await expect(customer.getByRole("button", { name: "Email me a code" })).toHaveCount(0);

  await page.goto(quoteUrl);
  await expect(page.locator(".topbar .status-pill")).toHaveText("Accepted");
  const activity = page.getByRole("region", { name: "Customer activity" });
  await expect(activity).toContainText(`By Chidi Okafor, confirmed by a code sent to ${customerEmail}`);
  await expect(activity).toContainText("Viewed");
  await expect(page.getByRole("button", { name: "Revise" })).toHaveCount(0);
  await page.goto("/app");
  await expect(page.getByRole("region", { name: "Recent activity" })).toContainText("A customer accepted a quote");
});

test("a shared link can be declined, superseded or revoked", async ({ page, browser }) => {
  await newUserWithWorkspace(page, "Vic Owner", "Volt Co");
  const quoteUrl = await sentQuote(page, unique("bola"));
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByLabel("Quote link").inputValue();
  expect(link).toMatch(/\/q\/[A-Za-z0-9_-]{43}$/);

  const customer = await (await browser.newContext()).newPage();
  await customer.goto(link);
  await customer.getByRole("tab", { name: "Decline" }).click();
  await customer.getByLabel("Reason (optional)").fill("Over budget this quarter");
  await customer.getByRole("button", { name: "Decline quote" }).click();
  await expect(customer.getByText("You declined this quote. Your answer has been recorded for Volt Co.")).toBeVisible();

  await page.goto(quoteUrl);
  await expect(page.locator(".topbar .status-pill")).toHaveText("Rejected");
  await expect(page.getByRole("region", { name: "Customer activity" })).toContainText("Reason: Over budget this quarter");

  // A new revision, once sent, replaces the old link's content with a notice.
  await page.getByRole("button", { name: "Revise" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("revision 2");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.locator(".topbar .status-pill")).toHaveText("Sent");
  await customer.goto(link);
  await expect(customer.getByText("This quote was replaced by a newer version.")).toBeVisible();
  await expect(customer.getByRole("article")).toHaveCount(0);

  // Revoked links look like links that never existed.
  await page.getByRole("button", { name: "Create link" }).click();
  const second = await page.getByLabel("Quote link").inputValue();
  await customer.goto(second);
  await expect(customer.getByRole("article", { name: "Quote Q-0001" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Revoke links" }).click();
  await expect(page.getByText("1 link revoked.")).toBeVisible();
  const response = await customer.goto(second);
  expect(response?.status()).toBe(404);
  expect((await customer.request.get(`${second}/pdf`)).status()).toBe(404);
  // Staff can still download every revision, with their session.
  const staffPdf = await page.request.get(`${quoteUrl}/pdf`);
  expect(staffPdf.status()).toBe(200);
  expect(staffPdf.headers()["content-disposition"]).toContain('filename="Q-0001.pdf"');
  await expect(customer.getByRole("article")).toHaveCount(0);
});
