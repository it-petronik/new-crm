import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { modules, roles, type Actor } from "../src/lib/domain";
import { workspaceUrl } from "../src/lib/workspace-url";
import { quickCreateKinds } from "../src/lib/workspace-experience";

const reviewSessions = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();
async function signIn(browser: Browser, key="studio", theme="light") {
  const context=await browser.newContext({baseURL:"http://127.0.0.1:8789", viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  const cookies=reviewSessions.get(key);
  if(cookies) await context.addCookies(cookies);
  else {
    const auth=await context.request.post("/api/auth",{headers:{Origin:"http://localhost:8788"},data:{email:`${key}@collab.test`,password:"Collab-Test-Password-1"}});
    expect(auth.status()).toBe(200);
    reviewSessions.set(key,await context.cookies());
  }
  await context.addInitScript(theme => localStorage.setItem("enercore-theme",theme),theme);
  return context;
}
const routes=[...modules,"mail","prospecting","collaboration","ai","actions","tasks","operations","notifications","profile","appearance","access","shortcuts","catalogs","my-requests"];

test("all 29 workspace routes fit light/dark desktop, tablet and phone with readable feedback",async({browser},info)=>{
  const report:unknown[]=[];const failures:unknown[]=[];
  for(const theme of ["light","dark"]){
    const context=await signIn(browser,"studio",theme);const page=await context.newPage();const errors:string[]=[];
    page.on("pageerror",e=>errors.push(e.message));
    for(const route of routes){
      await page.setViewportSize({width:1440,height:1000});
      await page.goto(workspaceUrl(route,"All companies"));
      await expect(page.locator("#main h1").first()).toBeVisible({timeout:20000});
      await expect(page.locator(".async-loading,.workspace-opening")).toHaveCount(0,{timeout:20000});
      await expect(page.locator(".skeleton-region")).toHaveCount(0,{timeout:20000});
      await page.waitForTimeout(250);
      for(const width of [360,768,1440]){
        await page.setViewportSize({width,height:1000});await page.waitForTimeout(80);
        const snapshot=await page.evaluate(()=>{
          const main=document.querySelector<HTMLElement>("#main")!, heading=main.querySelector<HTMLElement>("h1")!;
          const side=document.querySelector<HTMLElement>('aside[class*="desktop"]');
          const visibleSide=side&&getComputedStyle(side).display!=="none"?side.getBoundingClientRect():null;
          const rawErrors=[...main.querySelectorAll('[role="alert"],.error,.form-error')].map(e=>e.textContent||"").filter(t=>/unexpected token|<!doctype|syntaxerror|D1_ERROR|SQLITE|TypeError|is not valid JSON/i.test(t));
          const whiteSurfaces=document.documentElement.dataset.theme!=="dark"?[]:[...main.querySelectorAll<HTMLElement>("section,button,input,textarea,table,aside")].filter(el=>{
            if(el.closest(".reference-document,.theme-preview,.brand-logo,.mail-original,.intel-print"))return false;
            const rect=el.getBoundingClientRect(), c=getComputedStyle(el), rgb=c.backgroundColor.match(/[\d.]+/g)?.map(Number)||[];
            return rect.width>100&&rect.height>26&&c.visibility!=="hidden"&&rgb.length>=3&&rgb.slice(0,3).every(v=>v>225)&&(rgb[3]??1)>.85;
          }).map(e=>e.className);
          const expectedControlHeight=innerWidth<=720?44:32;
          const wrongControlSizes=[...main.querySelectorAll<HTMLElement>(".ui-input,.ui-select-trigger,.ui-date-trigger,.ui-time-trigger")].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=="hidden"&&!el.closest(".reference-document,.mail-original,.intel-print")).map(el=>({label:el.getAttribute("aria-label")||el.getAttribute("name")||el.className,height:el.getBoundingClientRect().height})).filter(el=>Math.abs(el.height-expectedControlHeight)>1);
          return {width:innerWidth,scroll:document.documentElement.scrollWidth,mainLeft:main.getBoundingClientRect().left,headingLeft:heading.getBoundingClientRect().left,sidebarRight:visibleSide?.right||0,rawErrors,whiteSurfaces,wrongControlSizes};
        });
        report.push({route,theme,...snapshot});
        if(snapshot.scroll>width+1||snapshot.mainLeft<snapshot.sidebarRight-1||snapshot.headingLeft<snapshot.sidebarRight-1||snapshot.rawErrors.length||snapshot.whiteSurfaces.length||snapshot.wrongControlSizes.length)failures.push({route,theme,...snapshot});
        if(width!==768) await page.screenshot({path:info.outputPath(`${theme}-${route}-${width}.png`)});
      }
    }
    expect(errors).toEqual([]);await context.close();
  }
  await info.attach("all-pages-experience",{body:JSON.stringify({report,failures},null,2),contentType:"application/json"});
  expect(failures).toEqual([]);
});

test("all 16 role homes retain identity on refresh and hide creation when no quick kind is writable",async({browser},info)=>{
  const findings:unknown[]=[];
  for(let index=0;index<roles.length;index++){
    const role=roles[index],context=await signIn(browser,`release${index}`,"dark"),page=await context.newPage();
    await page.addInitScript(()=>{(window as any).wrongDashboard=false;new MutationObserver(()=>{if([...document.querySelectorAll("h1")].some(e=>e.textContent?.includes("Group dashboard")))(window as any).wrongDashboard=true;}).observe(document,{childList:true,subtree:true});});
    await page.goto(workspaceUrl("overview","All companies"));
    await expect(page.locator("#main h1").first()).toBeVisible();
    await page.reload();await expect(page.locator("#main h1").first()).toBeVisible();
    await expect(page.locator(".skeleton-region")).toHaveCount(0,{timeout:20000});
    const executive=["MD","IT Administrator","Group Manager","Branch Manager"].includes(role);
    if(!executive){await expect(page.locator(".role-home-heading .eyebrow").first()).toContainText(role);expect(await page.evaluate(()=>(window as any).wrongDashboard),role).toBe(false);}
    const expectedQuick=quickCreateKinds({id:"fake",role,companies:["Petronik"],branches:[],name:"Fake"} as Actor).length>0;
    await expect(page.getByRole("button",{name:"Quick add",exact:true})).toHaveCount(expectedQuick?1:0);
    if(!expectedQuick){await page.keyboard.press("n");await expect(page.getByRole("dialog",{name:"Quick add",exact:true})).toHaveCount(0);}
    await expect(page.locator('.workspace-reports[open]')).toHaveCount(0);
    for(const width of [360,768,1440]) {
      await page.setViewportSize({width,height:1000});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${role} at ${width}`).toBe(true);
      await expect(page.locator("#main h1").first()).toBeInViewport();
      await page.screenshot({path:info.outputPath(`role-${index}-${width}.png`)});
    }
    findings.push({role,expectedQuick,widths:[360,768,1440]});await context.close();
  }
  await info.attach("role-visibility",{body:JSON.stringify(findings,null,2),contentType:"application/json"});
});

test("navigation keeps active pages visible, guide is clear, and optional salesperson choice can be cleared without submitting",async({browser})=>{
  const context=await signIn(browser),page=await context.newPage();
  await page.goto(workspaceUrl("leads","All companies"));
  const nav=page.getByRole("navigation",{name:"Main navigation",exact:true});
  await expect(nav.getByRole("button",{name:"Sales pipeline",exact:true})).toHaveAttribute("aria-current","page");
  await page.getByRole("button",{name:"How this page works"}).click();await expect(page.getByText("How this page works",{exact:true})).toBeVisible();await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Quick add",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Quick add",exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.locator('[aria-invalid="true"]')).toHaveCount(0);
  const people=dialog.getByRole("combobox",{name:"Assign to salesperson",exact:true});await expect(people).toBeEnabled();
  await people.click();const options=page.getByRole("option");await expect(options).not.toHaveCount(0);await options.nth(1).click();
  await people.click();await page.getByRole("option",{name:/Keep with me|Assign later/i}).click();
  await expect(people).toContainText(/Keep with me|Assign later/i);
  await expect(dialog.locator('[aria-invalid="true"]')).toHaveCount(0);
  const date=dialog.getByRole("button",{name:/Follow.up date/i});
  if(await date.count()){await date.click();await expect(page.locator('.ui-calendar-popover')).toBeVisible();await page.keyboard.press("Escape");}
  await dialog.getByRole("button",{name:"Cancel",exact:true}).click();await expect(dialog).toHaveCount(0);
  await nav.getByRole("button",{name:"Manage",exact:true}).click();await nav.getByRole("button",{name:"Access control",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Access control",exact:true})).toBeVisible();
  await page.reload();await expect(nav.getByRole("button",{name:"Access control",exact:true})).toBeVisible();
  await expect(nav.getByRole("button",{name:"Access control",exact:true})).toHaveAttribute("aria-current","page");
  await context.close();
});

test("every standard create form opens neutrally and fits phone/tablet/desktop in both themes without saving",async({browser},info)=>{
  const context=await signIn(browser),page=await context.newPage();
  const findings:unknown[]=[];
  for(const [module,label] of [["leads","New lead"],["quotations","New quotation"],["customers","Add customer"],["suppliers","Add supplier"],["products","Add product"],["hr","Add employee"],["marketing","New campaign"],["it","New ticket"]]){
    await page.goto(workspaceUrl(module,"All companies"));
    await expect(page.locator(".skeleton-region")).toHaveCount(0,{timeout:20000});
    await page.getByRole("button",{name:label,exact:true}).first().click();
    const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
    await expect(dialog.locator('[aria-invalid="true"]')).toHaveCount(0);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    for(const width of [360,768,1440])for(const theme of ["light","dark"]){
      await page.setViewportSize({width,height:900});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
      await page.waitForTimeout(100);
      const geometry=await dialog.evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth,page:document.documentElement.scrollWidth,viewport:innerWidth,wrongControlSizes:[...el.querySelectorAll<HTMLElement>(".ui-input,.ui-select-trigger,.ui-date-trigger,.ui-time-trigger")].filter(control=>control.getClientRects().length).map(control=>({name:control.getAttribute("aria-label")||control.getAttribute("name"),height:control.getBoundingClientRect().height})).filter(control=>Math.abs(control.height-(innerWidth<=720?44:32))>1)}));
      findings.push({module,theme,viewportWidth:width,...geometry});
      expect(geometry.scroll,`${module} ${width} ${theme}`).toBeLessThanOrEqual(geometry.width+1);
      expect(geometry.page).toBeLessThanOrEqual(geometry.viewport+1);
      expect(geometry.wrongControlSizes,`${module} controls ${width} ${theme}`).toEqual([]);
      await page.screenshot({path:info.outputPath(`form-${module}-${theme}-${width}.png`)});
    }
    await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);
  }
  await info.attach("standard-form-layouts",{body:JSON.stringify(findings,null,2),contentType:"application/json"});await context.close();
});

test("a large lead window cannot hide older quotation records; kind filters retain server permissions",async({browser})=>{
  // The production-format build correctly marks cookies Secure. Chromium
  // accepts loopback as trustworthy; APIRequestContext needs them explicitly
  // on this HTTP-only isolated test host. Do not weaken the app cookie policy.
  const context=await signIn(browser),headers={Cookie:(await context.cookies()).map(c=>`${c.name}=${c.value}`).join("; ")};
  const response=await context.request.get("/api/records?kind=quotations",{headers});
  expect(response.status()).toBe(200);
  const data=await response.json();expect(data.records.length).toBeGreaterThan(0);
  expect(data.records.every((r:{kind:string})=>r.kind==="quotations")).toBe(true);
  expect((await context.request.get("/api/records?kind=settings",{headers})).status()).toBe(400);
  const page=await context.newPage();await page.goto(workspaceUrl("leads","All companies"));
  await expect(page.getByRole("heading",{name:"Lead Desk",exact:true})).toBeVisible();
  await page.getByRole("navigation",{name:"Main navigation",exact:true}).getByRole("button",{name:"Quotations",exact:true}).click();
  await expect(page.locator(".records-panel")).toBeVisible();
  await page.locator(".records-panel").getByRole("textbox",{name:"Search records",exact:true}).fill(data.records[0].title);
  await expect(page.locator(".records-panel")).toContainText(data.records[0].title);
  await context.close();
  const employee=await signIn(browser,"release15");
  const employeeHeaders={Cookie:(await employee.cookies()).map(c=>`${c.name}=${c.value}`).join("; ")};
  expect((await employee.request.get("/api/records?kind=quotations",{headers:employeeHeaders})).status()).toBe(403);
  await employee.close();
});
