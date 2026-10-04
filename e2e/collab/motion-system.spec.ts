import { test, expect } from "@playwright/test";
import { Client } from "./client";
let session: Promise<Client> | undefined;
const actor = () => session ??= Client.login("studio");

test("themed time picker works in a dialog on desktop and mobile without saving a record", async ({ browser }) => {
  const context = await browser.newContext(); await (await actor()).signInBrowser(context);
  const page = await context.newPage();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height:844 });
    await page.goto("/workspace/all-companies/marketing");
    await page.getByRole("button", { name:"Plan a post", exact:true }).click();
    const field = page.getByRole("button", { name:"Time · Dubai (optional)" });
    await field.click();
    const picker = page.getByRole("dialog", { name:"Choose a time", exact:true });
    await expect(picker).toBeVisible();
    await picker.getByRole("radiogroup", { name:"Hour", exact:true }).getByRole("radio", { name:"12", exact:true }).click();
    await picker.getByRole("radiogroup", { name:"Minute", exact:true }).getByRole("radio", { name:"37", exact:true }).click();
    await picker.getByRole("radio", { name:"PM", exact:true }).click();
    await page.screenshot({ path:`test-results/motion-time-${width}.png`, animations:"disabled" });
    await picker.getByRole("button", { name:"Set time", exact:true }).click();
    await expect(field).toContainText("12:37 PM");
    await expect(picker).toBeHidden();
    await field.click();
    await picker.getByRole("radiogroup", { name:"Hour", exact:true }).getByRole("radio", { name:"12", exact:true }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(picker.getByRole("radiogroup", { name:"Hour", exact:true }).getByRole("radio", { name:"01", exact:true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(field).toContainText("12:37 PM"); // Cancel does not commit draft.
    await expect(field).toBeFocused();
    await field.click();
    await picker.getByRole("button", { name:"Clear", exact:true }).click();
    await expect(picker).toHaveCount(0);
    await expect(field).toContainText("Choose a time");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await context.close();
});

test("guide dismissal, workspace preferences, full-width AI and tooltip follow the same theme", async ({ browser }) => {
  const context = await browser.newContext({viewport:{width:1440,height:1000}}); await (await actor()).signInBrowser(context);
  const page = await context.newPage();
  const errors:string[]=[]; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/workspace/all-companies/settings");
  await expect(page.getByText("One place. A connected team.")).toBeVisible();
  await expect(page.getByText("Connections need configuration")).toBeVisible();
  const guide = page.getByRole("button", { name:"How this page works", exact:true });
  await guide.click();
  await expect(page.getByRole("dialog", {name:"How this page works"})).toBeVisible();
  await page.getByRole("heading", {name:"Workspace settings",exact:true}).click();
  await expect(page.getByRole("dialog", {name:"How this page works"})).toBeHidden();
  await guide.click(); await page.keyboard.press("Escape"); await expect(guide).toBeFocused();
  await page.getByRole("combobox", {name:"Accent palette"}).click();
  await page.getByRole("option", {name:"Ocean",exact:true}).click();
  await page.getByRole("combobox", {name:"Display mode"}).click();
  await page.getByRole("option", {name:"Dark",exact:true}).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
  await expect(page.locator("html")).toHaveAttribute("data-palette","ocean");
  await page.screenshot({path:"test-results/motion-settings-dark.png",animations:"disabled",fullPage:true});
  await page.getByRole("combobox", {name:"Display mode"}).click(); await page.getByRole("option", {name:"Light",exact:true}).click();
  await page.screenshot({path:"test-results/motion-settings.png",animations:"disabled",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:"test-results/motion-settings-phone.png",animations:"disabled",fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto("/workspace/all-companies/enercore-ai");
  const size = await page.locator(".ai-workspace").evaluate(e=>({width:e.getBoundingClientRect().width,main:document.querySelector(".main-content")!.getBoundingClientRect().width}));
  expect(size.main-size.width).toBeLessThanOrEqual(60);
  await page.getByRole("button",{name:"Open Enercore AI",exact:true}).hover();
  await expect(page.getByRole("tooltip")).toContainText("Ask Enercore AI");
  await page.screenshot({path:"test-results/motion-ai-tooltip.png",animations:"disabled"});
  await page.goto("/workspace/all-companies/prospecting");
  const people=page.getByRole("button",{name:"People",exact:true});
  const color = await people.evaluate(e=>({actual:getComputedStyle(e).color,expected:getComputedStyle(document.documentElement).getPropertyValue("--muted").trim()}));
  expect(color.actual).toBe("rgb(101, 104, 115)");
  expect(errors).toEqual([]);
  await context.close();
});

test("action cards fill rows and motion is disabled when requested", async ({browser})=>{
  const context=await browser.newContext({viewport:{width:1440,height:950}}); await (await actor()).signInBrowser(context);
  const page=await context.newPage(); await page.goto("/workspace/all-companies/action-center");
  await page.getByRole("button",{name:"Team",exact:true}).click();
  await expect(page.locator(".action-tile").first()).toBeVisible();
  const tiles=await page.locator(".action-tile").evaluateAll(elements=>elements.map(e=>({w:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})));
  expect(tiles.length).toBeGreaterThanOrEqual(4);
  expect(Math.max(...tiles.map(t=>t.w))-Math.min(...tiles.map(t=>t.w))).toBeLessThan(2);
  const list=page.locator('.action-list').first();
  expect(await list.evaluate(e=>e.clientHeight)).toBeLessThanOrEqual(560);
  expect(await list.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
  await list.focus();await page.keyboard.press('End');
  await expect.poll(()=>list.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
  await list.evaluate(e=>e.scrollTop=0);
  await page.screenshot({path:"test-results/motion-actions.png",animations:"disabled"});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(await list.evaluate(e=>e.clientHeight)).toBeLessThanOrEqual(549);
  // Offscreen row content must not leak into the outer page's scroll area.
  expect(await page.evaluate(()=>document.documentElement.scrollHeight-document.body.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
  await page.screenshot({path:"test-results/motion-actions-phone.png",animations:"disabled",fullPage:true});
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto("/workspace/all-companies/overview");
  await expect(page.locator(".main-content")).toBeVisible();
  const timing=await page.locator(".main-content").evaluate(e=>({animation:getComputedStyle(e).animationDuration,transition:getComputedStyle(e).transitionDuration}));
  expect(parseFloat(timing.animation)).toBeLessThanOrEqual(.00001);
  expect(parseFloat(timing.transition)).toBe(0);
  await context.close();
});

test("scheduled meeting time uses themed five-minute validation on a small phone", async ({browser})=>{
  const context=await browser.newContext({viewport:{width:320,height:760}});await(await actor()).signInBrowser(context);
  const page=await context.newPage();await page.goto('/workspace/all-companies/collaboration');
  await page.getByRole('button',{name:'Meetings',exact:true}).click();
  await page.getByRole('button',{name:'New meeting',exact:true}).click();
  const form=page.getByRole('dialog',{name:'New meeting',exact:true});
  await form.getByRole('button',{name:'Schedule',exact:true}).click();
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.dataset.palette='ocean';});
  const field=form.getByRole('button',{name:'Time',exact:true});await field.click();
  const picker=page.getByRole('dialog',{name:'Choose a time',exact:true});
  await expect(picker.getByRole('button',{name:'Clear',exact:true})).toHaveCount(0);
  await picker.getByRole('radiogroup',{name:'Minute',exact:true}).getByRole('radio',{name:'37',exact:true}).click();
  await expect(picker.getByRole('button',{name:'Set time',exact:true})).toBeDisabled();
  await expect(picker.getByRole('status')).toContainText('5-minute intervals');
  await picker.getByRole('radiogroup',{name:'Minute',exact:true}).getByRole('radio',{name:'35',exact:true}).click();
  await expect(picker.getByRole('button',{name:'Set time',exact:true})).toBeEnabled();
  expect(await picker.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})).toBe(true);
  expect(await picker.evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
  await expect(picker.getByText('Select time',{exact:true})).toBeInViewport();
  await page.screenshot({path:'test-results/motion-time-dark-320.png',animations:'disabled'});
  await picker.getByRole('button',{name:'Set time',exact:true}).click();
  await expect(field).toContainText(':35');
  // The picker retains the form's HH:mm contract; nothing is submitted here.
  expect(await form.locator('input.ui-validation-proxy[type="text"]').inputValue()).toMatch(/^\d{2}:35$/);
  await context.close();
});
