import { test, expect } from "@playwright/test";
import { makePreview, previewActor } from "../src/lib/fixtures";
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(
    ({ data, actor }) => {
      localStorage.setItem("enercore-preview-v1", JSON.stringify(data));
      localStorage.setItem("enercore-preview-actor", JSON.stringify(actor));
    },
    { data: makePreview(), actor: previewActor },
  );
});
test("currency shares the top toolbar; department tabs show scoped detail and sortable work", async ({
  page,
}, info) => {
  await page.goto("/workspace/all-companies/overview");
  const header = page.locator('[data-ui="page-header"]').first();
  await expect(
    header.getByRole("combobox", { name: "Dashboard currency" }),
  ).toBeVisible();
  await expect(
    page.getByText("Business snapshot", { exact: true }),
  ).toHaveCount(0);
  const hub = page.getByRole("region", {
    name: "Department and employee overview",
    exact: true,
  });
  for (const dept of [
    "sales",
    "logistics",
    "accounts",
    "marketing",
    "hr",
    "it",
  ]) {
    await hub.locator(`[data-department-tab="${dept}"]`).click();
    const detail = hub.locator(`[data-department-detail="${dept}"]`);
    await expect(detail).toBeVisible();
    await expect(detail.locator(":scope > dl > div")).toHaveCount(4);
    await expect(
      detail.getByRole("textbox", { name: "Search department records" }),
    ).toBeVisible();
    await detail.getByRole("button", { name: "Status", exact: true }).click();
    await expect(
      detail.getByRole("columnheader", { name: "Status", exact: true }),
    ).toHaveAttribute("aria-sort", "ascending");
    await page.screenshot({ path: info.outputPath(`department-${dept}.png`) });
  }
});
test("Apollo pages keep the same full width and a compact search in both themes", async ({
  page,
}, info) => {
  await page.goto("/workspace/all-companies/prospecting");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    const sizes = [];
    for (const tab of ["Search", "Saved searches", "Credits & usage"]) {
      await page
        .getByRole("group", { name: "Prospecting sections" })
        .getByRole("button", { name: tab, exact: true })
        .click();
      const root = page.locator(".prospecting-workspace");
      sizes.push((await root.boundingBox())!.width);
      expect(
        await root.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`apollo-${tab.replace(/\W/g, "-")}-${theme}.png`),
      });
    }
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(2);
  }
});
test("company icons fit the controls and menus highlight on pointer hover", async ({
  page,
}) => {
  await page.goto("/workspace/petronik/suppliers");
  const company = page.getByRole("combobox", { name: "Company", exact: true });
  const mark = page.locator(".heading-actions .brand-logo");
  expect((await mark.boundingBox())!.height).toBeLessThanOrEqual(22);
  await expect(company).toContainText("Petronik");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await company.click();
    const option = page.getByRole("option", { name: "Afrilube", exact: true });
    const prior = await option.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    await option.hover();
    expect(
      await option.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).not.toBe(prior);
    await page.keyboard.press("Escape");
  }
});
test("PDF header uses full artwork and fit width never clips the sheet", async ({
  page,
}, info) => {
  await page.goto("/workspace/all-companies/quotations?record=EC-1007");
  await page
    .getByRole("button", { name: "View document", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Quotation document",
    exact: true,
  });
  for (const width of [720, 1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const stage = dialog.locator(".document-preview-stage");
    await expect(stage).toHaveAttribute("data-preview-mode", "fit");
    await expect(async () =>
      expect(
        await stage.evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
      ).toBe(true),
    ).toPass();
    await expect(async()=>{
      const paper=await dialog.locator(".document-preview-space").boundingBox();
      const frame=await stage.boundingBox();
      expect(Math.abs(frame!.width-paper!.width)).toBeLessThan(4);
    }).toPass();
    const logo = dialog.locator(".pdf-company-logo");
    await expect(logo).toHaveJSProperty("tagName", "IMG");
    await expect(logo).toHaveAttribute("src", "/brands/petronik.png");
    const box = (await logo.boundingBox())!;
    expect(box.width / box.height).toBeGreaterThan(2);
    await page.screenshot({
      path: info.outputPath(`quotation-fit-${width}.png`),
    });
  }
  await dialog
    .getByRole("button", { name: "Actual Size", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Fit To Width", exact: true })
    .click();
  await expect(dialog.locator(".document-preview-stage")).toHaveAttribute(
    "data-preview-mode",
    "fit",
  );
});
test("record actions highlight on hover in both themes", async ({ page }) => {
  await page.goto("/workspace/petronik/sales-orders?record=EC-1010");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page
      .getByRole("button", { name: /More actions for Coastal Energy Partners/ })
      .click();
    const item = page.getByRole("menuitem", {
      name: "Pin for quick access",
      exact: true,
    });
    const before = await item.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    await item.hover();
    expect(
      await item.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).not.toBe(before);
    await page.keyboard.press("Escape");
  }
});
test("page AI shortcuts are contextual and never call Groq or Apollo from preview", async ({
  page,
}) => {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /api\/(ai|prospecting)/.test(r.url()))
      posts.push(r.url());
  });
  await page.goto("/workspace/all-companies/people-hr");
  await page
    .getByRole("button", { name: "Ask Enercore AI", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Prioritise follow-ups", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message Enercore AI" }),
  ).toHaveValue("Which leads need attention now?");
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
  expect(posts).toEqual([]);
});
