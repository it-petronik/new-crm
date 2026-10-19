import { test, expect, type Page } from "@playwright/test";
import { Client } from "./client";
const route = "/workspace/petronik/operations";
const sessions = new Map<string, Promise<Client>>();
const login = (key: string) => {
  if (!sessions.has(key)) sessions.set(key, Client.login(key));
  return sessions.get(key)!;
};
async function select(page: Page, label: string, option: RegExp) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option }).click();
}
test("purchase approval, partial receipt, dispatch, invoice and payment persist through the UI", async ({
  browser,
}) => {
  const buyer = await login("cmmd"),
    manager = await login("studio");
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  await buyer.signInBrowser(context);
  const page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(route);
  await expect(
    page.getByRole("heading", { name: "Operations", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New purchase order" }).click();
  await select(page, "Sales order", /Fictional Coastal Operations Order/);
  await select(page, "Supplier", /Fictional Gulf Supply/);
  await select(page, "Product", /Fictional SN500 Operations/);
  const warehouse = `Review warehouse ${Date.now()}`;
  await page
    .getByRole("textbox", { name: "Warehouse", exact: true })
    .fill(warehouse);
  await page.getByRole("textbox", { name: "Quantity", exact: true }).fill("10");
  await page
    .getByRole("textbox", { name: "Unit price", exact: true })
    .fill("100");
  await page.getByRole("button", { name: "Confirm and save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let row = page.getByRole("listitem").filter({ hasText: warehouse }).first();
  await expect(row).toContainText("Another manager must approve");
  await expect(
    row.getByRole("button", { name: "Approve", exact: true }),
  ).toHaveCount(0);
  const purchase = (
    await buyer.request("GET", "/api/operations?company=Petronik")
  ).body.purchases.find((p: any) => p.warehouse === warehouse);
  expect(purchase).toBeTruthy();
  await context.close();

  const approved = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  await manager.signInBrowser(approved);
  const app = await approved.newPage();
  app.on("pageerror", (e) => errors.push(e.message));
  await app.goto(route);
  row = app.getByRole("listitem").filter({ hasText: warehouse }).first();
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  await app.getByRole("button", { name: "Confirm and save" }).click();
  await expect(row).toContainText("Approved");
  await row.getByRole("button", { name: "Receive stock", exact: true }).click();
  await app
    .getByRole("textbox", { name: "Quantity (MT)", exact: true })
    .fill("6");
  await app
    .getByRole("textbox", { name: "Reference", exact: true })
    .fill("GRN browser review");
  await app.getByRole("button", { name: "Confirm and save" }).click();
  await expect(row).toContainText("6 received");
  await row.getByRole("button", { name: "Dispatch", exact: true }).click();
  await app
    .getByRole("textbox", { name: "Quantity (MT)", exact: true })
    .fill("2");
  await select(app, "Shipment", /Fictional Coastal Shipment/);
  await app
    .getByRole("textbox", { name: "Reference", exact: true })
    .fill("DN browser review");
  await app.getByRole("button", { name: "Confirm and save" }).click();
  await expect(row).toContainText("4 on hand");
  await row.getByRole("button", { name: "Add invoice", exact: true }).click();
  const reference = `INV browser ${Date.now()}`;
  await app
    .getByRole("textbox", { name: "Amount (USD)", exact: true })
    .fill("400");
  await app
    .getByRole("textbox", { name: "Supplier invoice number", exact: true })
    .fill(reference);
  await app.getByRole("button", { name: "Confirm and save" }).click();
  await expect(app.getByRole("dialog")).toHaveCount(0);
  await app
    .getByRole("tab", { name: "Supplier invoices", exact: true })
    .click();
  const bill = app.getByRole("listitem").filter({ hasText: reference });
  await expect(bill).toContainText("$400.00 remaining");
  await bill.getByRole("button", { name: "Record payment" }).click();
  await app
    .getByRole("textbox", { name: "Amount (USD)", exact: true })
    .fill("150");
  await app
    .getByRole("textbox", { name: "Reference", exact: true })
    .fill("BANK browser review");
  await app.getByRole("button", { name: "Confirm and save" }).click();
  await expect(bill).toContainText("$250.00 remaining");
  await app.reload();
  await app
    .getByRole("tab", { name: "Supplier invoices", exact: true })
    .click();
  await expect(bill).toContainText("Partially paid");
  const response = await manager.request(
    "GET",
    "/api/operations?company=Petronik",
  );
  expect(response.status).toBe(200);
  expect(
    response.body.purchases.find((p: any) => p.id === purchase.id).balance,
  ).toBe(4e6);
  expect(
    response.body.history.some(
      (h: any) => h.action === "Recorded supplier payment",
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await approved.close();
});
test("populated operations views fit desktop, tablet and phone in both themes", async ({
  browser,
}) => {
  const manager = await login("studio"),
    context = await browser.newContext();
  await manager.signInBrowser(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(route);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
      }, theme);
      for (const name of [
        "Purchase orders",
        "Inventory",
        "Supplier invoices",
        "Deliveries",
      ]) {
        await page.getByRole("tab", { name, exact: true }).click();
        await expect(page.getByRole("listitem").first()).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `test-results/operations-${width}-${theme}-${name.replaceAll(" ", "-")}.png`,
          animations: "disabled",
        });
      }
    }
    await page.getByRole("button", { name: "New purchase order" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Confirm and save" }),
    ).toBeInViewport();
    expect(
      await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/operations-create-${width}.png`,
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  expect(errors).toEqual([]);
  await context.close();
});
test("operations API rejects anonymous, cross-company, unauthorized and bad-origin requests", async () => {
  const manager = await login("studio"),
    sales = await login("cmsales"),
    other = await login("cmother");
  expect(
    (
      await manager.request("GET", "/api/operations", undefined, {
        cookie: null,
      })
    ).status,
  ).toBe(401);
  expect((await sales.request("GET", "/api/operations")).status).toBe(403);
  const p = (await manager.request("GET", "/api/operations?company=Petronik"))
    .body.purchases[0];
  expect(
    (
      await other.request("POST", "/api/operations", {
        action: "status",
        id: p.id,
        version: p.version,
        status: "Cancelled",
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await manager.request(
        "POST",
        "/api/operations",
        {},
        { origin: "https://attacker.invalid" },
      )
    ).status,
  ).toBe(403);
});
