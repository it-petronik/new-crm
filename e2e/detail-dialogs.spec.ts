import { test, expect } from "@playwright/test";
import { makePreview } from "../src/lib/fixtures";
import { activityProfile } from "../src/lib/activity-profile";

for (const kind of [
  "leads",
  "orders",
  "logistics",
  "accounts",
  "customers",
  "suppliers",
  "products",
  "hr",
  "leave",
  "marketing",
  "it",
] as const) {
  test(`${kind} record detail and expanded actions`, async ({ page }, info) => {
    const data = makePreview();
    if (kind === "suppliers")
      data.records.push({
        ...data.records.find((r) => r.kind === "customers")!,
        id: "supplier-layout-fixture",
        kind: "suppliers",
        title: "Layout Supplier",
        status: "Active",
      });
    const record = data.records.find((r) => r.kind === kind)!;
    await page.addInitScript(
      (data) =>
        localStorage.setItem("enercore-preview-v1", JSON.stringify(data)),
      data,
    );
    await page.goto(`/?module=${kind === "leave" ? "hr" : kind}`);
    if (kind === "leave")
      await page
        .getByRole("button", { name: "Leave requests", exact: true })
        .click();
    await page
      .getByRole("button", {
        name: new RegExp(record.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.locator(".record-context .company-label")).toBeVisible();
    await expect(
      page.getByText("No notes added yet.", { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`${kind}-detail.png`),
      animations: "disabled",
    });
    if (kind === "orders") {
      expect((await dialog.boundingBox())!.height).toBeLessThan(550);
      await expect(page.locator(".missing-record-fields")).toBeVisible();
      await page.locator(".missing-record-fields summary").click();
      await expect(page.locator(".missing-record-fields p")).toContainText(
        "Contact person",
      );
    }
    const activity = activityProfile(kind);
    if (activity) {
      await page
        .getByRole("button", { name: activity.action, exact: true })
        .click();
      await expect(page.locator(".record-activity textarea")).toBeVisible();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: info.outputPath(`${kind}-expanded-mobile.png`),
      animations: "disabled",
    });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    const footer = await page.locator(".ui-dialog-footer").boundingBox();
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(844);
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(dialog).toBeHidden();
  });
}

test("access editor and quick actions share the bounded dialog shell", async ({
  page,
}, info) => {
  await page.goto("/?view=access");
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  await page.screenshot({
    path: info.outputPath("access-desktop.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("access-mobile.png"),
    animations: "disabled",
  });
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: /Quick actions/ }).click();
  await page.screenshot({
    path: info.outputPath("quick-actions-mobile.png"),
    animations: "disabled",
  });
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});
