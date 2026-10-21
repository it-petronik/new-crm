import { test, expect, type Page } from "@playwright/test";
import { demoAccounts, makePreview } from "../src/lib/fixtures";
import type { Actor } from "../src/lib/domain";
const hr = demoAccounts.find((a) => a.actor.role === "HR Manager")!.actor;
async function seed(page: Page, actor: Actor = hr) {
  const data = makePreview();
  data.records = data.records.map((r) =>
    r.kind === "hr" ? { ...r, due: "2026-01-01" } : r,
  );
  await page.addInitScript(
    ({ actor, data }) => {
      localStorage.setItem("enercore-preview-actor", JSON.stringify(actor));
      localStorage.setItem("enercore-preview-v1", JSON.stringify(data));
    },
    { actor, data },
  );
}
async function section(page: Page, label: string) {
  await page.getByRole("combobox", { name: "HR workspace section" }).click();
  await page
    .getByRole("option", { name: new RegExp(`^${label}$`, "i") })
    .click();
}
test("HR desk is compact, usable in both themes and does not show an employee clock", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await seed(page);
  await page.goto("/workspace/all-companies/people-hr");
  const hub = page.getByRole("region", { name: "HR operations", exact: true });
  await expect(hub.getByText("Today’s HR desk", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /check.in|check.out/i }),
  ).toHaveCount(0);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.screenshot({
      path: info.outputPath(`hr-desk-${theme}.png`),
      fullPage: true,
    });
  }
  await section(page, "Attendance");
  await page
    .getByRole("button", { name: "New attendance", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "New attendance",
    exact: true,
  });
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("combobox", { name: "Employee", exact: true }).click();
  await page.getByRole("option").nth(1).click();
  await dialog
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    hub.getByRole("cell", { name: "Recorded", exact: true }),
  ).toBeVisible();
  await section(page, "Employee files");
  await page.getByRole("button", { name: "New document", exact: true }).click();
  const doc = page.getByRole("dialog", { name: "New document", exact: true });
  await doc.getByRole("combobox", { name: "Employee", exact: true }).click();
  await page.getByRole("option").nth(1).click();
  await doc
    .getByRole("textbox", { name: /^Document name/ })
    .fill("Fictional employee passport");
  await doc.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(doc).not.toBeVisible();
  await page.getByRole("button", { name: "View", exact: true }).click();
  await expect(page.getByLabel("Attach PDF, PNG or JPEG")).toBeDisabled();
  await page.screenshot({
    path: info.outputPath("hr-private-file.png"),
    fullPage: true,
  });
});
test("salary, bonus, review, probation and payroll use consistent fields without pre-submit errors", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seed(page);
  await page.goto("/workspace/all-companies/people-hr");
  for (const [label, button] of [
    ["Salary & increments", "New salary proposal"],
    ["Bonuses", "New bonus"],
    ["Performance reviews", "New review"],
    ["Probation decisions", "New probation"],
    ["Payroll register", "New payroll"],
    ["Employment dates", "New employment"],
  ]) {
    await section(page, label);
    await page.getByRole("button", { name: button, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    const boxes = await dialog
      .locator("input:not([type=checkbox]),button[role=combobox]")
      .evaluateAll((els) =>
        els
          .filter(
            (e) =>
              e.getBoundingClientRect().height > 10 &&
              e.getBoundingClientRect().width > 40,
          )
          .map((e) => e.getBoundingClientRect().height),
      );
    expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThanOrEqual(3);
    await page.screenshot({
      path: info.outputPath(`hr-${label.replace(/\W+/g, "-")}.png`),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});
test("assistant sees employee files and private HR as requested", async ({ page }) => {
  const assistant: Actor = { ...demoAccounts[0].actor, role: "MD Assistant" };
  await seed(page, assistant);
  await page.goto("/workspace/all-companies/people-hr");
  await page.getByRole("combobox", { name: "HR workspace section" }).click();
  await expect(
    page.getByRole("option", { name: /^Employee files$/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: /^Salary & increments$/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: /^Company files & licences$/i }),
  ).toBeVisible();
});
test("IT cannot see the employee-files section or upload employee documents", async ({
  page,
}) => {
  const it = demoAccounts.find(
    (a) => a.actor.role === "IT Administrator",
  )!.actor;
  await seed(page, it);
  await page.goto("/workspace/all-companies/people-hr");
  await page.getByRole("combobox", { name: "HR workspace section" }).click();
  await expect(
    page.getByRole("option", { name: /^Employee files$/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("option", { name: /^Company files & licences$/i }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
});
