import { expect, test } from "@playwright/test";

test("terms and privacy drafts are public, marked for review, and linked where people sign up", async ({ page }) => {
  for (const [path, heading] of [["/privacy", "Privacy policy"], ["/terms", "Terms of service"]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Draft for legal review");
  }
  await expect(page.getByText("We never see or store card details")).toHaveCount(0); // on /terms
  await page.goto("/privacy");
  await expect(page.getByText(/We never see or store card details/)).toBeVisible();
  await page.goto("/sign-up");
  await page.getByRole("link", { name: "privacy policy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
});
