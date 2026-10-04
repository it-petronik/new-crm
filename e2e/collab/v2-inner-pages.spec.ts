import { test, expect } from "@playwright/test";
import { Client } from "./client";

test("shared choices persist, are company-scoped and protect edits", async () => {
  const owner = await Client.login("cmsales");
  const peer = await Client.login("cmsales2");
  const outsider = await Client.login("cmother");
  const readOnlyModule = await Client.login("cmhr");
  const scope = { company: "Petronik", catalog: "leads:source" };
  const path = `/api/shared-options?${new URLSearchParams(scope)}`;
  const created = await owner.request("POST", "/api/shared-options", { ...scope, label: `partner network ${Date.now()}` });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const option = created.body.option;
  expect(option.label).toMatch(/^Partner Network/);
  expect((await peer.request("GET", path)).body.options).toContainEqual({ ...option, canManage: false });
  expect((await outsider.request("GET", path)).status).toBe(403);
  expect((await readOnlyModule.request("GET", path)).status).toBe(403);
  expect((await owner.request("GET", path, undefined, { cookie: null })).status).toBe(401);
  expect((await owner.request("POST", "/api/shared-options", { ...scope, label: option.label.toLowerCase() })).status).toBe(409);
  expect((await owner.request("POST", "/api/shared-options", { ...scope, label: "manual" })).status).toBe(409);
  expect((await owner.request("POST", "/api/shared-options", { ...scope, catalog: "leads:status", label: "Unknown" })).status).toBe(403);
  const record = await owner.request("POST", "/api/records", { kind: "leads", company: "Petronik", branch: "Main", title: "Shared choice history test", contact: "", product: "", quantity: 0, unit: "MT", amount: 0, currency: "USD", due: "2026-10-10", detail: "Fictional choice history verification", source: option.label, requestId: crypto.randomUUID() });
  expect(record.status, JSON.stringify(record.body)).toBe(201);
  const change = { ...scope, id: option.id, version: option.version, label: "Regional Partner" };
  expect((await peer.request("PATCH", "/api/shared-options", change)).status).toBe(403);
  expect((await owner.request("PATCH", "/api/shared-options", change, { origin: "https://attacker.invalid" })).status).toBe(403);
  expect((await owner.request("PATCH", "/api/shared-options", change)).status).toBe(200);
  expect((await owner.request("PATCH", "/api/shared-options", change)).status).toBe(409);
  expect((await peer.request("GET", path)).body.options.find((r: {id:string}) => r.id === option.id).label).toBe("Regional Partner");
  expect((await owner.request("DELETE", "/api/shared-options", { ...scope, id: option.id, version: 2 })).status).toBe(200);
  expect((await peer.request("GET", path)).body.options.find((r: {id:string}) => r.id === option.id)).toBeUndefined();
  expect((await owner.request("GET", "/api/records")).body.records.find((r: {id:string}) => r.id === record.body.record.id).source).toBe(option.label);
  await owner.request("PATCH", "/api/records", { action: "delete", id: record.body.record.id, expectedUpdatedAt: record.body.record.updatedAt });
});

