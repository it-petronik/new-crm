import { test, expect, type Page, type Locator } from "@playwright/test";
import { makePreview, previewActor, demoAccounts } from "../src/lib/fixtures";
import { workspaceUrl } from "../src/lib/workspace-url";
import type { Actor } from "../src/lib/domain";

async function start(page:Page, actor:Actor=previewActor, route="leads") {
  await page.addInitScript(({actor,data})=>{
    localStorage.setItem("enercore-preview-actor",JSON.stringify(actor));
    if(!localStorage.getItem("enercore-preview-v1")) localStorage.setItem("enercore-preview-v1",JSON.stringify(data));
  },{actor,data:makePreview()});
  await page.goto(workspaceUrl(route,"Petronik"));
  await expect(page.locator("#main h1").first()).toBeVisible();
  await expect(page.locator(".skeleton-region")).toHaveCount(0);
}
async function sizes(root:Locator, expected:number) {
  return root.evaluate((root,expected)=>{
    const controls=[...root.querySelectorAll<HTMLElement>(".ui-input,.ui-select-trigger,.ui-date-trigger,.ui-time-trigger")].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=="hidden");
    const expectedFont=expected===44?16:13;
    const measured=controls.map(el=>({name:el.getAttribute("aria-label")||el.getAttribute("name")||el.className,height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width,font:parseFloat(getComputedStyle(el).fontSize)}));
    const text=[...root.querySelectorAll<HTMLElement>(".ui-select-value,.ui-date-trigger > span,.ui-time-trigger > span,.ui-textarea")].filter(el=>el.getClientRects().length&&(el.matches(".ui-textarea")||el.textContent?.trim())).map(el=>({text:el.textContent?.trim(),font:parseFloat(getComputedStyle(el).fontSize)}));
    const buttons=[...root.querySelectorAll<HTMLElement>('.ui-button[data-variant][data-size="normal"]')].filter(el=>el.getClientRects().length).map(el=>({name:el.textContent?.trim(),height:el.getBoundingClientRect().height}));
    for(const shell of root.querySelectorAll<HTMLElement>(".heading-actions .company-switch"))if(shell.getClientRects().length)measured.push({name:"Company / period shell",height:shell.getBoundingClientRect().height,width:shell.getBoundingClientRect().width,font:parseFloat(getComputedStyle(shell.querySelector(".ui-select-trigger")||shell).fontSize)});
    return {measured,incorrect:[...measured.filter(el=>Math.abs(el.height-expected)>1||el.font!==expectedFont),...text.filter(el=>el.font!==expectedFont)],largeButtons:buttons.filter(el=>el.height>Math.max(36,expected)+1),overflow:document.documentElement.scrollWidth>innerWidth+1};
  },expected);
}
const forms=[["leads","New lead"],["quotations","New quotation"],["customers","Add customer"],["suppliers","Add supplier"],["products","Add product"],["hr","Add employee"],["it","New ticket"]];

test("all shared page and standard form fields use compact desktop sizing, with no oversized controls",async({page},info)=>{
  await page.setViewportSize({width:1440,height:1000});await start(page);
  const report:unknown[]=[];
  for(const [route,action] of forms) {
    await page.goto(workspaceUrl(route,"Petronik"));await expect(page.locator(".skeleton-region")).toHaveCount(0);
    for(const theme of ["light","dark"]) {
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      const result=await sizes(page.locator(".app-shell"),32);report.push({route,theme,scope:"page",...result});
      expect(result.incorrect,`${route} page`).toEqual([]);expect(result.largeButtons,`${route} page buttons`).toEqual([]);expect(result.overflow).toBe(false);
    }
    await page.getByRole("button",{name:action,exact:true}).first().click();
    const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
    for(const width of [768,1440,360])for(const theme of ["light","dark"]) {
      await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      const result=await sizes(dialog,width===360?44:32);report.push({route,theme,width,scope:"form",...result});
      expect(result.measured.length).toBeGreaterThan(0);expect(result.incorrect,`${route} form ${width}`).toEqual([]);expect(result.largeButtons,`${route} buttons ${width}`).toEqual([]);expect(result.overflow).toBe(false);
      if(width===360) expect(result.measured.every(item=>item.font>=16)).toBe(true);
      if(width!==768) await page.screenshot({path:info.outputPath(`compact-${route}-${theme}-${width}.png`)});
    }
    await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await page.setViewportSize({width:1440,height:1000});
  }
  await info.attach("field-dimensions",{body:JSON.stringify(report,null,2),contentType:"application/json"});
});

