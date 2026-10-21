/** Read-only business-data checks against the isolated fictional Worker.
 * No production access, data seeding, account changes or external providers. */
import { test, expect, type BrowserContext } from "@playwright/test";

async function signIn(context: BrowserContext, account: string) {
  const response = await context.request.post("/api/auth", {
    headers: { Origin: "http://localhost:8788" },
    data: {
      email: `${account}@collab.test`,
      password: "Collab-Test-Password-1",
    },
  });
  expect(response.status(), account).toBe(200);
  return (await context.cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}
test("management endpoint authorizes roles, enforces scope and pages beyond the display window", async ({
  browser,
}) => {
  for (const [account, allowed] of [
    ["studio", true],
    ["release1", true],
    ["release14", true],
    ["release5", false],
    ["release9", false],
    ["release10", false],
  ] as const) {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:8789",
    });
    try {
      const cookie = await signIn(context, account);
      const first = await context.request.get("/api/management/overview", {
        headers: { Cookie: cookie },
      });
      expect(first.status(), account).toBe(allowed ? 200 : 403);
      if (!allowed) continue;
      const data = await first.json();
      expect(first.headers()["cache-control"]).toContain("private, no-store");
      expect(Array.isArray(data.people)).toBe(true);
      expect(Array.isArray(data.records)).toBe(true);
      for (const person of data.people)
        expect(Object.keys(person).sort()).toEqual([
          "active",
          "branches",
          "companies",
          "id",
          "name",
          "role",
        ]);
      const ids = new Set(data.records.map((r: { id: string }) => r.id));
      let next = data.next;
      while (next) {
        const result = await context.request.get(
          `/api/management/overview?after=${encodeURIComponent(next)}&asOf=${encodeURIComponent(data.asOf)}`,
          { headers: { Cookie: cookie } },
        );
        expect(result.status()).toBe(200);
        const page = await result.json();
        expect(page.people).toEqual([]);
        expect(page.asOf).toBe(data.asOf);
        for (const r of page.records) {
          expect(ids.has(r.id)).toBe(false);
          ids.add(r.id);
        }
        expect(page.next).not.toBe(next);
        next = page.next;
      }
      expect(
        (
          await context.request.get("/api/management/overview?unexpected=yes", {
            headers: { Cookie: cookie },
          })
        ).status(),
      ).toBe(400);
      if (account === "release1")
        expect(
          data.records
            .filter(
              (r: { kind: string; ownerId: string }) =>
                r.kind === "hr" || r.kind === "leave",
            )
            .every((r: { ownerId: string }) => r.ownerId === "release-user-1"),
        ).toBe(true);
    } finally {
      await context.close();
    }
  }
  const signedOut = await browser.newContext({
    baseURL: "http://127.0.0.1:8789",
  });
  expect(
    (await signedOut.request.get("/api/management/overview")).status(),
  ).toBe(401);
  await signedOut.close();
});

test("authenticated dashboard preserves prior totals on failure and retries without zeroing cards", async ({
  context,
  page,
}, info) => {
  await signIn(context, "studio");
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("/workspace/all-companies/overview");
  const overview = page.getByRole("region", {
    name: "Department and employee overview",
    exact: true,
  });
  await expect(overview.locator("[data-department]")).toHaveCount(6);
  await expect(overview).toHaveAttribute("aria-busy", "false");
  const before = await overview.locator("[data-department]").allTextContents();
  await page.route("**/api/management/overview*", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "The overview could not refresh. Please try again." },
    }),
  );
  await overview
    .getByRole("button", { name: "Refresh management overview", exact: true })
    .click();
  await expect(overview.getByRole("alert")).toContainText(
    "Showing the last successful update",
  );
  expect(await overview.locator("[data-department]").allTextContents()).toEqual(
    before,
  );
  await expect(
    overview.getByRole("button", { name: "Export report", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: info.outputPath("management-recoverable-error.png"),
  });
  await page.unroute("**/api/management/overview*");
  await overview
    .getByRole("button", { name: "Refresh management overview", exact: true })
    .click();
  await expect(overview.getByRole("alert")).toHaveCount(0);
  await expect(overview).toHaveAttribute("aria-busy", "false");
  await expect(
    overview.getByRole("button", { name: "Export report", exact: true }),
  ).toBeEnabled();
  await overview
    .getByRole("button", { name: "Employee performance", exact: true })
    .click();
  await expect(overview.getByRole("table")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("management-authenticated-team.png"),
    fullPage: true,
  });
  await page.route("**/api/management/overview*", route => route.fulfill({ status: 403, json: { error: "This overview is available to management only." } }));
  await overview.getByRole("button", { name: "Refresh management overview", exact: true }).click();
  await expect(overview.getByRole("alert")).toContainText("management only");
  await expect(overview.getByRole("table")).toHaveCount(0);
  await expect(overview.locator("[data-department]")).toHaveCount(0);
  await expect(page.getByText("Complete totals unavailable")).toHaveCount(4);
});
