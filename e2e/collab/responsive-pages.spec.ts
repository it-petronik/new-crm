import { test, expect } from "@playwright/test";
import { Client } from "./client";
import { workspaceUrl } from "../../src/lib/workspace-url";
import { modules } from "../../src/lib/domain";
const widths = [320, 390, 768, 1024, 1280, 1440, 1920];
test("workspace pages fit phone through wide desktop in both themes", async ({
  browser,
}) => {
  const actor = await Client.login("studio"),
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
  await actor.signInBrowser(context);
  const page = await context.newPage();
  const errors: string[] = [],
    failures: unknown[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
  ].filter(
    (route) =>
      !process.env.RESPONSIVE_ROUTES ||
      process.env.RESPONSIVE_ROUTES.split(",").includes(route),
  );
  for (const route of routes) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(workspaceUrl(route, "All companies"));
    await expect(page.locator("#main")).toBeVisible();
    for (const width of widths)
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(
          (t) => document.documentElement.setAttribute("data-theme", t),
          theme,
        );
        await page.waitForTimeout(130);
        const metric = await page.evaluate(() => ({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        if (metric.scrollWidth > width + 1) {
          const offenders = await page.locator("#main").evaluate((e) =>
            [...e.querySelectorAll("*")]
              .filter((n) => n.getBoundingClientRect().right > innerWidth + 1)
              .slice(0, 8)
              .map((n) => ({
                tag: n.tagName,
                class: n.className,
                width: n.getBoundingClientRect().width,
              })),
          );
          failures.push({ route, theme, ...metric, offenders });
        }
        if (route === "profile") {
          await page
            .locator(".profile-heading h2")
            .evaluate((e) => (e.textContent = "Enercore Administrator"));
          const geometry = await page
            .locator(".profile-heading")
            .evaluate((e) => {
              const h = e.querySelector("h2")!,
                r = e.getBoundingClientRect(),
                s = getComputedStyle(h);
              return {
                width: r.width,
                height: h.getBoundingClientRect().height,
                line: parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.5,
              };
            });
          if (
            geometry.width < Math.min(130, width * 0.4) ||
            geometry.height > geometry.line * 3.2
          )
            failures.push({ route, width, theme, geometry });
          await page.screenshot({
            path: `test-results/profile-responsive-${theme}-${width}.png`,
          });
        }
      }
  }
  console.log(
    "responsive-audit",
    JSON.stringify({
      routes: routes.length,
      widths,
      themes: 2,
      failures,
      errors,
    }),
  );
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});
