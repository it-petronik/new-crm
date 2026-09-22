import { test, expect } from "@playwright/test";

test("shared dialog retains actions and saves employee fields", async ({
  page,
}, info) => {
  await page.goto("/?module=hr");
  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Employee full name", exact: true })
    .fill("Layout Test Employee");
  await page
    .getByRole("textbox", { name: "Job title", exact: true })
    .fill("Operations assistant");
  await page
    .getByRole("combobox", { name: "Employee role", exact: true })
    .click();
  await page.getByRole("option", { name: "Assistant", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Work arrangement", exact: true })
    .click();
  await page.getByRole("option", { name: "Remote", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "Basic salary", exact: true })
    .fill("5000");
  await page.getByRole("spinbutton", { name: "Allowance", exact: true }).fill("750");
  await page.screenshot({ path: info.outputPath("employee-desktop.png") });
  await page.setViewportSize({ width: 390, height: 720 });
  const heading = await page.locator(".dialog-heading").boundingBox();
  const footer = await page.locator(".dialog-footer").boundingBox();
  await page.locator(".dialog-body").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await page.locator(".dialog-heading").boundingBox()).toEqual(heading);
  expect(await page.locator(".dialog-footer").boundingBox()).toEqual(footer);
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(720);
  await page.screenshot({ path: info.outputPath("employee-mobile.png") });
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("enercore-preview-v1") || "{}").records.find((r: {title:string}) => r.title === "Layout Test Employee"));
  expect(stored.attributes.monthlySalary).toBe("5750");
  await expect(
    page.getByRole("button", { name: /Layout Test Employee/ }).first(),
  ).toBeVisible();
});

test("dashboard charts render and mobile has no horizontal overflow", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.locator(".insight-chart").first()).toBeVisible();
  await page
    .locator(".business-insights")
    .screenshot({ path: info.outputPath("charts.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".main-shell")).toHaveCSS("margin-left", "0px");
  await page.screenshot({ path: info.outputPath("dashboard-mobile.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
