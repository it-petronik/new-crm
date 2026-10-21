import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { makePreview, previewActor } from "../src/lib/fixtures";
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(
    ({ actor, data }) => {
      localStorage.setItem("enercore-preview-actor", JSON.stringify(actor));
      localStorage.setItem("enercore-preview-v1", JSON.stringify(data));
    },
    { actor: previewActor, data: makePreview() },
  );
});
test("top bar opens a page-shaped chat; demo sending is local and suggestions never send", async ({
  page,
}, info) => {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/api\/(ai|records|prospecting)/.test(r.url())
    )
      posts.push(r.url());
  });
  await page.goto("/workspace/all-companies/people-hr");
  await page
    .getByRole("button", { name: "Ask Enercore AI", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Enercore AI chat", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ai-companion-trigger")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Prioritise follow-ups", exact: true })
    .click();
  const composer = page.getByRole("textbox", {
    name: "Message Enercore AI",
    exact: true,
  });
  await expect(composer).toHaveValue("Which leads need attention now?");
  expect(posts).toEqual([]);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.screenshot({ path: info.outputPath(`chat-${theme}.png`) });
  }
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("[data-demo-answer]")).toBeVisible();
  expect(posts).toEqual([]);
  await page.screenshot({
    path: info.outputPath("chat-conversation-dark.png"),
  });
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.locator("[data-demo-answer]")).toHaveCount(0);
});
test("table export downloads a branded filtered workbook with table, date and exporter", async ({
  page,
}, info) => {
  await page.goto("/workspace/all-companies/customers");
  await page
    .getByRole("textbox", { name: "Search records", exact: true })
    .fill("Gulf");
  await expect(page.getByText("List tools", { exact: true })).toHaveCount(0);
  const next = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export records to Excel", exact: true })
    .click();
  const file = await next;
  expect(file.suggestedFilename()).toMatch(
    /^Enercore_Customers_\d{4}-\d\d-\d\d_Alex-Morgan\.xlsx$/,
  );
  const path = info.outputPath("customers-review.xlsx");
  await file.saveAs(path);
  const contents = (await readFile(path)).toString("utf8");
  expect(contents).toContain("Alex Morgan");
  expect(contents).toContain("Gulf Industrial Trading");
  expect(contents).toContain("showGridLines");
  expect(contents).not.toContain("Atlas Marine Services");
});
test("search icon clears its placeholder, field hover stays neutral and saved-search actions align", async ({
  page,
}, info) => {
  await page.goto("/workspace/all-companies/customers");
  const field = page.getByRole("textbox", {
    name: "Search records",
    exact: true,
  });
  await page.mouse.move(0, 0);
  const border = await field.evaluate((el) => getComputedStyle(el).borderColor);
  await field.hover();
  expect(await field.evaluate((el) => getComputedStyle(el).borderColor)).toBe(
    border,
  );
  await page
    .getByRole("button", {
      name: "Quick actions: find anything or run a command",
      exact: true,
    })
    .click();
  const input = page.getByRole("combobox", {
    name: "Search commands and records",
    exact: true,
  });
  const icon = page.locator(".command-search > svg");
  const bounds = await icon.boundingBox(),
    inputBox = await input.boundingBox(),
    pad = await input.evaluate((el) =>
      parseFloat(getComputedStyle(el).paddingLeft),
    );
  expect(inputBox!.x + pad).toBeGreaterThan(bounds!.x + bounds!.width + 4);
  await page.screenshot({ path: info.outputPath("search-spacing.png") });
  await page.keyboard.press("Escape");
  await page.goto("/workspace/all-companies/prospecting");
  await page.getByRole("button", { name: "Save search", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Save prospecting search",
    exact: true,
  });
  expect(
    await dialog
      .locator("form")
      .evaluate((el) => parseFloat(getComputedStyle(el).rowGap)),
  ).toBeGreaterThanOrEqual(16);
  await expect(
    dialog
      .locator(".ui-dialog-footer")
      .getByRole("button", { name: "Save filters", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("save-search-spacing.png") });
});
test("Petronex uses the complete supplied vector for its watermark", async ({
  page,
}, info) => {
  await page.goto("/workspace/all-companies/quotations?record=EC-1008");
  await page
    .getByRole("button", { name: "View document", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Quotation document",
    exact: true,
  });
  await expect(dialog.locator(".pdf-brand-watermark img")).toHaveAttribute(
    "src",
    "/brands/petronex-symbol.svg",
  );
  await expect(dialog.locator(".pdf-company-logo")).toHaveAttribute(
    "src",
    "/brands/petronex.svg",
  );
  await page.screenshot({
    path: info.outputPath("petronex-vector-preview.png"),
  });
});
