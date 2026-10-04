import { test, expect } from "@playwright/test";

test("shared surfaces and controls follow light, dark and accent palettes", async ({ page }) => {
  await page.goto("/workspace/all-companies/sales-pipeline");
  await expect(page.locator(".kanban")).toBeVisible();
  for (const theme of ["light", "dark"]) {
    for (const palette of ["ocean", "violet", "rose"]) {
      await page.evaluate(({ theme, palette }) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.palette = palette;
        window.dispatchEvent(new Event("enercore-theme"));
      }, { theme, palette });
      await page.waitForTimeout(250);
      const colors = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const color = (selector: string, property: string) => getComputedStyle(document.querySelector(selector)!).getPropertyValue(property);
        const resolve = (value: string) => {
          const probe = document.createElement("span");
          probe.style.color = value;
          document.body.append(probe);
          const result = getComputedStyle(probe).color;
          probe.remove();
          return result;
        };
        return {
          board: color(".kanban", "background-color"),
          column: color(".kanban-column", "background-color"),
          surface: resolve(root.getPropertyValue("--surface")),
          soft: resolve(root.getPropertyValue("--soft")),
          primary: color(".page-heading .primary", "background-color"),
          action: resolve(root.getPropertyValue("--brand-action")),
        };
      });
      expect([colors.surface, colors.soft]).toContain(colors.board);
      expect(colors.column).toBe(colors.soft);
      expect(colors.primary).toBe(colors.action);
    }
  }
  await page.getByRole("button", { name: "Quick add", exact: true }).hover();
  await expect(page.locator(".ui-tooltip").first()).toBeVisible();
  const tooltip = await page.locator(".ui-tooltip").first().evaluate(el => {
    const styles = getComputedStyle(el);
    return { background: styles.backgroundColor, text: styles.color };
  });
  expect(tooltip.background).not.toBe("rgb(25, 60, 50)");
  expect(tooltip.background).not.toBe(tooltip.text);
  await page.screenshot({ path: "test-results/theme-consistency-dark.png" });
});

test("quotation header and document dialog fit desktop and phone", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace/all-companies/quotations");
    await page.getByRole("button", { name: "Open Gulf Industrial Trading", exact: true }).click();
    const view = page.getByRole("button", { name: "View document", exact: true });
    await expect(view).toBeVisible();
    expect(await view.evaluate(el => !!el.closest(".rw-actions"))).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await view.click();
    const dialog = page.getByRole("dialog", { name: "Quotation document", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Print / Save PDF", exact: true })).toBeVisible();
    await page.waitForTimeout(250);
    const rect = (await dialog.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/quotation-preview-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(view).toBeFocused();
  }
});

test("quotation details hide the document until requested and editing groups optional fields", async ({ page }) => {
  await page.goto("/workspace/all-companies/quotations");
  await page.getByRole("button", { name: "Open Gulf Industrial Trading", exact: true }).click();
  await expect(page.getByRole("region", { name: "Quotation details", exact: true })).toBeVisible();
  await expect(page.locator(".quotation-print-only")).not.toBeVisible();
  await page.getByRole("button", { name: "View document", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Quotation document", exact: true });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("article", { name: "Quotation document" })).toBeVisible();
  await preview.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Edit record", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit quotation", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".form-more")).not.toHaveAttribute("open", "");
  await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/quotation-editor-compact.png" });
});

test("CSV import has a compact styled file chooser", async ({ page }) => {
  await page.goto("/workspace/all-companies/sales-pipeline");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import leads from CSV" });
  await expect(dialog.locator(".import-file-zone")).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(620);
  await expect(dialog.locator('input[type="file"]')).toBeFocused();
  await page.screenshot({ path: "test-results/import-dialog-compact.png" });
});

test("record details lead with the overview, ahead of activity on mobile", async ({ page }) => {
  await page.goto("/workspace/all-companies/sales-pipeline");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await page.getByRole("button", { name: "Open Gulf Industrial Trading", exact: true }).click();
  const overview = page.getByRole("region", { name: "Record overview", exact: true });
  await expect(overview).toContainText("Omar Hassan");
  await expect(overview).toContainText("Base Oil");
  await page.setViewportSize({ width: 390, height: 844 });
  const activity = page.getByRole("region", { name: "Updates and activity", exact: true });
  expect((await activity.boundingBox())!.y).toBeGreaterThan((await overview.boundingBox())!.y);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("record tables keep controls inside their columns at desktop and mobile sizes", async ({ page }) => {
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const module of ["products", "quotations", "accounts", "sales-pipeline"]) {
      await page.goto(`/workspace/all-companies/${module}`);
      await expect(page.getByText("Interactive preview")).toBeVisible();
      if (module === "sales-pipeline") await page.getByRole("button", { name: "List view", exact: true }).click();
      const table = page.locator(".e-table-balanced");
      await expect(table).toBeVisible();
      const issues = await table.evaluate((table) => {
        const frame = table.parentElement!;
        const rect = frame.getBoundingClientRect();
        return {
          overflow: frame.scrollWidth - frame.clientWidth,
          clipped: [...table.querySelectorAll("button, [role=combobox]")].filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.left < rect.left - 1 || r.right > rect.right + 1);
          }).length,
        };
      });
      expect(issues, `${module} at ${width}`).toEqual({ overflow: 0, clipped: 0 });
      if (module === "products") await expect(table).not.toContainText("Follow up");
    }
  }
});

