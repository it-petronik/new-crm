import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "./client";
import { WORKER } from "./people";

/**
 * Phase 8 browser review against `npm run dev:review` (fictional local data
 * from scripts/design-test-seed.ts). Run with:
 *   MAIL_REVIEW_SERVER=1 TASKS_CONTROL_FILE=.wrangler/manual-review.X/control-token \
 *   npx playwright test -c playwright.tasks.config.ts
 * Screenshots go to TASKS_SHOTS (outside the repository).
 */
const SHOTS = process.env.TASKS_SHOTS || resolve("test-results/tasks-shots");
const shot = async (page: Page, name: string) => (await page.waitForTimeout(450), page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }));
const noSideScroll = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth + 1);
const theme = async (page: Page, t: "light" | "dark") => (await page.evaluate((v) => (document.documentElement.dataset.theme = v), t), await page.waitForTimeout(400));
const sweep = async () => {
  const token = readFileSync(resolve(process.env.TASKS_CONTROL_FILE || ".wrangler/collab-test/control-token"), "utf8");
  const r = await fetch(`${WORKER}/__test/automation-sweep`, { method: "POST", headers: { "X-Test-Control": token } });
  expect(r.status).toBe(200);
  return r.json();
};

test.describe.configure({ mode: "serial" });
// One sign-in per person per run: sign-in attempts are rate limited.
const sessions = new Map<string, Promise<Client>>();
const login = (key: string) => (sessions.has(key) ? sessions.get(key)! : (sessions.set(key, Client.login(key)), sessions.get(key)!));

test("Tasks: My Day views, layouts and both themes", async ({ browser }) => {
  const md = await login("studio");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await md.signInBrowser(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/workspace/all-companies/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
  // One navigation entry, under the existing workspace group.
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Tasks" })).toHaveCount(1);
  const tabs = page.getByRole("tablist", { name: "Task views" });
  await expect(page.getByRole("list", { name: "Today tasks" })).toContainText("Follow up: Atlas Marine Services");
  for (const t of ["light", "dark"] as const) {
    await theme(page, t);
    for (const [tab, name] of [["Today", "today"], ["Overdue", "overdue"], ["Upcoming", "upcoming"], ["Completed", "completed"], ["Automation", "automation"]]) {
      await tabs.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
      await page.waitForTimeout(250);
      expect(await noSideScroll(page)).toBe(true);
      await shot(page, `desktop-${t}-${name}`);
    }
  }
  await tabs.getByRole("tab", { name: /^Overdue/ }).click();
  await expect(page.getByRole("list", { name: "Overdue tasks" })).toContainText("Chase signed proforma");
  await tabs.getByRole("tab", { name: /^Completed/ }).click();
  await expect(page.getByRole("list", { name: "Completed tasks" })).toContainText("Arrange plant visit");
  // Team view: an MD sees work assigned to others, with the person shown.
  await tabs.getByRole("tab", { name: /^Today/ }).click();
  await page.getByRole("group", { name: "Whose tasks" }).getByRole("button", { name: "Team" }).click();
  await expect(page.getByRole("list", { name: "Today tasks" })).toContainText("Call buyer about sample results");
  await expect(page.getByRole("list", { name: "Today tasks" })).toContainText("Commercial Seller");
  await theme(page, "light");
  await shot(page, "desktop-light-team");
  for (const [w, h, label] of [[900, 1100, "tablet"], [390, 844, "phone"]] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const t of ["light", "dark"] as const) {
      await theme(page, t);
      await page.waitForTimeout(200);
      expect(await noSideScroll(page)).toBe(true);
      await shot(page, `${label}-${t}-team`);
    }
  }
  // Phone: touch-sized completion control.
  const box = await page.getByRole("button", { name: /complete$/ }).first().boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(43);
  expect(errors).toEqual([]);
  await context.close();
});

