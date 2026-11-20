import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct horse battery staple";
let ip = 1;

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
}

test("an owner brands the workspace and customers see it on documents", async ({ page, browser }) => {
  await newUserWithWorkspace(page, "Tobi Owner", "Tobi Electric");
  const setup = page.getByRole("region", { name: "Set up your workspace" });
  await expect(setup).toContainText("0 of 4 done");
  await setup.getByRole("listitem").filter({ hasText: "Add your logo" }).getByRole("link", { name: "Do this" }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);

  const branding = page.getByRole("region", { name: "Branding" });
  const logo = branding.getByRole("form", { name: "Logo" });
  await logo.getByLabel(/^Logo/).setInputFiles({ name: "logo.svg", mimeType: "image/png", buffer: Buffer.from("<svg/>") });
  await logo.getByRole("button", { name: "Upload logo" }).click();
  await expect(branding.getByText("The logo must be a PNG or JPEG image.")).toBeVisible();
  await logo.getByLabel(/^Logo/).setInputFiles("test/fixtures/logo.png");
  await logo.getByRole("button", { name: "Upload logo" }).click();
  await expect(branding.getByText("Logo saved.")).toBeVisible();
  await expect(branding.getByRole("img", { name: "Tobi Electric logo" })).toBeVisible();
  const accent = branding.getByRole("form", { name: "Accent colour" });
  await accent.getByLabel("Accent colour for document titles").fill("#1f3a5f");
  await accent.getByRole("button", { name: "Save colour" }).click();
  await expect(branding.getByText("Colour saved.")).toBeVisible();

  await page.goto("/app");
  await expect(setup).toContainText("1 of 4 done");

  // An issued invoice: the customer's page shows the logo; the PDF downloads.
  await page.goto("/app/customers/new");
  await page.getByLabel("Name", { exact: true }).fill("Bello Stores");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  await page.goto("/app/invoices/new");
  const builder = page.getByRole("form", { name: "Invoice" });
  await builder.getByRole("combobox", { name: /^Customer/ }).selectOption({ label: "Bello Stores" });
  await builder.getByLabel("Description 1").fill("Wiring");
  await builder.getByLabel("Unit price 1").fill("25000");
  await builder.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/app\/invoices\/[0-9a-f-]+$/);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.locator(".topbar .status-pill")).toHaveText("Issued");
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByLabel("Share link").inputValue();

  const customer = await (await browser.newContext()).newPage();
  await customer.goto(link);
  const image = customer.getByRole("img", { name: "Tobi Electric logo" });
  await expect(image).toBeVisible();
  const src = (await image.getAttribute("src"))!;
  expect(src).toMatch(/^\/logo\/[A-Za-z0-9_-]+\/[0-9a-f]{16}$/);
  const served = await customer.request.get(src);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/png");
  expect(served.headers()["cache-control"]).toContain("immutable");
  expect((await customer.request.get(src.replace(/[0-9a-f]{16}$/, "0".repeat(16)))).status()).toBe(404);
  const pdf = await customer.request.get(`${link}/pdf`);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).length).toBeGreaterThan(5000);
});
