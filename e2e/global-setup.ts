import { chromium } from "@playwright/test";

/**
 * Warms the dev server's on-demand route compilation.
 *
 * `next dev` compiles a route the first time it is requested. With several
 * workers starting at once, whichever test happens to ask for an uncompiled
 * route waits behind that compile and can exceed its timeout — which surfaces
 * as a different test failing on each run, for a reason that has nothing to do
 * with the behaviour under test.
 *
 * Requesting each route once, serially, before the suite starts moves that
 * cost out of the tests. It changes no assertion and no application code.
 */
const ROUTES = [
  "/login",
  "/workspace/all-companies/overview",
  "/workspace/all-companies/sales-orders",
  "/workspace/all-companies/customers",
  "/workspace/all-companies/sales-pipeline",
  "/workspace/all-companies/quotations",
  "/my-requests",
  "/reset-password",
];

export default async function globalSetup() {
  const base = "http://localhost:3000";
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const route of ROUTES) {
    try {
      await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 90_000 });
    } catch {
      // A route that cannot be reached here will be reported by the test that
      // actually depends on it; warming is best effort.
    }
  }
  await browser.close();
}
