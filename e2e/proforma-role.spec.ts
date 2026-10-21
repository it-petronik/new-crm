import { test, expect, type Page } from "@playwright/test";
import { makePreview } from "../src/lib/fixtures";
const hydrated = (page: Page) =>
  page.waitForFunction(() => {
    const el = document.querySelector("#main");
    return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
  });
async function signIn(page: Page, who: string) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: new RegExp(`${who}@enercore.test`) })
    .click();
  await hydrated(page);
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
for (const [who, title] of [
  ["sales", "Sales desk"],
  ["accounts", "Accounts desk"],
  ["hr", "People desk"],
  ["logistics", "Delivery desk"],
  ["it", "Group dashboard"],
]) {
  test(`${who} role-specific home and logo keep session`, async ({ page }) => {
    await signIn(page, who);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    if(who !== "it") await page
      .getByRole("navigation", { name: "Role shortcuts" })
      .getByRole("button")
      .first()
      .click();
    await page.getByRole("link", { name: "Enercore workspace" }).click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
      await expect(page).not.toHaveURL(/login/);
      // Capture every render during a reload, not only the settled screen.
      await page.addInitScript(() => {
        (window as Window & { wrongRolePaint?: boolean }).wrongRolePaint = false;
        new MutationObserver(() => { if ([...document.querySelectorAll("h1")].some(h => /Group dashboard/.test(h.textContent || ""))) (window as Window & { wrongRolePaint?: boolean }).wrongRolePaint = true; }).observe(document, { childList: true, subtree: true });
      });
      await page.reload();
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as Window & { wrongRolePaint?: boolean }).wrongRolePaint)).toBe(who === "it");
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ["light", "dark"]) {
          await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
          await page.waitForTimeout(300);
          await noOverflow(page);
        }
      }
  });
}
for (const width of [390, 1440]) {
  test(`uncarded login in light and dark at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/login");
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await page.waitForTimeout(350);
      await expect(page.locator(".login-box")).toHaveCSS("box-shadow", "none");
      await expect(page.locator(".login-box")).toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
      await noOverflow(page);
      await page.screenshot({
        path: `test-results-proforma/login-${theme}-${width}.png`,
        fullPage: true,
      });
    }
  });
}
test("Accounts can create, print and issue a customer proforma without creating receivables", async ({
  page,
}, info) => {
  const data = makePreview();
  const customer = data.records.find(
    (r) => r.kind === "customers" && r.company === "Petronik",
  )!;
  await page.addInitScript((data) => {
    if (!localStorage.getItem("enercore-preview-v1"))
      localStorage.setItem("enercore-preview-v1", JSON.stringify(data));
  }, data);
  await signIn(page, "accounts");
  await page
    .getByRole("navigation", { name: "Role shortcuts" })
    .getByRole("button", { name: "Accounts", exact: true })
    .click();
  await page.getByRole("button", { name: "New proforma", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New customer proforma" });
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Choose or create a customer");
  const select = dialog.getByRole("combobox", {
    name: "Customer",
    exact: true,
  });
  await select.click();
  await page.getByRole("option", { name: customer.title, exact: true }).click();
  await dialog.getByRole("combobox", { name: "Item 1 product" }).click();
  await dialog
    .getByRole("combobox", { name: "Item 1 product" })
    .pressSequentially("Base Oil SN500", { delay: 30 });
  await expect(
    dialog.getByRole("combobox", { name: "Item 1 product" }),
  ).toHaveValue("Base Oil SN500");
  await dialog
    .getByRole("spinbutton", { name: "Quantity", exact: true })
    .fill("80");
  await expect(
    dialog.getByRole("combobox", { name: "Item 1 product" }),
  ).toHaveValue("Base Oil SN500");
  await dialog
    .getByRole("spinbutton", { name: "Unit price", exact: true })
    .fill("1610");
  await dialog.getByRole("combobox", { name: "Item 1 packaging" }).click();
  await page.getByRole("option", { name: "Flexi Bags", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "Terms & conditions" })
    .fill("Fictional test terms. Delivery subject to confirmation.");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByRole("button", { name: "Create draft proforma" }).click();
  await expect(dialog).toHaveCount(0);
  const proforma = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("enercore-preview-v1")!).records.find(
      (r: { attributes?: { documentType?: string } }) =>
        r.attributes?.documentType === "proforma",
    ),
  );
  expect(proforma).toBeTruthy();
  expect(proforma.amount).toBe(128800);
  await page.goto(`/workspace/all-companies/accounts?record=${proforma.id}`);
  await expect(
    page.getByText("Draft for Accounts review.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Outstanding balance", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "View document", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("PROFORMA INVOICE", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".rw-header")).toBeHidden();
  await expect(page.locator(".quote-details-grid")).toBeHidden();
  await expect(page.locator(".reference-document")).toBeVisible();
  const pdf = await page.pdf({
    path: info.outputPath("customer-proforma.pdf"),
    printBackground: true,
    preferCSSPageSize: true,
  });
  expect(
    (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length,
  ).toBe(1);
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("combobox", { name: "Update status" }).click();
  await page.getByRole("option", { name: "Issued", exact: true }).click();
  await expect(
    page.getByText("Issued by Daniel Banda.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit record", exact: true }),
  ).toHaveCount(0);
});
test("mobile dark proforma form uses theme surfaces and fits the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "accounts");
  await page
    .getByRole("navigation", { name: "Role shortcuts" })
    .getByRole("button", { name: "Accounts", exact: true })
    .click();
  await page.getByRole("button", { name: "New proforma", exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.waitForTimeout(350);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await noOverflow(page);
  const colors = await dialog
    .locator('input[name="contact"]')
    .evaluate((el) => ({
      color: getComputedStyle(el).color,
      background: getComputedStyle(el).backgroundColor,
    }));
  expect(colors.background).not.toBe("rgb(255, 255, 255)");
  expect(colors.color).not.toBe(colors.background);
  await page.screenshot({
    path: "test-results-proforma/proforma-dark-mobile.png",
  });
});
