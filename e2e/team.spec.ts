import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

const PASSWORD = "correct horse battery staple";

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

/**
 * Production builds cannot send confirmation emails until an email provider
 * is chosen (D17), so the test confirms the address in the test database.
 */
async function confirmEmail(address: string) {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('UPDATE "user" SET "emailVerified" = true WHERE email = $1', [address]);
  } finally {
    await client.end();
  }
}

async function signUpAndCreateWorkspace(page: Page, email: string, name: string, workspace: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Business name").fill(workspace);
  await page.getByLabel("Country").selectOption("GB");
  await page.getByLabel("Base currency").selectOption("GBP");
  await page.getByLabel("Timezone").selectOption("Europe/London");
  await page.getByLabel("Formatting locale").fill("en-GB");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("an owner invites a teammate who signs up, confirms their email and joins", async ({ browser }) => {
  const owner = await browser.newPage();
  await owner.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.211" });
  await signUpAndCreateWorkspace(owner, uniqueEmail("owner"), "Olu Owner", "Teamwork Ltd");

  await owner.locator("aside").getByRole("link", { name: "Team" }).click();
  await expect(owner).toHaveURL(/\/app\/team$/);
  const inviteeEmail = uniqueEmail("invitee");
  const inviteForm = owner.getByRole("form", { name: "Invite a teammate" });
  await inviteForm.getByLabel("Email").fill(inviteeEmail);
  await inviteForm.getByLabel("Role").selectOption("sales");
  await inviteForm.getByRole("button", { name: "Invite" }).click();
  await expect(owner.getByRole("status")).toContainText(`Invitation created for ${inviteeEmail}`);
  const row = owner.getByRole("row", { name: new RegExp(inviteeEmail) });
  await expect(row).toContainText("Sales");
  const link = (await row.locator("[data-invitation-link]").textContent())!.trim();
  expect(link).toMatch(/^\/invite\//);

  // The invitee opens the link with no account yet.
  const invitee = await browser.newPage();
  await invitee.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.212" });
  await invitee.goto(link);
  await expect(invitee).toHaveURL(/\/sign-in\?next=/);
  await invitee.getByRole("link", { name: "Create an account" }).click();
  await expect(invitee.getByText("Then accept your invitation.")).toBeVisible();
  await invitee.getByLabel("Your name").fill("Ife Invitee");
  await invitee.getByLabel("Work email").fill(inviteeEmail);
  await invitee.getByLabel("Password").fill(PASSWORD);
  await invitee.getByRole("button", { name: "Create account" }).click();

  // Back on the invitation, which needs a confirmed email first.
  await expect(invitee).toHaveURL(new RegExp(`${link}$`));
  await expect(invitee.getByRole("heading", { name: "Confirm your email first" })).toBeVisible();

  await confirmEmail(inviteeEmail);
  await invitee.reload();
  await expect(invitee.getByRole("heading", { name: "Join Teamwork Ltd" })).toBeVisible();
  await expect(invitee.getByText("as a sales team member")).toBeVisible();
  await invitee.getByRole("button", { name: "Accept and join" }).click();
  await expect(invitee).toHaveURL(/\/app$/);
  await expect(invitee.locator("aside")).toContainText("Teamwork Ltd");
  await expect(invitee.locator("aside")).toContainText("GBP base · Sales");

  // A sales member sees the team but cannot manage it or change settings.
  await invitee.goto("/app/team");
  await expect(invitee.getByRole("form", { name: "Invite a teammate" })).toHaveCount(0);
  await expect(invitee.getByRole("cell", { name: /Olu Owner/ })).toBeVisible();
  await invitee.goto("/app/settings");
  await expect(invitee.getByText("Only owners and admins can change these settings.")).toBeVisible();
  await expect(invitee.getByRole("button", { name: "Save settings" })).toHaveCount(0);

  // The owner sees the new member and changes their role.
  await owner.reload();
  await expect(owner.getByText("No pending invitations.")).toBeVisible();
  await owner.getByLabel("Role for Ife Invitee").selectOption("finance");
  await expect(owner.getByRole("status")).toHaveText("Ife Invitee is now Finance.");
  await invitee.goto("/app");
  await expect(invitee.locator("aside")).toContainText("GBP base · Finance");
});

test("an invitation link cannot be used by a different account", async ({ browser }) => {
  const owner = await browser.newPage();
  await owner.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.221" });
  await signUpAndCreateWorkspace(owner, uniqueEmail("owner"), "Ola Owner", "Private Co");
  await owner.goto("/app/team");
  const inviteForm = owner.getByRole("form", { name: "Invite a teammate" });
  await inviteForm.getByLabel("Email").fill(uniqueEmail("intended"));
  await inviteForm.getByRole("button", { name: "Invite" }).click();
  const link = (await owner.locator("[data-invitation-link]").first().textContent())!.trim();

  const other = await browser.newPage();
  await other.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.222" });
  const otherEmail = uniqueEmail("other");
  await signUpAndCreateWorkspace(other, otherEmail, "Other Person", "Other Co");
  await confirmEmail(otherEmail);
  await other.goto(link);
  await expect(other.getByRole("heading", { name: "This invitation is for someone else" })).toBeVisible();
  await expect(other.getByRole("button", { name: "Accept and join" })).toHaveCount(0);
});
