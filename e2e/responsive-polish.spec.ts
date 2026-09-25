import { test, expect, type Page } from "@playwright/test";

/**
 * The production-QA polish, in preview mode (fictional in-browser data):
 * floating Quick Add clearance, notification filters on a phone, the
 * sidebar's scroll fade, the welcome sentence, create/edit labels, form
 * spacing and required markers, one loading state at a time, and no
 * horizontal overflow at the four reference widths.
 */

const WIDTHS = [390, 768, 1024, 1440];

const noOverflow = (page: Page) =>
  expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

test("no horizontal overflow on the main pages at 390, 768, 1024 and 1440", async ({ page }) => {
  test.slow();
  for (const width of WIDTHS)
    for (const path of ["/", "/workspace/all-companies/sales-pipeline", "/workspace/all-companies/customers", "/workspace/all-companies/notifications", "/workspace/all-companies/collaboration"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await expect(page.locator(".main-content")).toBeVisible();
      await noOverflow(page);
    }
});

test("the floating Quick Add never covers the last content at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/workspace/all-companies/customers", "/workspace/all-companies/notifications"]) {
    await page.goto(path);
    const fab = page.locator(".quick-add-trigger");
    await expect(fab).toBeVisible();
    // Loaded content only (not a skeleton), then scroll instantly to the very
    // bottom and confirm we are there before measuring.
    await expect(page.locator(".skeleton-region")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
          return Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1;
        }),
      )
      .toBe(true);
    const { contentBottom, fabTop } = await page.evaluate(() => {
      const main = document.querySelector(".main-content")!;
      // The lowest visible thing inside the page content.
      let bottom = 0;
      for (const el of main.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && getComputedStyle(el).visibility !== "hidden") bottom = Math.max(bottom, r.bottom);
      }
      return { contentBottom: bottom, fabTop: document.querySelector(".quick-add-trigger")!.getBoundingClientRect().top };
    });
    expect(contentBottom, path).toBeLessThanOrEqual(fabTop);
  }
});

test("notification filters are one scrolling row at 390px and every filter works", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace/all-companies/notifications");
  const strip = page.locator(".notify-filters");
  await expect(strip).toBeVisible();
  const buttons = strip.getByRole("button");
  // One row: every button shares the first one's top edge.
  const tops = await buttons.evaluateAll((b) => b.map((x) => Math.round(x.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  // Overflow is signalled only while more filters lie beyond the edge.
  const overflows = await strip.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  await expect(strip).toHaveAttribute("data-fade-end", String(overflows));
  await expect(strip).toHaveAttribute("data-fade-start", "false");
  for (const name of ["Unread", "Assignments", "Approvals", "Collaboration", "All"]) {
    const button = strip.getByRole("button", { name: new RegExp(`^${name}`) });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    // The chosen filter is fully inside the strip, clear of the fade.
    const inside = await button.evaluate((b) => {
      const s = b.parentElement!.getBoundingClientRect();
      const r = b.getBoundingClientRect();
      return r.left >= s.left - 0.5 && r.right <= s.right + 0.5;
    });
    expect(inside, name).toBe(true);
  }
  await noOverflow(page);
});

test("the sidebar fades only while more navigation lies below, and not at the bottom", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  // Short screen: the Manage group is below the fold.
  await page.setViewportSize({ width: 1440, height: 640 });
  await page.goto("/");
  await expect(nav).toHaveAttribute("data-fade-end", "true");
  await expect(nav).toHaveAttribute("data-fade-start", "false");
  await nav.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(nav).toHaveAttribute("data-fade-end", "false");
  await expect(nav).toHaveAttribute("data-fade-start", "true");
  await expect(page.getByRole("button", { name: "Approvals", exact: true })).toBeInViewport();
  // Tall screen: everything fits, so there is no fade at all.
  await page.setViewportSize({ width: 1440, height: 1600 });
  await expect(nav).toHaveAttribute("data-fade-end", "false");
  await expect(nav).toHaveAttribute("data-fade-start", "false");
});

test("the welcome line is one naturally wrapping sentence at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const line = page.locator(".welcome-message");
  await expect(line).toBeVisible();
  const layout = await line.evaluate((p) => {
    const span = p.querySelector("span")!;
    const first = span.getClientRects()[0];
    const box = p.getBoundingClientRect();
    // The greeting's last character, measured as text like the span is.
    const greeting = p.firstChild as Text;
    const end = document.createRange();
    end.setStart(greeting, greeting.length - 2);
    end.setEnd(greeting, greeting.length - 1);
    const greetingEnd = end.getClientRects()[0];
    return {
      display: getComputedStyle(span).display,
      // The muted half continues on the line where the greeting ends…
      sameLine: Math.abs(first.top - greetingEnd.top) < 2,
      // …rather than being pushed to the start of a line of its own.
      startsLine: Math.abs(first.left - box.left) < 1,
    };
  });
  expect(layout).toEqual({ display: "inline", sameLine: true, startsLine: false });
});

