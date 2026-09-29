import { test, expect, type Page } from "@playwright/test";

/**
 * The shared dialog footer rule (DialogActions):
 *
 *   [start: contextual / destructive]        [Cancel] [secondary] [Primary]
 *
 * Primary is always the last, rightmost button; a destructive action that is
 * not the dialog's purpose sits in the left zone; a confirmation's destructive
 * act is its primary. The order holds on a phone too.
 */

const zones = (page: Page) =>
  // The open dialog's footer: a closing dialog lingers for its exit
  // animation, and must not be read instead.
  page.locator('[role="dialog"][data-state="open"] .ui-dialog-footer').evaluate((footer) => {
    const names = (sel: string) =>
      // Rendered text (innerText): the primary's reserved-width pending label
      // is visibility:hidden and aria-hidden, so it is not part of the name.
      [...footer.querySelectorAll<HTMLElement>(`${sel} .ui-button`)].map((b) => (b.getAttribute("aria-label") || b.innerText || "").trim());
    const end = footer.querySelector(".ui-dialog-actions-end")!.getBoundingClientRect();
    const start = footer.querySelector(".ui-dialog-actions-start")?.getBoundingClientRect();
    const buttons = [...footer.querySelectorAll(".ui-dialog-actions-end .ui-button")].map((b) => b.getBoundingClientRect());
    return {
      start: names(".ui-dialog-actions-start"),
      end: names(".ui-dialog-actions-end"),
      // The primary is also visually rightmost.
      primaryRightmost: buttons.length > 0 && buttons.every((b) => b.right <= buttons.at(-1)!.right + 0.5),
      endRightOfStart: !start || start.width === 0 || end.right >= start.right,
    };
  });

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`dialog actions follow one rule at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);

    // Create: [Cancel] [Create customer].
    await page.goto("/?module=customers");
    await page.getByRole("button", { name: "Add customer", exact: true }).click();
    let z = await zones(page);
    expect(z.end).toEqual(["Cancel", "Create customer"]);
    expect(z.primaryRightmost).toBe(true);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    // A record is a page, not a dialog: its primary is the rightmost header
    // action (only More sits after it), and Delete waits behind More.
    await page.locator(".record-card-shell > button, .table-scroll .record-link").first().click();
    const header = page.locator(".rw-actions");
    await expect(header).toBeVisible();
    const order = await header.evaluate((el) => {
      const buttons = [...el.querySelectorAll<HTMLElement>(":scope > .ui-button")];
      const primary = el.querySelector<HTMLElement>(".rw-primary")!;
      const rights = buttons.filter((b) => b !== primary && !b.matches('[aria-label^="More actions"]')).map((b) => b.getBoundingClientRect().right);
      return {
        primary: primary.innerText.trim(),
        rightOfOthers: rights.every((r) => r <= primary.getBoundingClientRect().right + 0.5),
        noDeleteInHeader: !buttons.some((b) => /^Delete/.test(b.innerText.trim())),
      };
    });
    expect(order.primary).toBe("Edit record");
    expect(order.rightOfOthers).toBe(true);
    expect(order.noDeleteInHeader).toBe(true);

    // Confirmation: [Cancel] [Delete record] — the confirmed act is primary.
    await header.getByRole("button", { name: /^More actions for / }).click();
    await page.locator(".row-overflow-item.is-destructive", { hasText: "Delete record" }).click();
    await expect(page.getByRole("heading", { name: "Delete record?" })).toBeVisible();
    z = await zones(page);
    expect(z.start).toEqual([]);
    expect(z.end).toEqual(["Cancel", "Delete record"]);
    expect(z.primaryRightmost).toBe(true);
  });
}