test("all three proforma steps and the open dropdown retain the same field height",async({page},info)=>{
  const actor=demoAccounts.find(account=>account.actor.role==="Accounts Manager")!.actor;
  await page.setViewportSize({width:1440,height:1000});await start(page,actor,"accounts");
  await page.getByRole("button",{name:"New proforma",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"New customer proforma",exact:true});
  const customer=makePreview().records.find(record=>record.kind==="customers"&&record.company==="Petronik")!;
  await dialog.getByRole("combobox",{name:"Customer",exact:true}).click();await page.getByRole("option",{name:customer.title,exact:true}).click();
  await dialog.getByRole("combobox",{name:"Item 1 product",exact:true}).fill("Fictional compact review item");
  await dialog.getByRole("spinbutton",{name:"Unit price",exact:true}).fill("50");
  const report:unknown[]=[];
  for(let step=0;step<3;step++) {
    for(const width of [360,768,1440])for(const theme of ["light","dark"]) {
      await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      const result=await sizes(dialog,width===360?44:32);report.push({step,width,theme,...result});expect(result.incorrect,`step ${step} width ${width}`).toEqual([]);expect(result.largeButtons).toEqual([]);expect(result.overflow).toBe(false);
      if(step===0&&width===1440) {
        const controls=[dialog.getByRole("button",{name:"Document date",exact:true}),dialog.getByRole("spinbutton",{name:"Invoice validity (days)",exact:true}),dialog.getByRole("combobox",{name:"Currency",exact:true})];
        const positions=await Promise.all(controls.map(async control=>(await control.boundingBox())!.y));expect(Math.max(...positions)-Math.min(...positions)).toBeLessThanOrEqual(1);
      }
      if(width!==768)await page.screenshot({path:info.outputPath(`compact-proforma-${step}-${theme}-${width}.png`)});
    }
    if(step<2)await dialog.getByRole("button",{name:"Continue",exact:true}).click();
  }
  await info.attach("proforma-field-dimensions",{body:JSON.stringify(report,null,2),contentType:"application/json"});
  await page.goto(workspaceUrl("leads","Petronik"));
});

test("lead search and queue choices no longer stretch across the full desktop page",async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await start(page);
  expect((await page.getByRole("combobox",{name:"Show leads",exact:true}).boundingBox())!.width).toBeLessThanOrEqual(220);
  expect((await page.getByRole("searchbox",{name:"Search leads or product grade",exact:true}).boundingBox())!.width).toBeLessThanOrEqual(440);
  await page.getByRole("combobox",{name:"Show leads",exact:true}).click();
  for(const option of await page.getByRole("option").all())expect((await option.boundingBox())!.height).toBeLessThanOrEqual(33);
  await page.keyboard.press("Escape");
  await page.setViewportSize({width:360,height:900});
  expect((await page.locator(".heading-actions .company-switch").boundingBox())!.width).toBeLessThanOrEqual(180);
});

test("touch tablets keep comfortable controls instead of inheriting desktop compact sizing",async({browser})=>{
  const context=await browser.newContext({viewport:{width:1024,height:1000},hasTouch:true});const page=await context.newPage();
  await start(page);await page.getByRole("button",{name:"New lead",exact:true}).click();
  const result=await sizes(page.getByRole("dialog"),44);expect(result.incorrect).toEqual([]);expect(result.measured.every(item=>item.font>=16)).toBe(true);await context.close();
});

test("dashboard time range, company and currency use the same visible type and menu sizing",async({page},info)=>{
  page.setDefaultTimeout(15000);
  await start(page,previewActor,"overview");
  await page.goto(workspaceUrl("overview","All companies"));
  await expect(page.getByRole("combobox",{name:"Dashboard currency",exact:true})).toBeVisible();
  const findings:unknown[]=[];
  for(const width of [390,576,768,1440])for(const theme of ["light","dark"]){
    await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const result=await sizes(page.locator(".app-shell"),width<=720?44:32);findings.push({width,theme,...result});
    expect(result.incorrect,`dashboard ${width} ${theme}`).toEqual([]);
    for(const name of ["Dashboard time range","Company","Dashboard currency"]){
      const control=page.getByRole("combobox",{name,exact:true});
      const value=control.locator(".ui-select-value");
      expect(await value.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${name} label fits ${width}`).toBe(true);
      await control.click();
      for(const option of await page.getByRole("option").all()){
        expect(await option.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(width<=720?16:13);
      }
      await page.keyboard.press("Escape");
    }
    expect(result.overflow).toBe(false);
    await page.screenshot({path:info.outputPath(`unified-dashboard-${theme}-${width}.png`)});
  }
  await info.attach("dashboard-control-typography",{body:JSON.stringify(findings,null,2),contentType:"application/json"});
});