test("Tasks: create, complete, reopen with history; record details and Action Center", async ({ browser }) => {
  const md = await login("studio");
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await md.signInBrowser(context);
  const page = await context.newPage();
  await page.goto("/workspace/all-companies/tasks");
  const title = `Fictional: call about drum sizes ${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "New task" }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Search a record to link").fill("Atlas");
  await dialog.getByRole("list", { name: "Matching records" }).getByRole("button").filter({ hasText: "Lead ·" }).first().click();
  await expect(dialog).toContainText("Lead · Atlas Marine Services");
  await shot(page, "desktop-light-new-task");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();
  const list = page.getByRole("list", { name: "Today tasks" });
  await expect(list).toContainText(title);
  await list.getByRole("button", { name: `Mark ${title} complete` }).click();
  await expect(list).not.toContainText(title);
  await page.getByRole("tab", { name: /^Completed/ }).click();
  await page.getByRole("list", { name: "Completed tasks" }).getByRole("button", { name: title, exact: true }).click();
  const detail = page.getByRole("dialog", { name: title });
  await expect(detail.getByRole("list", { name: "Task history" })).toContainText("Completed task");
  await shot(page, "desktop-light-task-detail");
  await detail.getByRole("button", { name: "Reopen" }).click();
  await expect(detail.getByRole("list", { name: "Task history" })).toContainText("Reopened task");
  await detail.getByRole("button", { name: "Close", exact: true }).click();

  // The same task on the lead's page.
  await page.goto("/workspace/all-companies/sales-pipeline");
  await page.getByRole("button", { name: "Atlas Marine Services" }).first().click();
  // Commercial records keep tasks with meetings and notes, under Activity.
  await page.getByRole("tablist", { name: "Commercial relationships sections" }).getByRole("tab", { name: "Activity" }).click();
  const section = page.locator("section[aria-labelledby^='record-tasks-']");
  await expect(section.first()).toContainText("Follow up: Atlas Marine Services");
  await expect(section.first()).toContainText(title);
  await section.first().scrollIntoViewIfNeeded();
  await shot(page, "desktop-light-record-tasks");

  // Action Center: the lead's follow-up names its task; no duplicate row.
  await page.goto("/workspace/all-companies/action-center");
  await expect(page.locator("[data-signal]").first()).toBeVisible();
  const taskRows = page.locator('[data-signal="TASK_DUE_TODAY"], [data-signal="TASK_OVERDUE"]');
  expect(await taskRows.count()).toBeGreaterThan(0);
  await expect(page.locator(".action-card-task").first()).toBeVisible();
  await shot(page, "desktop-light-action-center");
  await context.close();
});

test("Automation: preview is read-only; an IT ticket creates one triage task, once", async ({ browser }) => {
  const md = await login("studio");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await md.signInBrowser(context);
  const page = await context.newPage();
  await page.goto("/workspace/all-companies/tasks");
  await page.getByRole("tab", { name: "Automation" }).click();
  const lead = page.getByLabel("Lead follow-up due", { exact: true });
  await lead.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByRole("dialog", { name: /^Preview/ });
  await expect(preview).toContainText("Read-only");
  await shot(page, "desktop-light-preview");
  await preview.getByRole("button", { name: "Close", exact: true }).first().click();
  const handoff = page.getByLabel("Operations handoff", { exact: true });
  await handoff.getByRole("button", { name: "History" }).click();
  const history = page.getByRole("dialog", { name: /^History/ });
  await expect(history).toContainText("Failed");
  await expect(history).toContainText("Succeeded");
  await shot(page, "desktop-light-history");
  await history.getByRole("button", { name: "Close", exact: true }).first().click();

  // Enable IT triage through the UI (it starts disabled).
  const it = page.getByLabel("IT ticket triage", { exact: true });
  // A previous interrupted review may have left its fictional rule enabled.
  if (await it.getByText("Active", { exact: true }).count()) {
    await it.getByRole("button", { name: "Edit" }).click();
    const reset = page.getByRole("dialog", { name: /Edit it ticket triage/i });
    await reset.getByLabel("Enabled — create tasks when this happens").uncheck();
    await reset.getByRole("button", { name: "Save rule" }).click();
    await expect(reset).toBeHidden();
  }
  await expect(it).toContainText("Inactive");
  await it.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: /Edit it ticket triage/i });
  await edit.getByLabel("Enabled — create tasks when this happens").check();
  await shot(page, "desktop-light-rule-edit");
  await edit.getByRole("button", { name: "Save rule" }).click();
  await expect(edit).toBeHidden();
  await expect(it).toContainText("Active");

  // A new urgent ticket → exactly one triage task for the IT administrator.
  const ticketTitle = `Fictional printer offline ${Date.now().toString(36)}`;
  const created = await md.request("POST", "/api/records", {
    kind: "it", company: "Petronik", branch: "Main", title: ticketTitle, contact: "", product: "Office printer", quantity: 0, unit: "", amount: 0,
    currency: "USD", due: new Date().toISOString().slice(0, 10), detail: "Fictional review ticket", source: "Test", attributes: { priority: "Urgent", category: "Hardware" }, requestId: `tasks-e2e-${Date.now()}`,
  });
  expect(created.status).toBe(201);
  const itAdmin = await login("cmit");
  const find = async () => (await itAdmin.request("GET", `/api/tasks?view=today&scope=mine&q=${encodeURIComponent(ticketTitle)}`)).body.items.filter((t: { title: string }) => t.title === `Triage ticket: ${ticketTitle}`);
  await expect.poll(async () => (await find()).length).toBe(1);
  await sweep();
  await sweep();
  expect((await find()).length).toBe(1);
  // Disable again so repeated review runs start from the same state.
  await it.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog", { name: /Edit it ticket triage/i }).getByLabel("Enabled — create tasks when this happens").uncheck();
  await page.getByRole("dialog", { name: /Edit it ticket triage/i }).getByRole("button", { name: "Save rule" }).click();
  await expect(it).toContainText("Inactive");
  await page.setViewportSize({ width: 390, height: 844 });
  await theme(page, "dark");
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "phone-dark-automation");
  await context.close();
});

test("Access: an executive sees only their own tasks and no automation; nothing leaks by id", async ({ browser }) => {
  const seller = await login("cmsales");
  expect((await seller.request("GET", "/api/tasks?id=design-task-today-1")).status).toBe(404);
  expect((await seller.request("GET", "/api/automation")).body.companies).toEqual([]);
  expect((await seller.request("POST", "/api/automation", { company: "Petronik", preset: "lead_follow_up", name: "Not allowed", enabled: true, assigneeId: null, dueDays: 0, dueTime: null, priority: "normal", conditions: {} })).status).toBe(403);
  const team = await seller.request("GET", "/api/tasks?view=today&scope=team");
  expect(team.body.scope).toBe("mine");
  expect(team.body.items.every((t: { assignee: { id: string } }) => t.assignee.id === seller.id)).toBe(true);
  // A task cannot be given to someone outside the company.
  const md = await login("studio");
  const other = await md.request("POST", "/api/tasks", { title: "Not allowed", company: "Petronik", assigneeId: "collab-user-cmother", dueDate: "2026-12-01", requestId: `tasks-e2e-${Date.now()}` });
  expect(other.status).toBe(400);
  expect(other.body.error).toMatch(/does not work in this company/);
  // Without the right Origin, writes are refused.
  expect((await md.request("POST", "/api/tasks", { title: "x" }, { origin: "https://evil.example" })).status).toBeGreaterThanOrEqual(400);

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await seller.signInBrowser(context);
  const page = await context.newPage();
  await page.goto("/workspace/petronik/tasks");
  await expect(page.getByRole("list", { name: "Today tasks" })).toContainText("Call buyer about sample results");
  await expect(page.getByRole("tab", { name: "Automation" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Whose tasks" })).toHaveCount(0);
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "phone-light-seller");
  await page.getByRole("button", { name: "New task" }).click();
  await shot(page, "phone-light-new-task");
  await context.close();
});