test("quick add is compact, explains the save target and saves a minimal lead", async ({ page }) => {
  await page.goto("/workspace/all-companies/sales-pipeline");
  await expect(page.getByText("Interactive preview")).toBeVisible();
  await page.getByRole("button", { name: "Quick add", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Quick add", exact: true });
  await expect(dialog.locator('[name="name"]')).toBeFocused();
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(640);
  await expect(dialog).toContainText("Will save to PETRONIK FZCO");
  await dialog.locator('[name="name"]').fill("Quick layout test customer");
  await dialog.getByRole("button", { name: "Save lead", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Quick layout test customer", { exact: true })).toBeVisible();
});

test("all company brand files load", async ({ page }) => {
  await page.goto("/workspace/all-companies/overview");
  for (const file of ["enercore.png", "petronik.png", "afrilube.png", "petronex.png", "istanergy.svg"]) {
    const loaded = await page.evaluate(async (file) => {
      const image = new Image();
      image.src = `/brands/${file}`;
      try { await image.decode(); return image.naturalWidth > 0; } catch { return false; }
    }, file);
    expect(loaded, file).toBe(true);
  }
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.request().method() === "GET" ? route.continue() : route.abort());
});

test("first-time guidance explains the page and expanded navigation", async ({ page }) => {
  await page.goto("/workspace/all-companies/sales-pipeline");
  await expect(page.getByText("Interactive preview")).toBeVisible();
  await page.getByText("How this page works", { exact: true }).click();
  await expect(page.getByText("A lead is a possible sale: someone asking about a product.", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("button", { name: "Quotations", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText("not a confirmed sale");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "test-results/friendly-desktop.png", fullPage: true });
});

test("field help supports keyboard and never submits or discards the form", async ({ page }) => {
  await page.goto("/workspace/all-companies/sales-pipeline");
  await expect(page.getByText("Interactive preview")).toBeVisible();
  await page.getByRole("button", { name: "New lead", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New lead", exact: true });
  await dialog.getByRole("textbox", { name: "Customer / company" }).fill("Unfinished customer");
  const help = dialog.getByRole("button", { name: "About Next follow-up", exact: true });
  await help.focus();
  await expect(page.getByRole("tooltip")).toContainText("not the delivery date");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Close explanation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Customer / company" })).toHaveValue("Unfinished customer");
  await expect(help).toBeFocused();
});

test("touch help fits a narrow dark-mode screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("enercore-theme", "dark"));
  await page.goto("/workspace/all-companies/sales-pipeline");
  await expect(page.getByText("Interactive preview")).toBeVisible();
  await page.getByRole("button", { name: "New lead", exact: true }).click();
  await page.getByRole("button", { name: "About Business entity", exact: true }).click();
  const explanation = page.locator(".ui-help-popover");
  await expect(explanation).toBeVisible();
  const box = await explanation.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/friendly-mobile-dark.png", fullPage: true });
  await page.getByRole("button", { name: "Close explanation" }).click();
  await expect(explanation).toHaveCount(0);
});

test("business pages keep a compact guide and no page-wide overflow", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["sales-pipeline", "quotations", "sales-orders", "logistics", "accounts", "customers", "suppliers", "products", "people-hr", "marketing", "it-support"]) {
      await page.goto(`/workspace/all-companies/${route}`);
      await expect(page.getByText("Interactive preview")).toBeVisible();
      await expect(page.locator(".ui-page-guide")).toBeVisible();
      await expect(page.locator(".ui-page-guide")).not.toHaveAttribute("open", "");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${route} at ${width}px`).toBe(true);
    }
  }
});

test("labelled row actions still open their menu", async ({ page }) => {
  await page.goto("/workspace/all-companies/customers");
  await expect(page.getByText("Interactive preview")).toBeVisible();
  const more = page.getByRole("button", { name: /^More actions for / }).first();
  await expect(more).toContainText("More");
  await more.click();
  await expect(page.locator(".row-overflow-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".row-overflow-menu")).toHaveCount(0);
});

test("collapsed sidebar reserves separate space for logo, toggle and navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/workspace/all-companies/sales-pipeline");
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  const sidebar = page.locator(".desktop-sidebar");
  await expect(sidebar).toHaveCSS("width", "64px");
  const logo = await sidebar.locator(".brand").boundingBox();
  const toggle = await page.getByRole("button", { name: "Expand sidebar", exact: true }).boundingBox();
  const overview = await sidebar.getByRole("button", { name: "Overview", exact: true }).boundingBox();
  expect(toggle!.y).toBeGreaterThanOrEqual(logo!.y + logo!.height);
  expect(overview!.y).toBeGreaterThanOrEqual(toggle!.y + toggle!.height);
  await page.screenshot({ path: "test-results/sidebar-spacing.png", fullPage: true });
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeVisible();
});

test("optional form controls align equally with and without help icons", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/workspace/all-companies/sales-pipeline");
  await page.getByRole("button", { name: "New lead", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New lead", exact: true });
  await dialog.locator("summary").click();
  const source = await dialog.getByRole("combobox", { name: "Lead source", exact: true }).boundingBox();
  const email = await dialog.getByRole("textbox", { name: "Email", exact: true }).boundingBox();
  expect(Math.abs(source!.y - email!.y)).toBeLessThanOrEqual(1);
  const phone = await dialog.getByRole("textbox", { name: "Phone", exact: true }).boundingBox();
  const country = await dialog.getByRole("textbox", { name: "Destination country", exact: true }).boundingBox();
  expect(Math.abs(phone!.y - country!.y)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/form-spacing.png", fullPage: true });
});

test("My requests shares panel gutters and fits desktop and mobile", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/my-requests");
    await expect(page.getByRole("heading", { name: "My requests", exact: true })).toBeVisible();
    const heading = await page.getByRole("heading", { name: "New request", exact: true }).boundingBox();
    const input = await page.locator('.request-form [name="title"]').boundingBox();
    expect(Math.abs(heading!.x - input!.x)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "IT support", exact: true }).last().click();
    await expect(page.locator('.request-form [name="title"]')).toHaveAttribute("placeholder", "Describe the problem");
    await page.screenshot({ path: `test-results/requests-spacing-${width}.png`, fullPage: true });
  }
});
