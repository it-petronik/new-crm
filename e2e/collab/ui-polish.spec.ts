import { test, expect, type Page, type Browser } from "@playwright/test";
import { Client } from "./client";

/**
 * Production-QA polish that needs the live Worker: the executive dashboard's
 * empty Needs attention panel and its skeleton geometry, the Collaboration
 * filter strip, message actions on a phone, and long room names.
 * People: admin (dashboard, read-only), q1–q3 (exclusive to this file).
 */

const HUB = "/workspace/all-companies/collaboration";

async function signedIn(browser: Browser, key: string, viewport = { width: 1440, height: 900 }) {
  const client = await Client.login(key);
  const context = await browser.newContext({ viewport });
  await client.signInBrowser(context);
  return { client, context, page: await context.newPage() };
}

/** Each column of the executive grid: left edge and width. */
const columns = (page: Page) =>
  page.locator(".e-exec-grid").first().evaluate((grid) =>
    [...grid.children].map((c) => {
      const r = c.getBoundingClientRect();
      return { left: Math.round(r.left), width: Math.round(r.width) };
    }),
  );

test("dashboard: an empty Needs attention keeps the grid, and the skeleton has the same geometry", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "admin");
  // Hold the records response so the skeleton can be measured.
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/records*", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/");
  await expect(page.locator(".skeleton-region")).toBeVisible();
  const skeleton = await columns(page);
  expect(skeleton).toHaveLength(2);
  release();

  // No business records in the admin's companies here: the all-clear.
  const panel = page.locator(".attention-clear");
  await expect(panel).toContainText("Needs attention");
  await expect(panel).toContainText("Nothing needs your attention right now.");
  const loaded = await columns(page);
  expect(loaded).toHaveLength(2);
  // Attention stays in the first (wider) column, Pipeline health beside it…
  expect(loaded[0].left).toBeLessThan(loaded[1].left);
  expect(loaded[0].width).toBeGreaterThan(loaded[1].width);
  await expect(page.locator(".e-exec-grid").first().locator(":scope > :nth-child(2)")).toContainText("Pipeline health");
  // …exactly where the skeleton drew them.
  for (const i of [0, 1]) {
    expect(Math.abs(loaded[i].left - skeleton[i].left)).toBeLessThanOrEqual(1);
    expect(Math.abs(loaded[i].width - skeleton[i].width)).toBeLessThanOrEqual(1);
  }
  await context.close();
});

/** Every tab is either fully clear or has a fade over the edge it crosses. */
async function tabsHonest(page: Page) {
  return page.locator(".collab-filters").evaluate((strip) => {
    const s = strip.getBoundingClientRect();
    const fadeStart = strip.getAttribute("data-fade-start") === "true";
    const fadeEnd = strip.getAttribute("data-fade-end") === "true";
    const problems: string[] = [];
    for (const tab of strip.querySelectorAll("button")) {
      const r = tab.getBoundingClientRect();
      if (r.right > s.right + 0.5 && !fadeEnd) problems.push(`${tab.textContent} cut at the right with no fade`);
      if (r.left < s.left - 0.5 && !fadeStart) problems.push(`${tab.textContent} cut at the left with no fade`);
    }
    return { problems, overflows: strip.scrollWidth > strip.clientWidth + 1, fadeStart, fadeEnd };
  });
}

test("Collaboration filter tabs: overflow is always signalled, and a chosen tab comes fully into view", async ({ browser }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    const { page, context } = await signedIn(browser, "q1", viewport);
    await page.goto(HUB);
    const strip = page.locator(".collab-filters");
    await expect(strip.getByRole("tab", { name: "All chats" })).toBeVisible();
    const start = await tabsHonest(page);
    expect(start.problems, `${viewport.width}`).toEqual([]);
    expect(start.fadeEnd).toBe(start.overflows);
    expect(start.fadeStart).toBe(false);

    for (const name of ["Mentions", "Unread", "All chats"]) {
      const tab = strip.getByRole("tab", { name: new RegExp(`^${name}`) });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect
        .poll(() =>
          tab.evaluate((t) => {
            const s = t.parentElement!;
            const box = s.getBoundingClientRect();
            const r = t.getBoundingClientRect();
            // Clear of any fade on either side.
            const left = box.left + (s.dataset.fadeStart === "true" ? 28 : 0);
            const right = box.right - (s.dataset.fadeEnd === "true" ? 28 : 0);
            return r.left >= left - 1 && r.right <= right + 1;
          }),
        )
        .toBe(true);
      expect((await tabsHonest(page)).problems, `${viewport.width} ${name}`).toEqual([]);
    }
    await context.close();
  }
});

test("at phone width, message actions sit under the message, never over the author, time or text", async ({ browser }) => {
  const { client, page, context } = await signedIn(browser, "q2", { width: 390, height: 844 });
  const room = await client.createRoom({ name: "Actions room" });
  await client.send(room.id, "A short one");
  await page.goto(`${HUB}?c=${room.id}`);
  const message = page.locator(".collab-msg", { hasText: "A short one" });
  const actions = message.locator(".collab-msg-actions");
  await expect(actions).toBeVisible();
  await expect(actions.getByRole("button", { name: "Reply" })).toBeVisible();
  const overlap = await message.evaluate((m) => {
    const a = m.querySelector(".collab-msg-actions")!.getBoundingClientRect();
    const hit = (sel: string) => {
      const el = m.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return a.left < r.right && a.right > r.left && a.top < r.bottom && a.bottom > r.top;
    };
    return { author: hit(".collab-author"), time: hit(".collab-msg-head time"), body: hit(".collab-msg-body") };
  });
  expect(overlap).toEqual({ author: false, time: false, body: false });
  await context.close();
});

test("a long room name stays contained in the header and the details panel", async ({ browser }) => {
  const name = "Regional-distribution-coordination-for-Gulf-and-East-Africa-base-oil-shipments";
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const { client, page, context } = await signedIn(browser, "q3", viewport);
    const room = await client.createRoom({ name });
    await page.goto(`${HUB}?c=${room.id}`);
    const title = page.locator(".collab-thread-title h2");
    await expect(title).toContainText("Regional");
    // One line, inside the header; where it does not fit it ends in an ellipsis.
    const head = await title.evaluate((h) => {
      const s = getComputedStyle(h);
      const header = h.closest(".collab-thread-head")!.getBoundingClientRect();
      return {
        contained: h.getBoundingClientRect().right <= header.right + 0.5,
        oneLine: s.whiteSpace === "nowrap",
        ellipsis: s.textOverflow,
        clipped: h.scrollWidth > h.clientWidth,
      };
    });
    expect({ ...head, clipped: undefined }).toEqual({ contained: true, oneLine: true, ellipsis: "ellipsis", clipped: undefined });
    // A phone cannot fit the whole name: it really is cut with an ellipsis.
    if (viewport.width === 390) expect(head.clipped).toBe(true);
    await page.getByRole("button", { name: "Show details" }).click();
    const card = page.locator(".collab-room-card b");
    await expect(card).toBeVisible();
    const fit = await card.evaluate((b) => {
      const line = parseFloat(getComputedStyle(b).lineHeight) || 20;
      const panel = b.closest(".collab-details")!;
      return { lines: Math.round(b.getBoundingClientRect().height / line), panelFits: panel.scrollWidth <= panel.clientWidth + 1 };
    });
    expect(fit.lines).toBeLessThanOrEqual(2);
    expect(fit.panelFits).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await context.close();
  }
});
