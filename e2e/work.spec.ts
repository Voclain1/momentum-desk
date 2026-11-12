import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

const PASSWORD = "correct horse battery staple";
let ip = 1;

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
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${170 + ip++}` });
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

async function addLead(page: Page, name: string) {
  await page.goto("/app/leads/new");
  await page.getByLabel("Contact name").fill(name);
  await page.getByRole("button", { name: "Add lead" }).click();
  await expect(page).toHaveURL(/\/app\/leads\/[0-9a-f-]+$/);
  // Edit only once the page has settled.
  await page.goto(page.url());
  return page.url();
}

test("notes, logged calls and history build a lead's timeline; tasks track follow-ups", async ({ page }) => {
  await newUserWithWorkspace(page, "Tolu Team", "Sunny Panels");
  await addLead(page, "Kemi Ade");

  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline).toContainText("Tolu Team added a lead");
  await timeline.getByLabel("What happened").fill("Wants a 5kW system for the shop");
  await timeline.getByRole("button", { name: "Add to timeline" }).click();
  await expect(timeline.getByText("Wants a 5kW system for the shop")).toBeVisible();

  // A call logged after the fact, at a past time in Lagos.
  await timeline.getByLabel("Type").first().selectOption("call");
  await timeline.getByLabel("When").first().fill("2026-01-10T15:30");
  await timeline.getByLabel("What happened").first().fill("Agreed a site visit");
  await timeline.getByRole("button", { name: "Add to timeline" }).click();
  const call = timeline.getByRole("listitem").filter({ hasText: "Agreed a site visit" });
  await expect(call).toContainText("Call");
  await expect(call).toContainText("10 Jan 2026, 15:30");

  // Editing your own note marks it edited.
  const note = timeline.getByRole("listitem").filter({ hasText: "Wants a 5kW system" });
  await note.getByRole("button", { name: "Edit" }).click();
  await timeline.getByRole("form", { name: "Save" }).getByLabel("What happened").fill("Wants a 5kW system for the shop and home");
  await timeline.getByRole("button", { name: "Save", exact: true }).click();
  await expect(timeline.getByRole("listitem").filter({ hasText: "shop and home" })).toContainText("edited");

  // A stage change appears in the history with stage names.
  await page.getByLabel("Stage").selectOption({ label: "Contacted" });
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("status").first()).toHaveText("Lead saved.");
  await expect(timeline).toContainText("moved this lead from New to Contacted");

  // Tasks: an overdue follow-up, completed from the lead.
  const tasks = page.getByRole("region", { name: "Tasks" });
  await tasks.getByLabel("Task", { exact: true }).fill("Send site visit date");
  await tasks.getByLabel("Due date").fill("2026-01-12");
  await tasks.getByRole("button", { name: "Add task" }).click();
  const task = tasks.getByRole("listitem").filter({ hasText: "Send site visit date" });
  await expect(task).toContainText("Overdue");

  await page.goto("/app");
  await expect(page.getByRole("region", { name: "Your tasks" })).toContainText("1 overdue");

  await page.locator("aside").getByRole("link", { name: "Tasks" }).click();
  const overdue = page.getByRole("region", { name: "Overdue" });
  await expect(overdue.getByText("Send site visit date")).toBeVisible();
  await expect(overdue.getByRole("link", { name: "Kemi Ade" })).toBeVisible();
  await overdue.getByLabel("Complete Send site visit date").check();
  await expect(page.getByRole("region", { name: "Overdue" })).toHaveCount(0);
  await page.getByRole("link", { name: "Show done" }).click();
  await expect(page.getByRole("region", { name: "Done" })).toContainText("Done");

  // A standalone task due today shows on the dashboard.
  await page.goto("/app/tasks");
  const form = page.getByRole("form", { name: "Add a task" });
  await form.getByLabel("Task", { exact: true }).fill("Renew insurance");
  await form.getByLabel("Due date").fill(new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }));
  await form.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("region", { name: "Today" }).getByText("Renew insurance")).toBeVisible();
  await page.goto("/app");
  await expect(page.getByRole("region", { name: "Your tasks" })).toContainText("1 due today");

  // The lead's timeline shows the task's history too.
  await page.goto("/app/leads");
  await page.getByRole("link", { name: "Kemi Ade" }).click();
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Tolu Team completed a task");
});

test("finance members do not see tasks or notes about leads", async ({ browser }) => {
  const owner = await browser.newPage();
  await newUserWithWorkspace(owner, "Olu Owner", "Quiet Co");
  await addLead(owner, "Hidden Prospect");
  const tasks = owner.getByRole("region", { name: "Tasks" });
  await tasks.getByLabel("Task", { exact: true }).fill("Secret lead task");
  await tasks.getByLabel("Assignee").selectOption({ label: "Unassigned" });
  await tasks.getByRole("button", { name: "Add task" }).click();
  await expect(tasks.getByText("Secret lead task")).toBeVisible();

  const finance = await browser.newPage();
  const email = await newUserWithWorkspace(finance, "Funmi Finance", "Elsewhere");
  const [{ organizationId }] = await sql(
    `SELECT "organizationId" FROM member m JOIN "user" u ON u.id = m."userId" WHERE u.name = $1`,
    ["Olu Owner"],
  );
  const [{ id: userId }] = await sql(`SELECT id FROM "user" WHERE email = $1`, [email]);
  await sql(`INSERT INTO member (id, "organizationId", "userId", role) VALUES (gen_random_uuid()::text, $1, $2, 'finance')`, [organizationId, userId]);
  await sql(`UPDATE session SET "activeOrganizationId" = $1 WHERE "userId" = $2`, [organizationId, userId]);

  await finance.goto("/app/tasks?scope=all");
  await expect(finance.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  await expect(finance.getByText("Secret lead task")).toHaveCount(0);
  await finance.goto("/app/tasks?scope=unassigned");
  await expect(finance.getByText("Secret lead task")).toHaveCount(0);
});
