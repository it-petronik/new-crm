import { test, expect, type Page } from "@playwright/test";
import { Client } from "./client";
const sessions = new Map<string, Promise<Client>>();
function login(key: string) {
  if (!sessions.has(key)) sessions.set(key, Client.login(key));
  return sessions.get(key)!;
}
async function select(page: Page, label: string, name: RegExp) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name }).click();
}
async function open(page: Page) {
  await page.goto("/workspace/petronik/email");
  await page.getByRole("button", { name: "Outbound & templates" }).click();
  await expect(
    page.getByRole("heading", { name: "Outbound communication" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New message", exact: true }),
  ).toBeEnabled();
}
test("template, draft, review, test capture and immutable history persist", async ({
  browser,
}) => {
  const actor = await login("studio"),
    context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
    });
  await actor.signInBrowser(context);
  const page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  const suffix = Date.now(),
    name = `Enquiry template ${suffix}`,
    subject = `Follow-up ${suffix}`;
  await page.getByRole("button", { name: "New template", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Template name", exact: true })
    .fill(name);
  await page
    .getByRole("textbox", { name: "Subject", exact: true })
    .fill(subject);
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill(
      "Hello {{contact}}, please confirm your {{product}} requirement. Regards {{sender}}.",
    );
  await page
    .getByRole("button", { name: "Save privately", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "New message", exact: true }).click();
  await select(
    page,
    "Linked CRM record",
    /Gulf Industrial Trading · Petronik · leads/,
  );
  await select(page, "Use a template", new RegExp(name, "i"));
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).not.toHaveValue(/\{\{/);
  await page
    .getByRole("button", { name: "Save privately", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let row = page.locator("article").filter({ hasText: subject });
  await row.getByRole("button", { name: "Open message" }).click();
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Reviewed fictional follow-up. Nothing leaves this local test.");
  await page
    .getByRole("button", { name: "Save privately", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await row.getByRole("button", { name: "Open message" }).click();
  await page.getByRole("button", { name: "Mark ready", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab", { name: /Review reminders/ }).click();
  row = page.locator("article").filter({ hasText: subject });
  await row.getByRole("button", { name: "Open message" }).click();
  await page
    .getByRole("textbox", { name: "Permission / opt-in evidence" })
    .fill("Fictional customer asked for an enquiry follow-up");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm test capture" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab", { name: /History/ }).click();
  await expect(
    page.locator("article").filter({ hasText: subject }),
  ).toContainText("Test capture · not delivered");
  await open(page);
  await page.getByRole("tab", { name: /History/ }).click();
  row = page.locator("article").filter({ hasText: subject });
  await row.getByRole("button", { name: "Open message" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Captured locally · not delivered",
  );
  await expect(
    page.getByRole("button", { name: "Confirm test capture" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});
test("outbound fits desktop, tablet and phone in light and dark themes", async ({
  browser,
}) => {
  const actor = await login("studio"),
    context = await browser.newContext();
  await actor.signInBrowser(context);
  const page = await context.newPage();
  await open(page);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
      }, theme);
      for (const tab of [
        "Drafts",
        "Review reminders",
        "History",
        "Templates",
      ]) {
        await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
      }
      await page
        .getByRole("button", { name: "New message", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const box = await page.getByRole("dialog").boundingBox();
      expect(box!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: `test-results/outbound-${width}-${theme}.png`,
        animations: "disabled",
      });
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      if (width === 1440 || width === 390)
        await page.screenshot({
          path: `test-results/outbound-workspace-${width}-${theme}.png`,
          animations: "disabled",
        });
    }
  }
  await context.close();
});
test("API rejects anonymous, foreign origin and cross-role record access", async () => {
  const actor = await login("studio"),
    other = await login("cmmd"),
    hr = await login("cmhr"),
    foreign = await login("cmother");
  expect(
    (await actor.request("GET", "/api/outbound", undefined, { cookie: null }))
      .status,
  ).toBe(401);
  const c = {
    action: "draft",
    id: crypto.randomUUID(),
    recordId: "design-v2-lead-0",
    channel: "email",
    templateId: null,
    subject: "API check",
    body: "Fictional private draft",
  };
  // Choose a verified accessible CRM record, not a guessed fixture identity.
  const records = await actor.request("GET", "/api/records");
  const lead = records.body.records.find(
    (r: any) => r.company === "Petronik" && r.kind === "leads" && r.email,
  );
  expect(lead).toBeTruthy();
  c.recordId = lead.id;
  expect(
    (
      await actor.request("POST", "/api/outbound", c, {
        origin: "https://foreign.invalid",
      })
    ).status,
  ).toBe(403);
  expect((await hr.request("POST", "/api/outbound", c)).status).toBe(404);
  expect((await foreign.request("POST", "/api/outbound", c)).status).toBe(404);
  expect((await actor.request("POST", "/api/outbound", c)).status).toBe(200);
  const privateView = await other.request("GET", "/api/outbound");
  expect(privateView.body.messages.some((m: any) => m.id === c.id)).toBe(false);
  expect(
    (
      await other.request("POST", "/api/outbound", {
        action: "ready",
        id: c.id,
        version: 1,
      })
    ).status,
  ).toBe(404);
});
