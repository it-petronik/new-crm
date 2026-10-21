import { test, expect, type Browser } from "@playwright/test";
import { modules, roles } from "../src/lib/domain";
import { workspaceUrl } from "../src/lib/workspace-url";
import { writeFileSync } from "node:fs";
const baseURL = "http://127.0.0.1:8789";
async function signedIn(browser: Browser, key: string) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const res = await context.request.post("/api/auth", {
    headers: { Origin: "http://localhost:8788" },
    data: { email: `${key}@collab.test`, password: "Collab-Test-Password-1" },
  });
  expect(res.status()).toBe(200);
  await context.addInitScript(() => {
    localStorage.setItem("enercore-theme", "dark");
  });
  return context;
}
test("every workspace page fits dark desktop and mobile without legacy white surfaces", async ({
  browser,
}, info) => {
  const context = await signedIn(browser, "studio");
  const page = await context.newPage();
  const routes = [
    ...modules,
    "mail",
    "prospecting",
    "collaboration",
    "ai",
    "actions",
    "tasks",
    "operations",
    "notifications",
    "profile",
    "appearance",
    "access",
    "shortcuts",
    "my-requests",
  ];
  const report: unknown[] = [],
    failures: unknown[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const route of routes) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspaceUrl(route, "All companies"));
    await expect(page.locator("#main")).toBeVisible();
    await page.waitForTimeout(600);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(160);
      const snapshot = await page.evaluate(() => {
        const rgb = (s: string) => s.match(/[\d.]+/g)?.map(Number) || [];
        const whites = [
          ...document.querySelectorAll<HTMLElement>(
            "#main div,#main section,#main header,#main button,#main input,#main textarea,#main table,#main aside",
          ),
        ]
          .filter((el) => {
            if (
              el.closest(
                ".reference-document,.theme-preview,.brand-logo,.mail-original,.intel-print",
              )
            )
              return false;
            const r = el.getBoundingClientRect(),
              cs = getComputedStyle(el),
              c = rgb(cs.backgroundColor);
            return (
              r.width > 100 &&
              r.height > 24 &&
              cs.visibility !== "hidden" &&
              c.length >= 3 &&
              c.slice(0, 3).every((v) => v > 220) &&
              (c[3] ?? 1) > 0.85
            );
          })
          .map((el) => ({
            tag: el.tagName,
            class: el.className,
            background: getComputedStyle(el).backgroundColor,
            color: getComputedStyle(el).color,
            text: (el.innerText || "").slice(0, 90),
          }));
        return {
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          whites,
          theme: document.documentElement.dataset.theme,
        };
      });
      report.push({ route, ...snapshot });
      if (
        snapshot.scroll > width + 1 ||
        snapshot.whites.length ||
        snapshot.theme !== "dark"
      )
        failures.push({ route, ...snapshot });
      if (width === 1440)
        await page.screenshot({
          path: info.outputPath(`dark-${route}.png`),
          fullPage: true,
        });
    }
  }
  await info.attach("dark-page-audit", {
    body: JSON.stringify({ report, failures, errors }, null, 2),
    contentType: "application/json",
  });
  writeFileSync(
    info.outputPath("dark-page-audit.json"),
    JSON.stringify({ report, failures, errors }, null, 2),
  );
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});
test("all 16 role refreshes keep the correct role and never paint MD for a non-executive", async ({
  browser,
}, info) => {
  const findings: unknown[] = [];
  for (let index = 0; index < roles.length; index++) {
    const role = roles[index],
      context = await signedIn(browser, `release${index}`),
      page = await context.newPage();
    await page.addInitScript(() => {
      (window as Window & { mdFlash?: boolean }).mdFlash = false;
      new MutationObserver(() => {
        if (
          [...document.querySelectorAll("h1")].some((el) =>
            el.textContent?.includes("Group dashboard"),
          )
        )
          (window as Window & { mdFlash?: boolean }).mdFlash = true;
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(workspaceUrl("overview", "All companies"));
    await expect(page.locator("#main")).toBeVisible();
    await page.route("**/api/records*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });
    await page.reload();
    await expect(page.locator("#main")).toBeVisible();
    await page.waitForTimeout(650);
    const wrong = await page.evaluate(
      () => (window as Window & { mdFlash?: boolean }).mdFlash,
    );
    if (!["MD", "IT Administrator", "Group Manager", "Branch Manager"].includes(role))
      expect(wrong, role).toBe(false);
    const label = page.locator(".role-home-heading .eyebrow").first();
    if (!["MD", "IT Administrator", "Group Manager", "Branch Manager"].includes(role))
      await expect(label).toContainText(role);
    findings.push({ role, wrongRoleFlash: wrong });
    await page.screenshot({
      path: info.outputPath(`role-${index}-dark.png`),
      fullPage: true,
    });
    await context.close();
  }
  await info.attach("role-refresh-audit", {
    body: JSON.stringify(findings, null, 2),
    contentType: "application/json",
  });
});
