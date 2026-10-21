import { test, expect, type Page } from "@playwright/test";
import { makePreview, previewActor } from "../src/lib/fixtures";

async function start(page: Page, path="sales-pipeline", theme="light") {
  await page.addInitScript(({data,actor,theme})=>{
    localStorage.setItem("enercore-preview-v1",JSON.stringify(data));
    localStorage.setItem("enercore-preview-actor",JSON.stringify(actor));
    localStorage.setItem("enercore-theme",theme);
  },{data:makePreview(),actor:previewActor,theme});
  await page.goto(`/workspace/all-companies/${path}`);
  await expect(page.locator("#main h1").first()).toBeVisible();
  await expect(page.locator(".skeleton-region")).toHaveCount(0);
}

test("quiet page headings and account utilities remain accessible by keyboard",async({page})=>{
  await start(page);
  await expect(page.getByRole("button",{name:"Open Enercore AI",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Switch to dark mode",exact:true})).toHaveCount(0);
  await expect(page.locator('[data-ui="page-header"] > div > p')).toHaveCount(0);
  const help=page.getByRole("button",{name:"How this page works",exact:true});await help.click();
  await expect(page.locator('.ui-guide-popover')).toContainText("How this page works");await page.keyboard.press("Escape");await expect(help).toBeFocused();
  const account=page.getByRole("button",{name:"Account menu",exact:true});await account.focus();await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem",{name:"My profile",exact:true})).toBeFocused();
  await page.keyboard.press("s");await expect(page.getByRole("menuitem",{name:"Switch to dark mode",exact:true})).toBeFocused();
  await page.keyboard.press("Enter");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");await expect(account).toBeFocused();
  await account.click();await page.getByRole("menuitem",{name:"My profile",exact:true}).click();await expect(page.getByRole("heading",{name:"My profile",exact:true})).toBeVisible();
});

test("lead worklist has compact rows and updates in a focused drawer in both themes",async({page},info)=>{
  await start(page);
  const desk=page.getByRole("region",{name:"Lead Desk",exact:true});
  const measurements:unknown[]=[];
  for(const width of [1440,768,360])for(const theme of ["light","dark"]) {
    await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const rows=desk.locator('[data-lead-row]');await expect(rows.first()).toBeVisible();
    const sizes=await rows.evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height));
    expect(Math.max(...sizes),`lead rows ${width}`).toBeLessThanOrEqual(width>1150?80:150);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await expect(page.getByRole("combobox",{name:"Lead workspace view",exact:true})).toHaveCount(0);
    measurements.push({width,theme,rowHeights:sizes});
    await page.screenshot({path:info.outputPath(`worklist-${theme}-${width}.png`)});
  }
  const update=desk.getByRole("button",{name:"Update / feedback",exact:true}).first();await update.click();
  const drawer=page.getByRole("dialog",{name:"Lead update",exact:true});await expect(drawer).toBeVisible();await expect(drawer.getByRole("combobox",{name:"Conversation outcome",exact:true})).toBeVisible();
  expect((await drawer.boundingBox())!.width).toBeLessThanOrEqual(360);
  await expect(drawer.locator('[aria-invalid="true"]')).toHaveCount(0);
  await expect(drawer.getByRole("button",{name:"Close dialog",exact:true})).toBeFocused();
  await page.screenshot({path:info.outputPath("feedback-mobile-dark.png")});await page.keyboard.press("Escape");await expect(drawer).toHaveCount(0);await expect(update).toBeFocused();
  await page.setViewportSize({width:1440,height:1000});await update.click();
  expect((await drawer.boundingBox())!.width).toBeLessThanOrEqual(480);
  await page.screenshot({path:info.outputPath("feedback-desktop-dark.png")});
  await info.attach("worklist-density",{body:JSON.stringify(measurements,null,2),contentType:"application/json"});
});

test("phone directories use two-row entries without a redundant updated-date block",async({page},info)=>{
  await page.setViewportSize({width:360,height:1000});await start(page,"customers","dark");
  await page.getByRole("combobox",{name:"Display records as",exact:true}).click();await page.getByRole("option",{name:/^List view$/i}).click();
  const rows=page.locator('table[data-reference-list] tbody tr');await expect(rows.first()).toBeVisible();
  // Two toolbar rows: search + tools, then status + view. Keep normal
  // phone text and tap targets instead of shrinking them to force a fit.
  const search=await page.getByRole("textbox",{name:"Search records",exact:true}).boundingBox();
  const tools=await page.getByRole("button",{name:"More actions for records list",exact:true}).boundingBox();
  const status=await page.getByRole("combobox",{name:"records status",exact:true}).boundingBox();
  const layout=await page.getByRole("combobox",{name:"Display records as",exact:true}).boundingBox();
  expect(Math.abs(search!.y-tools!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(status!.y-layout!.y)).toBeLessThanOrEqual(1);
  for(const row of await rows.all()) {
    expect((await row.boundingBox())!.height).toBeLessThanOrEqual(145);
    await expect(row.locator(".e-cell-next")).toBeHidden();
    await expect(row.getByRole("button",{name:/More actions for/})).toBeVisible();
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath("directory-mobile-dark.png")});
});

test("the pipeline board stays available through Tools without a permanent extra selector",async({page})=>{
  await start(page);
  await page.getByRole("button",{name:"More actions for Lead Desk",exact:true}).click();
  await page.getByRole("menuitem",{name:"View pipeline",exact:true}).click();
  await expect(page.getByRole("region",{name:"Lead Desk",exact:true})).toHaveCount(0);
  await expect(page.locator("#main h1")).toHaveText("Sales pipeline");
  const view=page.getByRole("combobox",{name:"Lead workspace view",exact:true});
  await expect(view).toContainText("Pipeline");await view.click();
  await page.getByRole("option",{name:"Lead Desk",exact:true}).click();
  await expect(page.locator("#main h1")).toHaveText("Lead Desk");
  await expect(view).toHaveCount(0);
});

test("sign-in and password recovery stay readable and neutral at all three screen sizes",async({page},info)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  for(const route of ["login","reset-password"]) {
    await page.goto(`/${route}`);await expect(page.locator(".login-box")).toBeVisible();
    for(const width of [360,768,1440])for(const theme of ["light","dark"]) {
      await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await expect(page.locator('[aria-invalid="true"],.login-box [role="alert"]')).toHaveCount(0);
      const fields=await page.locator(".login-box input").evaluateAll(inputs=>inputs.map(input=>({color:getComputedStyle(input).color,background:getComputedStyle(input).backgroundColor,font:parseFloat(getComputedStyle(input).fontSize)})));
      expect(fields.length).toBeGreaterThan(0);
      for(const field of fields){expect(field.color).not.toBe(field.background);if(theme==="dark")expect(field.background).not.toBe("rgb(255, 255, 255)");}
      await page.screenshot({path:info.outputPath(`${route}-${theme}-${width}.png`)});
    }
  }
  expect(errors).toEqual([]);
});
