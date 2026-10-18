import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct horse battery staple";

// Rate limits are per client IP and stay on in these production-build tests.
// Give each test its own documentation-range address so they do not share a budget.
let nextClientIp = 1;
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${nextClientIp++}` });
});

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

async function signUp(page: Page, email: string, name = "Ada Obi") {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function createWorkspace(page: Page, name: string) {
  await page.getByLabel("Business name").fill(name);
  await page.getByLabel("Country").selectOption("NG");
  await page.getByLabel("Base currency").selectOption("USD");
  await page.getByLabel("Default invoice currency").selectOption("NGN");
  await page.getByLabel("Timezone").selectOption("Africa/Lagos");
  await page.getByLabel("Formatting locale").fill("en-NG");
  await expect(page.getByText("Amounts will look like")).toContainText("1,234,567.88");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("a new user signs up, creates a workspace and reaches the dashboard", async ({ page }) => {
  const email = uniqueEmail("owner");
  await signUp(page, email);
  await createWorkspace(page, "Acme Solar");

  const sidebar = page.locator("aside");
  await expect(sidebar.getByText("Acme Solar")).toBeVisible();
  await expect(sidebar.getByText("USD base · Owner")).toBeVisible();
  await expect(sidebar.getByText(email)).toBeVisible();

  const activity = page.getByRole("region", { name: "Recent activity" });
  await expect(activity).toContainText("Ada Obi created the workspace");
  await expect(activity).toContainText("times in Africa/Lagos");

  // With a workspace, onboarding sends the user back to the dashboard.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/app$/);
});

test("signed-out visitors are sent to sign-in and returned afterwards", async ({ page }) => {
  const email = uniqueEmail("returning");
  await signUp(page, email);
  await createWorkspace(page, "Northwind Studio");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.goto("/app?tab=overview");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%3Ftab%3Doverview$/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Email or password is incorrect.");

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\?tab=overview$/);
  await expect(page.locator("aside").getByText("Northwind Studio")).toBeVisible();
});

test("a forged session cookie does not get past the server check", async ({ page, context }) => {
  await context.addCookies([
    { name: "better-auth.session_token", value: "forged.token", url: "http://localhost:3100" },
  ]);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("sign-in ignores redirects to other sites", async ({ page }) => {
  const email = uniqueEmail("redirect");
  await signUp(page, email);
  await createWorkspace(page, "Redirect Test");
  await page.getByRole("button", { name: "Sign out" }).click();

  await page.goto("/sign-in?next=https://evil.example/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
});

test("each workspace sees only its own activity", async ({ browser }) => {
  const alpha = await browser.newPage();
  await alpha.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.201" });
  await signUp(alpha, uniqueEmail("alpha"), "Alpha Owner");
  await createWorkspace(alpha, "Alpha Works");

  const bravo = await browser.newPage();
  await bravo.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.202" });
  await signUp(bravo, uniqueEmail("bravo"), "Bravo Owner");
  await createWorkspace(bravo, "Bravo Works");

  const bravoActivity = bravo.getByRole("region", { name: "Recent activity" });
  await expect(bravoActivity).toContainText("Bravo Owner created the workspace");
  await expect(bravoActivity).not.toContainText("Alpha Owner");
  await expect(bravo.locator("aside")).not.toContainText("Alpha Works");

  await alpha.reload();
  await expect(alpha.getByRole("region", { name: "Recent activity" })).not.toContainText("Bravo Owner");
});

test("an owner changes workspace settings; a stale tab cannot overwrite them", async ({ page, context }) => {
  await signUp(page, uniqueEmail("settings"), "Sam Owner");
  await createWorkspace(page, "Settings Co");

  await page.locator("aside").getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await expect(page.locator(".settings-locked")).toContainText("US Dollar (USD)");

  // A second tab opened before the first one saves.
  const staleTab = await context.newPage();
  await staleTab.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.150" });
  await staleTab.goto("/app/settings");

  await page.getByLabel("Business name").fill("Settings Company");
  await page.getByLabel("Timezone").selectOption("Europe/London");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Settings saved.");
  await expect(page.locator("aside")).toContainText("Settings Company");

  // Saving again from the same tab works: the form picked up the new version.
  await page.getByLabel("Formatting locale").fill("en-GB");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Settings saved.");

  await staleTab.getByLabel("Business name").fill("Overwritten");
  await staleTab.getByRole("button", { name: "Save settings" }).click();
  await expect(staleTab.locator("form").getByRole("alert")).toContainText("changed by someone else");

  await page.goto("/app");
  await expect(page.locator("aside")).toContainText("Settings Company");
  await expect(page.getByRole("region", { name: "Recent activity" })).toContainText(
    "Sam Owner updated workspace settings",
  );
});