test("create forms name what they create; edit saves changes", async ({ page }) => {
  const forms: [string, string, string][] = [
    ["leads", "New lead", "Create lead"],
    ["customers", "Add customer", "Create customer"],
    ["suppliers", "Add supplier", "Create supplier"],
    ["products", "Add product", "Create product"],
    ["hr", "Add employee", "Create employee"],
    ["marketing", "New campaign", "Create campaign"],
    ["it", "New ticket", "Create ticket"],
  ];
  for (const [module, open, primary] of forms) {
    await page.goto(`/?module=${module}`);
    await page.getByRole("button", { name: open, exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    const end = dialog.locator(".ui-dialog-actions-end");
    // [Cancel] [Create …], primary rightmost.
    await expect(end.getByRole("button").last()).toBeVisible();
    expect(await end.locator("button").evaluateAll((b) => b.map((x) => (x as HTMLElement).innerText.trim()))).toEqual(["Cancel", primary]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.goto("/?module=customers");
  await page.locator(".record-card-shell, table tbody tr").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit record" }).last().click();
  // Visible text: the hidden pending label ("Saving…") is not part of it.
  await expect
    .poll(() => page.getByRole("dialog").locator(".ui-dialog-actions-end").getByRole("button").last().evaluate((b) => (b as HTMLElement).innerText.trim()))
    .toBe("Save changes");
});

test("the lead form marks its required name and spaces the notes like every field", async ({ page }) => {
  await page.goto("/?module=leads");
  await page.getByRole("button", { name: "New lead", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New lead" });
  await expect(dialog.locator("label", { hasText: "Company / Record name" }).locator(".ui-required")).toHaveText("*");
  const gaps = await dialog.evaluate((d) => {
    const field = (text: string) =>
      [...d.querySelectorAll(".ui-field")].find((f) => f.querySelector("label")?.textContent?.startsWith(text))!.getBoundingClientRect();
    return {
      // Rows inside one grid: Email/Phone below Next action.
      rowGap: Math.round(field("Destination / Port").top - field("Email").bottom),
      notesGap: Math.round(field("Enquiry notes").top - field("Destination / Port").bottom),
    };
  });
  expect(gaps.notesGap).toBe(gaps.rowGap);
});

test("the boot screen and a page skeleton are never shown together", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".main-content")).toBeVisible();
  const state = await page.evaluate(async () => {
    const skeleton = document.createElement("div");
    skeleton.className = "skeleton-region";
    skeleton.textContent = "loading";
    document.querySelector(".main-content")!.append(skeleton);
    const boot = document.createElement("main");
    boot.className = "app-boot";
    document.body.append(boot);
    const during = getComputedStyle(skeleton).visibility;
    boot.remove();
    const after = getComputedStyle(skeleton).visibility;
    skeleton.remove();
    return { during, after };
  });
  expect(state).toEqual({ during: "hidden", after: "visible" });
});
