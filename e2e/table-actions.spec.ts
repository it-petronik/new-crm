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
test("lead headers sort in both directions, key tools are direct and selection exports only chosen rows", async ({
  page,
}, info) => {
  await page.goto("/workspace/all-companies/sales-pipeline");
  const table = page
    .getByRole("region", { name: "Lead Desk", exact: true })
    .getByRole("table")
    .first();
  await expect(page.getByRole("combobox", { name: /^Sort / })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Tools", exact: true }),
  ).toHaveCount(0);
  for (const name of [
    "Import",
    "Export Excel",
    "Refresh",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  const header = table.getByRole("columnheader", {
    name: "Lead / company",
    exact: true,
  });
  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  const titles = (
    await table
      .locator("[data-lead-row] [class*=identity] button")
      .allTextContents()
  ).map((t) => t.trim());
  expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
  await table
    .getByRole("checkbox", { name: `Select ${titles[0]}`, exact: true })
    .check();
  await expect(
    page.getByRole("region", { name: "Selected row actions" }),
  ).toContainText("1 selected");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export selected", exact: true })
    .click();
  const file = await download,
    path = info.outputPath("selected-leads.xlsx");
  await file.saveAs(path);
  const xml = (await readFile(path)).toString("utf8");
  expect(xml).toContain(titles[0]);
  for (const other of titles.slice(1)) expect(xml).not.toContain(other);
  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", "descending");
  await expect(
    page.getByRole("region", { name: "Selected row actions" }),
  ).toContainText("1 selected");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.screenshot({ path: info.outputPath(`lead-table-${theme}.png`) });
  }
  await page
    .getByRole("searchbox", { name: "Search leads or product grade" })
    .fill("no-matching-company");
  await expect(
    page.getByRole("region", { name: "Selected row actions" }),
  ).toHaveCount(0);
});
test("page selection is limited to the visible page; delete is confirmed, audited and browser-local", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const key = "enercore-preview-v1",
      data = JSON.parse(localStorage.getItem(key)!);
    const seed = data.records.find(
      (r: { kind: string }) => r.kind === "customers",
    );
    data.records.push(
      ...Array.from({ length: 15 }, (_, i) => ({
        ...seed,
        id: `table-review-${i}`,
        title: `Review customer ${String(i).padStart(2, "0")}`,
      })),
    );
    localStorage.setItem(key, JSON.stringify(data));
  });
  let writes = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/records") && r.method() !== "GET") writes++;
  });
  await page.goto("/workspace/all-companies/customers");
  const table = page.getByRole("table");
  const first = await table.locator("tbody .e-row-title").allTextContents();
  await table
    .getByRole("checkbox", {
      name: "Select all records on this page",
      exact: true,
    })
    .check();
  await expect(
    page.getByRole("region", { name: "Selected row actions" }),
  ).toContainText("10 selected");
  await page
    .getByRole("button", { name: "Next records page", exact: true })
    .click();
  expect(await table.locator("tbody input:checked").count()).toBe(0);
  await page
    .getByRole("button", { name: "Delete selected", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Delete selected records?",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Selected row actions" }),
  ).toContainText("10 selected");
  await page
    .getByRole("button", { name: "Delete selected", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Delete selected records?",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Delete 10 records", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Deletion result", exact: true }),
  ).toContainText("10 records removed");
  await page.screenshot({ path: info.outputPath("bulk-delete-result.png") });
  await page
    .getByRole("dialog", { name: "Deletion result", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("enercore-preview-v1")!),
  );
  for (const title of first)
    expect(
      stored.records.find((r: { title: string }) => r.title === title)
        .deletedAt,
    ).toBeTruthy();
  expect(
    stored.audit.filter((a: { action: string }) =>
      a.action.startsWith("Deleted customers"),
    ).length,
  ).toBe(10);
  expect(writes).toBe(0);
});
test("protected commercial records support selected export but not bulk delete", async ({
  page,
}) => {
  await page.goto("/workspace/all-companies/sales-orders");
  const table = page.getByRole("table").first();
  await table
    .getByRole("checkbox", {
      name: "Select all records on this page",
      exact: true,
    })
    .check();
  const bar = page.getByRole("region", { name: "Selected row actions" });
  await expect(
    bar.getByRole("button", { name: "Export selected", exact: true }),
  ).toBeVisible();
  await expect(
    bar.getByRole("button", { name: "Delete selected", exact: true }),
  ).toHaveCount(0);
  await expect(bar).toContainText("protected from deletion");
});
test("compact import picker exposes template, previews before any write, and fits cleanly", async ({
  page,
}, info) => {
  let writes = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/records") && r.method() !== "GET") writes++;
  });
  await page.goto("/workspace/all-companies/sales-pipeline");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Import leads from CSV",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Download template", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Choose file", exact: true }),
  ).toBeVisible();
  expect(
    await dialog
      .locator(".import-columns")
      .evaluate((el) => (el as HTMLDetailsElement).open),
  ).toBe(false);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.screenshot({ path: info.outputPath(`import-${theme}.png`) });
  }
  await dialog
    .getByLabel("CSV file", { exact: true })
    .setInputFiles({
      name: "review.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("title\nReview inquiry\n"),
    });
  await expect(dialog.getByText("review.csv", { exact: true })).toBeVisible();
  expect(writes).toBe(0);
});
