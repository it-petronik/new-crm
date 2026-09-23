import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const signIn = async (page: Page, who: string) => {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(`${who}@enercore.test`) }).click();
  await page.getByRole("heading", { level: 1 }).first().waitFor();
};

// A small generated PNG keeps the test independent of any checked-in asset.
const sample = join(mkdtempSync(join(tmpdir(), "avatar-")), "sample.png");
test.beforeAll(() => {
  execSync(
    `python3 -c "import zlib,struct,sys;w,h=600,400;rows=b''.join(b'\\x00'+bytes([(x*255)//w,(y*255)//h,128][c] for x in range(w) for c in range(3)) for y in range(h));ck=lambda t,d:struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff);open('${sample}','wb').write(b'\\x89PNG\\r\\n\\x1a\\n'+ck(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+ck(b'IDAT',zlib.compress(rows))+ck(b'IEND',b''))"`,
  );
});

test("each role gets a dashboard built from its own modules", async ({ page }) => {
  const cards = async () => {
    await page.locator(".stats-grid .stat-card").first().waitFor();
    return (await page.locator(".stats-grid .stat-card").allInnerTexts()).map((t) => t.split("\n")[0]);
  };

  await signIn(page, "hr");
  expect(await cards()).toEqual(["People", "Leave requests"]);
  await signIn(page, "it");
  expect(await cards()).toEqual(["Open tickets", "Resolved tickets"]);
  await signIn(page, "logistics");
  expect(await cards()).toContain("Active shipments");
  await signIn(page, "md");
  // The MD keeps the commercial dashboard rather than a narrow role's cards.
  expect(await cards()).toEqual([
    "Open pipeline", "Confirmed orders", "Active shipments", "Invoices awaiting payment",
  ]);
});

test("a role's dashboard fills its row instead of leaving another role's gaps", async ({ page }) => {
  await signIn(page, "hr");
  await page.locator(".stats-grid .stat-card").first().waitFor();
  const grid = page.locator(".stats-grid");
  const gridBox = (await grid.boundingBox())!;
  const cardBoxes = await grid.locator(".stat-card").evaluateAll((nodes) =>
    nodes.map((n) => n.getBoundingClientRect().right),
  );
  // The last card reaches the right edge of the grid, so no column is orphaned.
  expect(Math.abs(Math.max(...cardBoxes) - (gridBox.x + gridBox.width))).toBeLessThan(2);

  // A single remaining panel also takes the full width.
  const lower = page.locator(".overview-grid");
  const lowerBox = (await lower.boundingBox())!;
  const panel = (await lower.locator("> .panel").first().boundingBox())!;
  expect(Math.abs(panel.width - lowerBox.width)).toBeLessThan(2);
});

test("records and people carry initials avatars", async ({ page }) => {
  await signIn(page, "md");
  await page.goto("/workspace/all-companies/sales-orders");
  await page.locator(".records-panel .table-scroll").waitFor();
  const first = page.locator(".records-panel tbody tr").first();
  // "Coastal Energy Partners" becomes first + last initial.
  await expect(first.locator("td").first().locator(".entity-avatar")).toHaveText("CP");
  // The Created by column carries the owner's avatar too.
  const createdBy = page.getByRole("columnheader", { name: /Created by/ });
  const index = await createdBy.evaluate((th) => [...th.parentElement!.children].indexOf(th));
  await expect(first.locator("td").nth(index).locator(".entity-avatar")).toHaveText("LA");
  await expect(first.locator(".cell-date")).toBeVisible();

  await page.goto("/workspace/all-companies/activity");
  await page.locator(".table-scroll").waitFor();
  await expect(page.locator("tbody td").first().locator(".entity-avatar")).toHaveText("LA");

  await page.goto("/workspace/all-companies/access-control");
  await expect(page.locator("tbody .entity-avatar").first()).toBeVisible();
  // The avatar must not change the accessible name of the person's link.
  await expect(page.getByRole("button", { name: "Leila Ahmed", exact: true })).toBeVisible();
});

test("a profile picture can be cropped, saved, removed and shared across the app", async ({ page }) => {
  await signIn(page, "md");
  await page.goto("/workspace/all-companies/profile");
  await page.locator(".avatar-editor").waitFor();
  await expect(page.locator(".avatar-editor .entity-avatar")).toHaveText("AM");

  await page.setInputFiles('input[type="file"]', sample);
  await page.locator(".crop-viewport img").waitFor();
  await page.getByRole("slider", { name: "Zoom picture" }).fill("1.8");
  await page.getByRole("button", { name: "Save picture" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  const saved = await page.locator(".avatar-editor .entity-avatar img").getAttribute("src");
  expect(saved).toMatch(/^data:image\/jpeg/);
  // The same picture is used by the sidebar and survives a reload.
  await expect(page.locator(".sidebar .entity-avatar img")).toBeVisible();
  await page.reload();
  await expect(page.locator(".avatar-editor .entity-avatar img")).toBeVisible();

  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.locator(".avatar-editor .entity-avatar img")).toHaveCount(0);
  await expect(page.locator(".avatar-editor .entity-avatar")).toHaveText("AM");
});

test("a list with no records at all offers nothing to filter", async ({ page }) => {
  await signIn(page, "md");
  await page.goto("/workspace/all-companies/accounts");
  const cashbook = page.locator(".cashbook-panel");
  await cashbook.waitFor();
  // The cashbook starts empty, so a search box over it would be pointless.
  await expect(cashbook).toContainText("No USD entries yet");
  await expect(cashbook.getByRole("textbox", { name: /Search entries/ })).toHaveCount(0);
  await expect(cashbook.getByRole("button", { name: /^Filters/ })).toHaveCount(0);
  // A list that does have records still offers its controls.
  await expect(page.locator(".records-panel").getByRole("button", { name: /^Filters/ })).toBeVisible();
});

test("record cards show one identity row, not a separate glyph row", async ({ page }) => {
  await signIn(page, "md");
  await page.goto("/workspace/all-companies/customers");
  await page.locator(".record-grid").waitFor();
  const card = page.locator(".record-card-shell").first();
  // The module glyph row was redundant once the avatar carried identity.
  await expect(card.locator(".collection-icon")).toHaveCount(0);
  const identity = card.locator(".collection-identity");
  await expect(identity.locator(".entity-avatar")).toBeVisible();
  await expect(identity.locator(".badge")).toBeVisible();
  // Avatar, name and status share one line.
  const rows = await identity.evaluate((el) => {
    const tops = [...el.children].map((c) => Math.round(c.getBoundingClientRect().top));
    return new Set(tops).size;
  });
  expect(rows).toBe(1);
});
