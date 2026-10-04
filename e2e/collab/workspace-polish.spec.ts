import { test, expect, type Page } from "@playwright/test";
import { Client } from "./client";

const HUB = "/workspace/all-companies/collaboration";
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

test("ended notification expires, history persists, mentions and media fit desktop and phone", async ({ browser }) => {
  const host = await Client.login("studio"), peer = await Client.login("cmsales");
  const direct = (await host.openDirect("cmsales")).body.conversation;
  // This suite never joins media or calls another real user: local fixtures only.
  for (const m of (await host.get(`/conversations/${direct.id}/meetings`)).body.meetings) {
    if (m.status === "live") await host.post(`/meetings/${m.id}/end`, {});
  }
  const title = `Expired invitation ${Date.now()}`;
  const started = await host.post(`/conversations/${direct.id}/meetings`, { mode: "now", media: "voice", title });
  expect(started.status).toBe(201);
  const id = started.body.meeting.id;
  expect((await host.post(`/meetings/${id}/end`, {})).status).toBe(200);
  expect((await peer.post(`/meetings/${id}/join`, {})).status).toBe(410);
  await expect.poll(async () => (await peer.request("GET", "/api/notifications")).body.items.some((n: any) => n.target?.meetingId === id)).toBe(true);
  const b = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await peer.signInBrowser(b);
  const pb = await b.newPage();
  let joinRequests = 0;
  pb.on("request", r => { if (r.url().endsWith(`/meetings/${id}/join`)) joinRequests++; });
  await pb.goto("/?view=notifications");
  await pb.locator(".notify-row").filter({ hasText: title }).locator(".notify-main").click();
  await expect(pb.getByRole("heading", { name: "This call or meeting has ended" })).toBeVisible();
  await expect(pb.getByRole("button", { name: /Connect call|Join now|Start meeting/ })).toHaveCount(0);
  expect(joinRequests).toBe(0);
  await pb.screenshot({ path: "test-results/polish-expired-invitation.png" });
  await b.close();

  const a = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await host.signInBrowser(a);
  const page = await a.newPage();
  await page.goto(`${HUB}?c=${direct.id}`);
  await expect(page.locator(`[data-meeting-id="${id}"]`)).toContainText(/Voice call.*No answer/);
  await expect(page.locator(`[data-meeting-id="${id}"]`)).toContainText(/Attempt duration \d\d:\d\d/);
  await page.reload();
  await expect(page.locator(`[data-meeting-id="${id}"]`)).toBeVisible();
  const room = await host.createRoom({ name: "Interface review", members: ["cmsales"], description: "Shared decisions, files and next steps." });
  await peer.send(room.id, "The revised quotation is ready for your review.");
  await host.send(room.id, "Thank you — I will check the quantities today.");
  const imagePage = await a.newPage();
  await imagePage.setViewportSize({ width: 900, height: 480 });
  await imagePage.setContent('<body style="margin:0;box-sizing:border-box;height:100vh;background:linear-gradient(130deg,#3d357a,#1f8394);color:white;font:40px system-ui;padding:60px"><small style="font-size:18px">ENERCORE · LOCAL DESIGN REVIEW</small><h1>Clearer conversations.</h1><p style="font-size:22px">Fictional image attachment</p></body>');
  const bytes = await imagePage.screenshot();
  await imagePage.close();
  const upload = await host.upload(room.id, { name: "design-review.png", bytes, type: "image/png" }, { width: "900", height: "480" });
  expect(upload.status).toBe(201);
  expect((await host.send(room.id, "Image for layout review", { attachmentIds: [upload.body.attachment.id] })).status).toBe(201);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${HUB}?c=${room.id}`);
    const preview = page.locator('.collab-images.count-1 .collab-image').last();
    await expect(preview).toBeVisible();
    expect((await preview.boundingBox())!.height).toBeLessThanOrEqual(320);
    expect((await preview.boundingBox())!.width).toBeGreaterThanOrEqual(240);
    await expect(preview.locator('img')).toHaveCSS('object-fit', 'contain');
    if (width === 1440) {
      const filters = page.locator('.collab-sidebar .collab-filters');
      await expect(filters.getByRole('tab', { name: /^Mentions/ })).toBeInViewport();
      expect(await filters.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    }
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await input.fill("@");
    const picker = page.getByRole("listbox", { name: "Mention someone" });
    await expect(picker).toBeVisible();
    const avatar = await picker.locator(".entity-avatar").first().boundingBox();
    expect(Math.abs(avatar!.width - avatar!.height)).toBeLessThan(1);
    await page.screenshot({ path: `test-results/polish-mention-${width}.png` });
    await input.fill("");
    await page.getByRole("button", { name: "Show details", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Conversation details" })).toBeVisible();
    expect(await fits(page)).toBe(true);
    await page.screenshot({ path: `test-results/polish-room-${width}.png` });
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    await page.locator(".collab-msg img").last().click();
    const lightbox = page.locator(".collab-lightbox");
    await expect(lightbox).toBeVisible();
    await expect(lightbox).toHaveCSS("background-color", "rgb(12, 16, 24)");
    await expect(lightbox.getByRole("button", { name: "Close image", exact: true })).toBeInViewport();
    await page.screenshot({ path: `test-results/polish-image-${width}.png` });
    await page.keyboard.press("Escape");
  }
  await a.close();
});

test("status errors stay errors, compact cards and shared controls respond across themes and sizes", async ({ browser }) => {
  const actor = await Client.login("studio");
  const a = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await actor.signInBrowser(a);
  const page = await a.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const title = `Approval regression ${Date.now()}`;
  const leave = await actor.request("POST", "/api/my-requests", { kind: "leave", title, company: "Petronik", branch: "Main", due: "2026-11-17", quantity: 2, detail: "Local regression check" });
  expect(leave.status).toBe(201);
  await page.goto("/workspace/all-companies/people-hr");
  await page.getByRole("button", { name: "Leave requests", exact: true }).click();
  await page.getByRole("textbox", { name: "Search records", exact: true }).fill(title);
  await page.getByRole("combobox", { name: `Status for ${title}` }).click();
  await page.getByRole("option", { name: "Approved", exact: true }).click();
  await expect(page.getByText("A different authorised approver must review this leave request.", { exact: true })).toBeVisible();
  await expect(page.getByText(/is now Approved/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Set follow-up", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/polish-approval-error.png" });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace/all-companies/overview");
    await page.getByRole("button", { name: /^My priorities/ }).click();
    const priorities = page.getByRole("button", { name: /^My priorities/ });
    expect(await priorities.evaluate(e => getComputedStyle(e).color === getComputedStyle(e.querySelector("span")!).color)).toBe(true);
    await page.getByRole("button", { name: "Quick add", exact: true }).click();
    const kinds = page.locator(".quick-add-kinds");
    await expect(kinds).toBeVisible();
    expect(await kinds.evaluate(e => getComputedStyle(e).gridTemplateColumns.split(" ").length === e.children.length)).toBe(true);
    await expect(kinds.locator("button").first()).toHaveCSS("justify-content", "center");
    expect(await fits(page)).toBe(true);
    await page.screenshot({ path: `test-results/polish-quick-add-${width}.png`, animations: "disabled" });
    await page.keyboard.press("Escape");
    await page.goto("/workspace/all-companies/sales-pipeline");
    const footer = page.locator(".pipeline-card-shell .lead-card-footer").first();
    await expect(footer).toBeVisible();
    const avatar = await footer.locator(".entity-avatar").boundingBox();
    const more = await footer.getByRole("button").boundingBox();
    expect(Math.abs(avatar!.y + avatar!.height / 2 - more!.y - more!.height / 2)).toBeLessThan(2);
    expect(more!.x).toBeGreaterThan(avatar!.x);
    await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await fits(page)).toBe(true);
    await page.screenshot({ path: `test-results/polish-pipeline-dark-${width}.png`, animations: "disabled" });
    await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
    await page.goto("/my-requests");
    await expect(page.locator(".request-history-panel .tone-warning").first()).toBeVisible();
    await expect(page.locator(".request-history-panel")).not.toContainText(" MT");
    expect(await fits(page)).toBe(true);
    await page.screenshot({ path: `test-results/polish-requests-${width}.png`, animations: "disabled" });
  }
  expect(errors).toEqual([]);
  await a.close();
});

test("chart previews, single navigation and record tabs stay readable without layout jumps", async ({ browser }) => {
  const actor = await Client.login("studio");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await actor.signInBrowser(context);
  const page = await context.newPage();
  await page.goto("/workspace/all-companies/overview");
  const nav = page.getByRole("navigation", { name: "Main navigation", exact: true });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button", { name: "Sales pipeline", exact: true })).toHaveCount(1);
  const logo = await page.locator('a.brand > .brand-logo').first().boundingBox();
  expect(logo!.width).toBeLessThanOrEqual(40);
  const bar = page.getByRole("button", { name: /confirmed sales.*View orders/ }).and(page.locator(":enabled")).first();
  await bar.hover();
  await expect(page.locator('[class*="chartReadout"]')).toContainText("Orders");
  await page.screenshot({ path: "test-results/polish-dashboard.png" });
  await page.locator(".dash-analysis summary").click();
  const donut = page.locator(".chart-donut").first();
  await expect(donut).toBeVisible();
  await donut.scrollIntoViewIfNeeded();
  const before = await donut.boundingBox();
  await donut.locator(".donut-legend-row").first().hover();
  const after = await donut.boundingBox();
  expect(Math.abs(before!.height - after!.height)).toBeLessThan(2);
  await expect(donut.locator(".chart-selection")).not.toContainText("Explore the breakdown");
  await donut.locator(".chart-segment").first().focus();
  await page.keyboard.press("Enter");
  await expect(donut.locator(".chart-segment").first()).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/polish-charts-desktop.png", animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await donut.scrollIntoViewIfNeeded();
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: "test-results/polish-charts-phone.png", animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/workspace/all-companies/sales-pipeline");
  await expect(page.locator(".lead-card").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Switch to dark mode", exact: true })).toBeVisible();
  // Inspect the same paint that changes the theme, before a transition can flash.
  const theme = await page.evaluate(() => {
    (document.querySelector('[aria-label="Switch to dark mode"]') as HTMLButtonElement).click();
    const card = document.querySelector(".lead-card")!;
    return { theme: document.documentElement.dataset.theme, changing: document.documentElement.dataset.appearanceChanging, transition: getComputedStyle(card).transitionDuration };
  });
  expect(theme).toEqual({ theme: "dark", changing: "true", transition: "0s" });
  await page.locator(".lead-card").first().click();
  const tabs = page.locator(".rw-tabbar");
  await expect(tabs).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 450));
  await expect(tabs).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.screenshot({ path: "test-results/polish-record-tabs-dark.png" });
  await context.close();
});
