import {test,expect} from "@playwright/test";
test("friendly URLs reload, users open profiles and charts respond",async({page})=>{
  // Business analysis is collapsed by default; open it as a person would.
  await page.addInitScript(() => localStorage.setItem("enercore-dashboard-analysis", "open"));
  await page.goto("/?view=access&company=All%20companies");
  await expect(page).toHaveURL(/\/workspace\/all-companies\/access-control$/);
  await page.reload();
  await page.getByRole("button",{name:"Leila Ahmed",exact:true}).click();
  await expect(page.locator(".access-profile")).toContainText("leila@example.invalid");
  await page.getByRole("button",{name:"← Back to users",exact:true}).click();
  await page.goto("/workspace/all-companies/overview");
  await page.locator(".chart-horizontal button").first().click();
  await expect(page.locator(".chart-horizontal .chart-selection")).toBeVisible();
  await page.locator(".chart-segment").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".chart-donut .chart-selection").first()).toBeVisible();
  await page.locator(".bar.orders").first().click();
  await expect(page).toHaveURL(/sales-orders$/);
  await page.goBack();
  await expect(page.locator(".business-insights")).toBeVisible();
});
