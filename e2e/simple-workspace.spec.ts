import { test, expect, type Page, type Locator } from "@playwright/test";
import { makePreview, previewActor } from "../src/lib/fixtures";

async function choose(page: Page, root: Page | Locator, label: string, value: string) {
  await root.getByRole("combobox",{name:label,exact:true}).click();
  await page.getByRole("option",{name:new RegExp(`^${value}$`,"i")}).click();
}
async function load(page: Page, path="sales-pipeline", dark=false) {
  await page.addInitScript(({data,actor,dark})=>{
    if(!localStorage.getItem("enercore-preview-v1")) localStorage.setItem("enercore-preview-v1",JSON.stringify(data));
    localStorage.setItem("enercore-preview-actor",JSON.stringify(actor));
    localStorage.setItem("enercore-theme",dark?"dark":"light");
  },{data:makePreview(),actor:previewActor,dark});
  await page.goto(`/workspace/all-companies/${path}`);
  await expect(page.locator("#main h1").first()).toBeVisible();
  await expect(page.locator(".skeleton-region")).toHaveCount(0);
}

test("lead queues are a single choice, tools work with keys, rows use flat dividers",async({page},info)=>{
  await load(page);
  const desk=page.getByRole("region",{name:"Lead Desk",exact:true});
  await expect(desk.getByRole("combobox",{name:"Show leads",exact:true})).toBeVisible();
  for(const label of ["Assigned to me","Created by me","Follow up today","All leads","Export weekly report","Assign salesperson"])
    await expect(desk.getByRole("button",{name:label,exact:true})).toHaveCount(0);
  const trigger=desk.getByRole("button",{name:"More actions for Lead Desk",exact:true});
  await trigger.focus();await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem",{name:"Manage team",exact:true})).toBeFocused();
  await page.keyboard.press("End");await expect(page.getByRole("menuitem",{name:"More numbers",exact:true})).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await choose(page,desk,"Show leads","Created by me");
  await expect(desk.getByRole("heading",{name:"Created by me",exact:true})).toBeVisible();
  await desk.getByRole("button",{name:"Filters",exact:true}).click();
  await choose(page,desk,"Lead type filter","Buyer inquiry");
  await desk.getByRole("button",{name:"Reset filters",exact:true}).click();
  await desk.getByRole("button",{name:"Hide filters",exact:true}).click();
  await choose(page,desk,"Show leads","All leads");
  const row=desk.locator("[data-lead-row]").first();
  await expect(row).toBeVisible();
  expect(await row.evaluate(e=>parseFloat(getComputedStyle(e).borderTopLeftRadius))).toBe(0);
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:info.outputPath("simple-lead-desk-desktop.png"),fullPage:true});
});

test("standard lists use header sorting, direct reset and consistent row actions",async({page},info)=>{
  await load(page,"customers");
  await choose(page,page,"Display records as","List view");
  await expect(page.locator('[aria-label="Record views"]')).toHaveCount(0);
  const status=page.getByRole("combobox",{name:"records status",exact:true});
  await expect(status).toBeVisible();await status.click();
  const option=page.getByRole("option").last();const selected=await option.innerText();await option.click();
  await expect(status).toContainText(selected);
  await page.getByRole("button",{name:"Reset",exact:true}).click();
  const row=page.locator(".table-scroll tbody tr").first();
  await page.setViewportSize({width:360,height:900});
  expect(await row.evaluate(e=>parseFloat(getComputedStyle(e).borderTopLeftRadius))).toBe(0);
  await expect(row.locator(".e-cell-owner")).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.setViewportSize({width:1280,height:900});
  await expect(row.getByRole("button",{name:/^Open /})).toHaveCount(0);
  const more=row.getByRole("button",{name:/More actions for/});await expect(more).toContainText("Actions");await more.click();
  await page.getByRole("menuitem",{name:"Open record",exact:true}).click();
  await expect(page.locator(".record-workspace")).toBeVisible();
  await page.screenshot({path:info.outputPath("simple-record-details.png")});
});

test("quick capture and activity use clear dropdowns without early errors in light and dark",async({page},info)=>{
  await load(page,"customers");
  await choose(page,page,"Display records as","List view");
  for(const dark of [false,true]) {
    await page.evaluate(dark=>document.documentElement.dataset.theme=dark?"dark":"light",dark);
    await page.getByRole("button",{name:"Quick add",exact:true}).click();
    const quick=page.getByRole("dialog",{name:"Quick add",exact:true});
    await choose(page,quick,"Record type","Customer");
    await expect(quick.getByRole("alert")).toHaveCount(0);
    await expect(quick.locator('[aria-invalid="true"]')).toHaveCount(0);
    await quick.getByRole("button",{name:"Cancel",exact:true}).click();
    await page.locator(".table-scroll tbody tr").first().getByRole("button",{name:/More actions for/}).click();
    await page.getByRole("menuitem",{name:"Log activity",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"Log activity",exact:true});
    expect(await dialog.evaluate(e=>parseFloat(getComputedStyle(e).borderRadius))).toBeLessThanOrEqual(8);
    await choose(page,dialog,"Activity result","Interested");
    await choose(page,dialog,"Follow-up timing","Choose a date");
    await expect(dialog.getByRole("button",{name:"Follow-up date",exact:true})).toBeVisible();
    await choose(page,dialog,"Follow-up timing","No follow-up");
    await expect(dialog).toContainText("No follow-up will be scheduled");
    await expect(dialog.getByRole("button",{name:"Follow-up date",exact:true})).toHaveCount(0);
    for(const width of [360,768,1440]) {
      await page.setViewportSize({width,height:1000});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      const control=dialog.getByRole("combobox",{name:"Activity result",exact:true});
      expect(await control.evaluate(e=>parseFloat(getComputedStyle(e).borderRadius))).toBeLessThanOrEqual(4);
      if(width===360) expect((await dialog.getByRole("combobox",{name:"Follow-up timing",exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({path:info.outputPath(`simple-activity-${dark?"dark":"light"}-${width}.png`)});
    }
    await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
  }
});
