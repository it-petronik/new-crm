import { test, expect } from "@playwright/test";
import { Client } from "./client";
import { WORKER } from "./people";
import { lastCallId, callsSince } from "./ai-helpers";
const command = (c: Client, body: unknown) =>
  c.request("POST", "/api/commercial", body);
async function create(
  c: Client,
  kind: string,
  title: string,
  extra: Record<string, unknown> = {},
) {
  const r = await c.request("POST", "/api/records", {
    kind,
    title,
    company: "Petronik",
    branch: "Main",
    contact: "",
    product: "",
    quantity: 0,
    unit: "MT",
    amount: 0,
    currency: "USD",
    due: "2026-12-01",
    detail: "",
    source: "Phase 6 fixture",
    ...extra,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.record;
}
let mdSession: Promise<Client> | undefined;
let sellerSession: Promise<Client> | undefined;
async function fixtures() {
  const md = await (mdSession ??= Client.login("cmmd"));
  const seller = await (sellerSession ??= Client.login("cmsales"));
  const tag = `Commercial ${crypto.randomUUID().slice(0, 8)}`;
  const a = await create(md, "customers", `International Petrochemical Manufacturing & Distribution Company LLC ${tag}`);
  const b = await create(md, "customers", a.title);
  const product = await create(md, "products", `${tag} SN500`);
  const supplier = await create(md, "suppliers", `${tag} Supplier`);
  const lead = await create(seller, "leads", a.title, {
    customerId: a.id,
    productId: product.id,
  });
  return { md, seller, a, b, product, supplier, lead, tag };
}
test("stable customer identity, contact ownership, aggregate scope and server display normalization", async () => {
  const f = await fixtures();
  const contact = await command(f.md, {
    action: "contact",
    parentId: f.a.id,
    details: { name: "Buyer" },
  });
  expect(contact.status).toBe(200);
  const manipulated = await command(f.seller, {
    action: "links",
    id: f.lead.id,
    expectedUpdatedAt: f.lead.updatedAt,
    customerId: f.b.id,
    contactId: contact.body.id,
    confirmReassignment: true,
  });
  expect(manipulated.status).toBe(400);
  const ca = await f.seller.request("GET", `/api/commercial?id=${f.a.id}`);
  const cb = await f.seller.request("GET", `/api/commercial?id=${f.b.id}`);
  expect(ca.body.linked.map((r: any) => r.id)).toEqual([f.lead.id]);
  expect(cb.body.linked).toEqual([]);
  for (const key of ["cmother", "cmhr", "cmit", "cmbranch"]) {
    const c = await Client.login(key);
    expect(
      (await c.request("GET", `/api/commercial?id=${f.a.id}`)).status,
    ).toBe(404);
  }
  const normalized = await create(f.seller, "leads", "Wrong display name", {
    customerId: f.a.id,
  });
  expect(normalized.title).toBe(f.a.title);
});
test("parallel Deal requests and quick-create retries create one identity", async () => {
  const f = await fixtures();
  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      command(f.seller, { action: "deal", leadId: f.lead.id }),
    ),
  );
  expect(responses.map((r) => r.status)).toEqual(Array(10).fill(200));
  expect(new Set(responses.map((r) => r.body.deal.id)).size).toBe(1);
  const other = await Client.login("cmsales2");
  expect(
    (
      await other.request(
        "GET",
        `/api/commercial?view=deal&id=${responses[0].body.deal.id}`,
      )
    ).status,
  ).toBe(404);
  const input = {
    action: "customer",
    company: "Petronik",
    branch: "Main",
    title: `Retry ${crypto.randomUUID()}`,
    contactName: "Buyer",
    requestId: crypto.randomUUID(),
  };
  const customers = await Promise.all([
    command(f.md, input),
    command(f.md, input),
  ]);
  expect(customers.map((r) => r.status)).toEqual([200, 200]);
  expect(customers[0].body.record.id).toBe(customers[1].body.record.id);
});
test("supplier capabilities are permission filtered and never price or availability offers", async () => {
  const f = await fixtures();
  const active = await command(f.md, {
    action: "capability",
    supplierId: f.supplier.id,
    productId: f.product.id,
    details: { originCountry: "UAE" },
  });
  expect(active.status).toBe(200);
  expect(
    (
      await command(f.md, {
        action: "capability",
        supplierId: f.supplier.id,
        productId: f.product.id,
        details: { currentPrice: 100 },
      })
    ).status,
  ).toBe(400);
  expect(
    (await f.md.request("GET", `/api/commercial?id=${f.lead.id}`)).body
      .capabilities,
  ).toHaveLength(1);
  expect(
    (await f.seller.request("GET", `/api/commercial?id=${f.lead.id}`)).body
      .capabilities,
  ).toHaveLength(0);
  expect(
    (
      await command(f.md, {
        action: "capability",
        supplierId: f.supplier.id,
        productId: f.product.id,
        id: active.body.id,
        version: 1,
        details: { active: false },
      })
    ).status,
  ).toBe(200);
  expect(
    (await f.md.request("GET", `/api/commercial?id=${f.lead.id}`)).body
      .capabilities,
  ).toHaveLength(0);
});
test("explicit Deal AI reuses authorized context; opening commercial views spends no AI", async () => {
  const f = await fixtures();
  const d = await command(f.seller, { action: "deal", leadId: f.lead.id });
  const before = lastCallId();
  for (const id of [f.a.id, f.b.id, f.product.id, f.supplier.id])
    expect((await f.md.request("GET", `/api/commercial?id=${id}`)).status).toBe(
      200,
    );
  expect(callsSince(before, f.tag)).toHaveLength(0);
  const brief = await f.seller.request("POST", "/api/ai/deal", {
    id: d.body.deal.id,
  });
  expect(brief.status, JSON.stringify(brief.body)).toBe(200);
  expect(callsSince(before, f.tag)).toHaveLength(1);
  const second = await f.seller.request("POST", "/api/ai/deal", {
    id: d.body.deal.id,
  });
  expect(second.status).toBe(200);
  expect(callsSince(before, f.tag)).toHaveLength(1);
});
for (const [width, height] of [
  [320, 568],
  [360, 800],
  [390, 844],
  [430, 932],
  [768, 1024],
  [820, 1180],
  [1024, 768],
  [1280, 800],
  [1440, 900],
])
  test(`commercial views and contact editor fit ${width}×${height}`, async ({
    browser,
  }) => {
    const f = await fixtures();
    const nextLead = await create(f.seller, "leads", `${f.tag} Next requirement`, { customerId: f.b.id });
    await command(f.md, {
      action: "contact",
      parentId: f.a.id,
      details: { name: "Alexandra Catherine Montgomery-Wellington", email: "alexandra.catherine.international.procurement.department@example.test" },
    });
    const context = await browser.newContext({ viewport: { width, height } });
    await f.md.signInBrowser(context);
    const page = await context.newPage();
    const aiCalls: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/api/ai/"))
        aiCalls.push(r.url());
    });
    await page.goto(`${WORKER}/workspace/all-companies/overview`);
    if (width === 320) await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await expect(
      page.getByRole("button", { name: "Quick actions" }),
    ).toBeVisible();
    if (width === 1440) {
      await page.goto(`${WORKER}/workspace/all-companies/customers`);
      await page.getByPlaceholder(/^Search records/).fill(f.tag);
      await expect(page.locator(".collection-card")).toHaveCount(2);
      await expect(page.locator(".collection-card").filter({ hasText: f.a.id.slice(-8) })).toHaveCount(1);
      await expect(page.locator(".collection-card").filter({ hasText: f.b.id.slice(-8) })).toHaveCount(1);
    }
    for (const [record, label] of [
      [f.a, "Customer 360"],
      [f.supplier, "Supplier 360"],
      [f.product, "Product activity within Enercore"],
      [f.lead, "Commercial relationships"],
    ] as const) {
      await page.evaluate(
        (r) =>
          window.dispatchEvent(
            new CustomEvent("enercore:open-record", {
              detail: { id: r.id, kind: r.kind },
            }),
          ),
        record,
      );
      const panel = page.getByRole("region", { name: label, exact: true });
      await expect(panel).toBeVisible();
      await expect(
        panel.getByRole("status", { name: "Loading commercial relationships" }),
      ).toHaveCount(0);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      expect(overflow).toBe(false);
      const clippedActions = await page.locator(".record-detail-dialog .ui-dialog-actions-end").evaluate(el => {
        const frame = el.getBoundingClientRect();
        return [...el.querySelectorAll("button")].some(button => {
          const bounds = button.getBoundingClientRect();
          return bounds.left < frame.left - 1 || bounds.right > frame.right + 1 || button.scrollWidth > button.clientWidth + 1;
        });
      });
      expect(clippedActions, "record actions must remain fully visible").toBe(false);
      const clippedStatus = await page.locator(".record-detail-dialog .ui-inline-field").evaluate(el => el.scrollWidth > el.clientWidth + 1);
      expect(clippedStatus, "status selector must fit the narrow footer").toBe(false);
      if (record.kind !== "leads") await expect(panel.getByRole("button", { name: "Review relationships", exact: true })).toHaveCount(0);
      if (record.kind === "products") await expect(panel.getByRole("heading", { name: "Contacts", exact: true })).toHaveCount(0);
      if (record === f.a) {
        await panel
          .getByRole("button", { name: "Add contact", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "Add contact",
          exact: true,
        });
        await expect(dialog).toBeVisible();
        await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Keyboard buyer");
        await dialog.getByRole("button", { name: "Save contact" }).click();
        await expect(dialog).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Add contact", exact: true })).toBeFocused();
        await expect(
          panel.getByText("Keyboard buyer", { exact: true }),
        ).toBeVisible();
        if (width === 390) await page.screenshot({ path: "work/commercial-customer-mobile.png", fullPage: false });
      }
      if (record === f.lead) {
        await panel.getByRole("button", { name: "Review relationships", exact: true }).click();
        const relationships = page.getByRole("dialog", { name: "Review relationships", exact: true });
        await expect(relationships).toContainText(`Selected customer: ${f.a.title}`);
        await expect(relationships).toContainText(`Selected product: ${f.product.title}`);
        await expect(relationships.getByRole("button", { name: "Save links", exact: true })).toHaveClass(/ui-primary-action/);
        await relationships.getByRole("textbox", { name: "Search customer", exact: true }).fill(f.tag);
        await relationships.locator(".commercial-results button", { hasText: f.b.id.slice(-8) }).click();
        await expect(relationships.getByRole("button", { name: "Save links", exact: true })).toBeDisabled();
        await expect(relationships.getByRole("combobox", { name: "Contact", exact: true })).toContainText("No contact selected");
        await relationships.getByRole("checkbox", { name: "Confirm changing customer and clearing the old contact" }).check();
        await expect(relationships.getByRole("button", { name: "Save links", exact: true })).toBeEnabled();
        await page.keyboard.press("Escape");
        await expect(relationships).toHaveCount(0);
        await panel
          .getByRole("button", { name: "Open Deal Room", exact: true })
          .click();
        await expect(
          page.getByRole("region", { name: "Deal Room", exact: true }),
        ).toBeVisible();
        if (width === 390) await page.screenshot({ path: "work/commercial-deal-mobile.png", fullPage: false });
        await expect(page.getByRole("region", { name: "Deal Room", exact: true }).getByRole("button", { name: "Open Deal Room", exact: true })).toHaveCount(0);
        // Moving directly between records resets the former Deal's UI state.
        await page.evaluate(r => window.dispatchEvent(new CustomEvent("enercore:open-record", { detail: { id: r.id, kind: r.kind } })), nextLead);
        await expect(page.getByRole("region", { name: "Commercial relationships", exact: true })).toBeVisible();
        await expect(page.getByRole("region", { name: "Deal Room", exact: true })).toHaveCount(0);
      }
      await page.keyboard.press("Escape");
    }
    expect(aiCalls).toEqual([]);
    await context.close();
  });