test("V2 populated inner pages, AI access and option editor fit desktop and mobile", async ({ browser }) => {
  const actor = await Client.login("studio");
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  await actor.signInBrowser(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const records = (await actor.request("GET", "/api/records")).body.records;
  expect(records.filter((r: {id:string}) => r.id.startsWith("design-v2-")).length).toBeGreaterThan(35);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    for (const route of ["overview", "customers", "prospecting", "action-center", "accounts", "marketing", "email", "my-requests", "collaboration"]) {
      await page.goto(`/workspace/all-companies/${route}${route === "collaboration" ? "?c=design-v2-sales-room" : ""}`);
      // Next can briefly retain a hidden loading landmark during streaming.
      await expect(page.locator("#main")).toBeVisible();
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Open Enercore AI", exact: true })).toBeInViewport();
      await page.waitForTimeout(350);
      if (route === "prospecting") {
        for (const button of await page.getByRole("button").filter({ hasText: /companies in Vietnam|manufacturers in Kenya/ }).all()) {
          expect.soft(await button.evaluate(e => e.scrollWidth <= e.clientWidth + 1), `Example text fits its button at ${width}`).toBe(true);
        }
      }
      if (route === "collaboration") await expect(page.getByText("Thanks. Let us review it at the planning meeting tomorrow.", { exact: true })).toBeVisible();
      if (route === "marketing" && width === 390) {
        const company = await page.getByRole("combobox", { name: "Content company", exact: true }).boundingBox();
        expect(company?.width).toBeGreaterThan(280);
      }
      if (route === "overview") {
        await page.screenshot({ path: `test-results/v2-dashboard-${width}.png`, animations: "disabled" });
        const analysis = page.locator(".dash-analysis");
        if (await analysis.getAttribute("open") === null) await analysis.locator("summary").click();
        await expect(analysis).toHaveAttribute("open", "");
        await expect(page.locator(".bar-chart")).toHaveCount(0);
        await expect(page.locator(".insights-heading")).toBeVisible();
        await page.locator(".insights-heading").evaluate(e => e.scrollIntoView({ block: "start" }));
      }
      if (route === "customers") {
        await page.locator(".record-link").filter({ hasText: "Northern Coast Industrial" }).click();
        await expect(page.locator(".rw-commercial")).toBeVisible();
        await expect(page.locator(".commercial-skeleton")).toHaveCount(0);
      }
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth), `${route} at ${width}`).toBeLessThanOrEqual(width + 1);
      await page.screenshot({ path: `test-results/v2-${route}-${width}.png`, animations: "disabled" });
      if (width === 1440) {
        await page.evaluate(() => document.documentElement.dataset.theme = "dark");
        await page.screenshot({ path: `test-results/v2-${route}-dark.png`, animations: "disabled" });
        await page.evaluate(() => document.documentElement.dataset.theme = "light");
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/workspace/all-companies/sales-pipeline");
  await page.getByRole("button", { name: "New lead", exact: true }).click();
  const title = `Local dropdown review ${Date.now()}`;
  const choice = `Design Source ${Date.now()}`;
  await page.getByRole("textbox", { name: "Customer / company", exact: true }).fill(title);
  await page.getByText("More details & notes", { exact: false }).click();
  await page.getByRole("button", { name: "Manage lead source choices", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Lead source choices", exact: true });
  await dialog.getByLabel("New choice", { exact: true }).fill(choice.toLowerCase());
  await dialog.getByRole("button", { name: "Add choice", exact: true }).click();
  await expect(dialog.getByRole("button", { name: `Edit ${choice}`, exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: `Edit ${choice}`, exact: true }).click();
  await dialog.getByLabel("Rename choice", { exact: true }).fill(`${choice} Updated`);
  await dialog.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(dialog.getByRole("button", { name: `Edit ${choice} Updated`, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeInViewport();
  expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: "test-results/v2-shared-choices-phone.png", animations: "disabled" });
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  const source = page.getByRole("combobox", { name: "Lead source", exact: true });
  await source.click();
  await page.getByRole("option", { name: `${choice} Updated`, exact: true }).click();
  await expect(source).toContainText(`${choice} Updated`);
  const [saved] = await Promise.all([page.waitForResponse(r => r.url().endsWith("/api/records") && r.request().method() === "POST"), page.getByRole("button", { name: "Create lead", exact: true }).click()]);
  expect(saved.status(), await saved.text()).toBe(201);
  const record = (await saved.json()).record;
  expect(record.source).toBe(`${choice} Updated`);
  const scope = { company: "Petronik", catalog: "leads:source" };
  const options = await actor.request("GET", `/api/shared-options?${new URLSearchParams(scope)}`);
  const option = options.body.options.find((r: {label:string}) => r.label === `${choice} Updated`);
  expect(option).toBeTruthy();
  await actor.request("DELETE", "/api/shared-options", { ...scope, id: option.id, version: option.version });
  await actor.request("PATCH", "/api/records", { action: "delete", id: record.id, expectedUpdatedAt: record.updatedAt });
  expect(errors).toEqual([]);
  await context.close();
});
