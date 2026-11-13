import { expect, test, type Page } from "@playwright/test";
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
}

const unique = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

test("Momentum AI drafts and suggests; people edit, send and save; the monthly limit holds", async ({ page }) => {
  await newUserWithWorkspace(page, "Ife Owner", "Kola Solar");

  await page.goto("/app/settings");
  const settings = page.getByRole("region", { name: "Momentum AI settings" });
  await expect(settings).toContainText("On · Anthropic claude-opus-5-5.");
  await expect(settings.getByLabel("AI usage")).toContainText("This month: 0 of 200 requests");

  // A lead: summary, next step and a follow-up draft; the person saves the summary.
  await page.goto("/app/leads/new");
  await page.getByLabel("Contact name").fill("Bola Ade");
  await page.getByLabel("Company").fill("Ade Farms");
  await page.getByLabel("What they need").fill("Solar for a cold room");
  await page.getByRole("button", { name: "Add lead" }).click();
  await expect(page).toHaveURL(/\/app\/leads\/[0-9a-f-]+$/);
  const assist = page.getByRole("region", { name: "Momentum AI" });
  await assist.getByRole("button", { name: "Summarise and suggest" }).click();
  await expect(assist.getByText("Ade Farms needs: Solar for a cold room.")).toBeVisible();
  await expect(assist).toContainText("Call them, this week.");
  await expect(assist.getByLabel("Message")).toHaveValue(/Hello Bola Ade/);
  await assist.getByRole("button", { name: "Save as note" }).click();
  await expect(assist.getByText("Summary saved as a note.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Summary (AI-assisted): Ade Farms needs")).toBeVisible();

  // Quote lines from a request: the catalogue's price, never the AI's.
  await page.goto("/app/catalogue/new");
  await page.getByLabel("Name", { exact: true }).fill("Solar panel 400W");
  await page.getByLabel("Unit price 1").fill("185,000");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page).toHaveURL(/\/app\/catalogue\/[0-9a-f-]+$/);
  await page.goto("/app/customers/new");
  const customerEmail = unique("ade");
  await page.getByLabel("Name", { exact: true }).fill("Ade Farms");
  await page.getByLabel("Email").fill(customerEmail);
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  await page.goto("/app/quotes/new");
  const builder = page.getByRole("form", { name: "Quote" });
  await builder.getByRole("combobox", { name: /^Customer/ }).selectOption({ label: "Ade Farms" });
  await builder.getByRole("button", { name: /Suggest lines from the customer's request/ }).click();
  const quoteAssist = builder.getByRole("group", { name: "Quote assistance" });
  await quoteAssist.getByLabel("What the customer asked for").fill("We need 4 panels on the cold room roof, fitted.");
  await quoteAssist.getByRole("button", { name: "Suggest lines" }).click();
  await expect(quoteAssist.getByText("4 × Solar panel 400W")).toBeVisible();
  await quoteAssist.getByRole("button", { name: "Add all lines" }).click();
  await expect(builder.getByLabel("Unit price 1")).toHaveValue("185000.00");
  await expect(builder.getByLabel("Quantity 1")).toHaveValue("4");
  await expect(builder.getByLabel("Description 2")).toHaveValue("Installation");
  await expect(builder.getByLabel("Unit price 2")).toHaveValue("");
  await expect(builder.getByText("Enter the price on 1 line")).toBeVisible();

  // Collections: an AI draft the person edits, then sends.
  await page.goto("/app/invoices/new");
  const invoiceBuilder = page.getByRole("form", { name: "Invoice" });
  await invoiceBuilder.getByRole("combobox", { name: /^Customer/ }).selectOption({ label: "Ade Farms" });
  await invoiceBuilder.getByLabel("Description 1").fill("Site survey");
  await invoiceBuilder.getByLabel("Unit price 1").fill("50000");
  await invoiceBuilder.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/app\/invoices\/[0-9a-f-]+$/);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.locator(".topbar .status-pill")).toHaveText("Issued");
  const collection = page.getByRole("region", { name: "Collection" });
  await collection.getByRole("button", { name: "Email the customer" }).click();
  const message = collection.getByRole("group", { name: "Email the customer" });
  await message.getByLabel("Tone").selectOption("firm");
  await message.getByRole("button", { name: "Draft with AI" }).click();
  await expect(message.getByLabel("Subject")).toHaveValue("Invoice INV-0001");
  await expect(message.getByLabel("Message")).toHaveValue(/₦50,000\.00 is outstanding on invoice INV-0001/);
  await message.getByLabel("Message").fill("Hello,\n\n₦50,000.00 is outstanding on invoice INV-0001. Could you pay this week?\n\nKola Solar");
  page.once("dialog", (dialog) => dialog.accept());
  await message.getByRole("button", { name: "Send email" }).click();
  await expect(collection.getByText(`Sent to ${customerEmail}.`)).toBeVisible();
  const sent = await lastEmailTo(customerEmail, /INV-0001/);
  expect(sent.text).toContain("Could you pay this week?");
  expect(sent.text).toMatch(/View the invoice, pay or download it: http:\/\/localhost:\d+\/i\/[A-Za-z0-9_-]{43}/);
  await page.reload();
  await expect(collection).toContainText(`Emailed ${customerEmail}: Invoice INV-0001`);

  // The overdue summary, then the limit: an owner lowers it to what has been used.
  await page.goto("/app/receivables");
  const summary = page.getByRole("region", { name: "Momentum AI summary" });
  await summary.getByRole("button", { name: "Summarise overdue accounts" }).click();
  await expect(summary.getByText(/Drafted by Momentum AI/)).toBeVisible();

  await page.goto("/app/settings");
  await expect(settings.getByLabel("AI usage")).toContainText("This month: 4 of 200 requests");
  await expect(settings.getByLabel("AI usage")).toContainText("6,000 tokens");
  const form = settings.getByRole("form", { name: "AI settings" });
  await form.getByLabel(/Monthly request limit/).fill("4");
  await form.getByRole("button", { name: "Save AI settings" }).click();
  await expect(settings.getByText("AI settings saved.")).toBeVisible();
  await page.goto("/app/receivables");
  await summary.getByRole("button", { name: "Summarise overdue accounts" }).click();
  await expect(summary.getByText("This workspace has used its AI requests for this month.")).toBeVisible();

  // Turned off: the AI panels go, the manual paths stay.
  await page.goto("/app/settings");
  await form.getByLabel("Use Momentum AI in this workspace").uncheck();
  await form.getByRole("button", { name: "Save AI settings" }).click();
  await expect(settings.getByText("AI settings saved.")).toBeVisible();
  await page.goto("/app/receivables");
  await expect(page.getByRole("region", { name: "Momentum AI summary" })).toHaveCount(0);
});
