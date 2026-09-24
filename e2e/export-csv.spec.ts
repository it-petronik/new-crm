import { test, expect } from "@playwright/test";

test("a filtered list exports exactly what it shows, as safe CSV", async ({ page }) => {
  await page.goto("/workspace/all-companies/sales-orders");
  await expect(page.getByRole("button", { name: /^Export/ })).toBeEnabled();

  // Export the unfiltered list first, to know the full count.
  const all = await page.getByRole("button", { name: /^Export/ }).getAttribute("title");
  const total = Number(all?.match(/Export (\d+)/)?.[1] ?? 0);
  expect(total).toBeGreaterThan(0);

  // Narrow the list; the export must follow the filter, not the whole table.
  await page.getByLabel("Search records").fill("zzz-no-such-record");
  await expect(page.getByRole("button", { name: /^Export/ })).toBeDisabled();

  await page.getByLabel("Search records").fill("");
  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Export/ }).click(),
  ]).then(([d]) => d);

  expect(download.suggestedFilename()).toMatch(/^[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.csv$/);

  const body = await download.createReadStream().then(async (s) => {
    const chunks: Buffer[] = [];
    for await (const c of s) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  });

  // BOM, so Excel reads UTF-8 rather than the local code page.
  expect(body.charCodeAt(0)).toBe(0xfeff);
  const lines = body.replace(/^﻿/, "").split("\r\n");
  expect(lines[0]).toContain("Reference,Status,Company,Branch,Created");
  expect(lines.length - 1).toBe(total);
  // No cell may begin with a character a spreadsheet would execute.
  for (const line of lines.slice(1))
    for (const cell of line.split(","))
      expect(cell.replace(/^"/, "")).not.toMatch(/^[=+@]/);
});
