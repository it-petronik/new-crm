/** Authenticated acceptance against isolated fictional Worker on port 8789.
 * Does not target production or the user's saved local workspace. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { PETRONIK_SEAL } from "../src/lib/pdf/document-seal";
import type { RecordItem } from "../src/lib/domain";
const base = "http://127.0.0.1:8789",
  origin = "http://localhost:8788";
async function request(cookie: string, path: string, body?: unknown) {
  return fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function login(who: string) {
  const response = await request("", "/api/auth", {
    email: `${who}@collab.test`,
    password: "Collab-Test-Password-1",
  });
  assert.equal(response.status, 200, `Fictional ${who} login`);
  return response.headers.get("set-cookie")!.split(";")[0];
}
async function create(cookie: string, body: unknown) {
  const response = await request(cookie, "/api/records", body),
    data = (await response.json()) as { record: RecordItem; error?: string };
  assert.equal(response.status, 201, data.error);
  return data.record;
}
async function main() {
  const md = await login("cmmd"),
    accounts = await login("release9"),
    sales = await login("cmsales"),
    hr = await login("release10"),
    other = await login("aiacc");
  const common = {
    company: "Petronik",
    branch: "Main",
    title: `Fictional Signature QA ${crypto.randomUUID().slice(0, 8)}`,
    contact: "Review Contact",
    product: "Review Item",
    quantity: 1,
    unit: "kg",
    amount: 1,
    currency: "USD",
    due: "2026-10-22",
    detail: "Fictional signature review only",
    source: "Local signature review",
  };
  const customer = await create(md, {
    ...common,
    kind: "customers",
    requestId: `seal-customer-${crypto.randomUUID()}`,
  });
  const attributes = {
    issuedDate: "2026-10-20",
    senderName: "PETRONIK FZCO",
    senderAddress: "Fictional Issuer Address",
    customerAddress: "Fictional Customer Address",
  };
  const lines = [
    { description: "Fictional Review Item", quantity: 1, unitPriceCents: 100 },
  ];
  const quote = await create(md, {
    ...common,
    kind: "quotations",
    customerId: customer.id,
    lines,
    attributes,
    requestId: `seal-quote-${crypto.randomUUID()}`,
  });
  const proforma = await create(accounts, {
    ...common,
    kind: "accounts",
    customerId: customer.id,
    lines,
    attributes: { ...attributes, documentType: "proforma" },
    requestId: `seal-proforma-${crypto.randomUUID()}`,
  });
  const url = (id: string) =>
    `/api/document-seals?recordId=${encodeURIComponent(id)}&version=${PETRONIK_SEAL.id}`;
  assert.equal((await request("", url(quote.id))).status, 401);
  assert.equal((await request(other, url(quote.id))).status, 404);
  assert.equal((await request(hr, url(quote.id))).status, 404);
  assert.equal((await request(sales, url(proforma.id))).status, 404);
  assert.equal((await request(accounts, url(quote.id))).status, 404);
  assert.equal((await request(md, url(customer.id))).status, 404);
  assert.equal((await request(md, url("does-not-exist"))).status, 404);
  assert.equal(
    (
      await request(
        md,
        url(quote.id).replace(PETRONIK_SEAL.id, "unapproved-version"),
      )
    ).status,
    404,
  );
  for (const [cookie, record] of [
    [md, quote],
    [accounts, proforma],
  ] as const) {
    const response = await request(cookie, url(record.id));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /private, no-store/);
    assert.match(response.headers.get("content-type")!, /image\/svg\+xml/);
    const svg = await response.text();
    const images = [
      ...svg.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g),
    ].map((match) =>
      createHash("sha256")
        .update(Buffer.from(match[1], "base64"))
        .digest("hex"),
    );
    assert.deepEqual(images, [
      PETRONIK_SEAL.signatureSha256,
      PETRONIK_SEAL.stampSha256,
    ]);
    assert.ok(!svg.includes("<script"));
    const loaded = (await (
      await request(cookie, `/api/records?id=${encodeURIComponent(record.id)}`)
    ).json()) as { record: RecordItem };
    assert.deepEqual(
      loaded.record,
      record,
      "Reading the seal must not issue, edit or approve the document",
    );
  }
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    headless: true,
  });
  try {
    for (const [cookie, record, kind] of [
      [md, quote, "quotation"],
      [accounts, proforma, "proforma"],
    ] as const) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      await context.addCookies([
        {
          name: "enercore_session",
          value: cookie.slice(cookie.indexOf("=") + 1),
          url: base,
          httpOnly: true,
          sameSite: "Lax",
          secure: false,
        },
      ]);
      const page = await context.newPage();
      await page.goto(
        `${base}/workspace/petronik/${record.kind}?record=${encodeURIComponent(record.id)}`,
      );
      await page
        .getByRole("button", { name: "View document", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      const seal = dialog.getByRole("img", {
        name: "Approved Petronik signature and company stamp",
      });
      await seal.waitFor({ state: "visible" });
      await seal.evaluate((image: HTMLImageElement) => image.decode());
      assert.ok(
        await seal.evaluate(
          (image: HTMLImageElement) => image.naturalWidth > 0,
        ),
      );
      await page.evaluate(() => {
        (window as unknown as { printCalls: number }).printCalls = 0;
        window.print = () => {
          (window as unknown as { printCalls: number }).printCalls++;
        };
      });
      await dialog
        .getByRole("button", { name: "Print / Save PDF", exact: true })
        .click();
      await page.waitForFunction(
        () => (window as unknown as { printCalls: number }).printCalls === 1,
      );
      await page.emulateMedia({ media: "print" });
      await page.pdf({
        path: `test-results-seals/authenticated-${kind}.pdf`,
        preferCSSPageSize: true,
        printBackground: true,
      });
      if (kind === "quotation") {
        await page.emulateMedia({ media: "screen" });
        await page.route("**/api/document-seals**", (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Local missing-asset test" }),
          }),
        );
        await page.reload();
        await page
          .getByRole("button", { name: "View document", exact: true })
          .click();
        const failedDialog = page.getByRole("dialog");
        await failedDialog
          .locator(".pdf-seal-error")
          .waitFor({ state: "visible" });
        await page.evaluate(() => {
          (window as unknown as { printCalls: number }).printCalls = 0;
          window.print = () => {
            (window as unknown as { printCalls: number }).printCalls++;
          };
        });
        await failedDialog
          .getByRole("button", { name: "Print / Save PDF", exact: true })
          .click();
        await page.waitForFunction(() =>
          [...document.querySelectorAll('[role="alert"]')].some((el) =>
            el.textContent?.includes("could not be loaded"),
          ),
        );
        assert.equal(
          await page.evaluate(
            () => (window as unknown as { printCalls: number }).printCalls,
          ),
          0,
          "Missing approved seal must block printing, never silently omit it",
        );
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(
    "PASS: private seal API permissions, original-image hashes, immutable document state and authenticated quotation/proforma preview-and-print flow.",
  );
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
