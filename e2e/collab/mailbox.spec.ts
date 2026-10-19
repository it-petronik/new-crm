import { test, expect } from "@playwright/test";
import { Client } from "./client";
test("server Sent and Drafts show their own counts and headers before body loading",async({browser})=>{
 const actor=await Client.login("pg31");await actor.request("POST","/api/mail/connection",{action:"disconnect",confirmed:true});expect((await actor.request("POST","/api/mail/connection",{action:"connect",host:"mail.petronik.ae",address:`folders${Date.now()}@local-mail.invalid`,password:"Local-Mailbox-Test-Only-1"})).status).toBe(200);
 await actor.request("POST","/api/mail/connection",{action:"sync",manual:true});const context=await browser.newContext({viewport:{width:1440,height:900}});await actor.signInBrowser(context);const page=await context.newPage();const trackers:string[]=[];page.on("request",r=>{if(r.url().includes("tracker.invalid"))trackers.push(r.url());});await page.goto("/workspace/petronik/email");
 const nav=page.getByRole("navigation",{name:"Email folders"});await expect(nav.getByRole("button",{name:/^Sent\s*7$/})).toBeVisible();await expect(nav.getByRole("button",{name:/^Drafts\s*2$/})).toBeVisible();
 let release:()=>void=()=>{};const hold=new Promise<void>(resolve=>{release=resolve;});let bodyRequests=0;
 await page.route("**/api/mail/message?*",async route=>{const url=new URL(route.request().url());if(!url.searchParams.has("metadata")&&!url.searchParams.has("part")){bodyRequests++;await hold;}await route.continue();});await nav.getByRole("button",{name:/^Sent/}).click();
 await page.getByRole("button",{name:/Fictional sent message 1/}).click();await expect(page.getByRole("heading",{name:"Fictional sent message 1",exact:true})).toBeVisible();await expect(page.locator(".mail-sender strong")).toContainText("@local-mail.invalid");
 await expect(page.getByRole("status",{name:"Loading email content"})).toBeVisible();await expect(page.locator(".mail-body")).toHaveCount(0);
 await expect(page.getByRole("region",{name:"Email attachments"})).toBeVisible();await expect(page.getByRole("img",{name:"Thumbnail of Fictional enquiry.png"})).toBeVisible();await page.screenshot({path:"test-results/mail-loading-attachments.png"});
 release();const original=page.frameLocator('iframe[title="Original email"]');await expect(original.locator("table")).toBeVisible();await expect(original.locator("a[href='https://example.invalid/catalogue']")).toBeVisible();expect(await original.locator("a[href^='javascript:']").count()).toBe(0);expect(trackers).toEqual([]);
 await expect(original.locator(".brand-header")).toHaveCSS("background-color","rgb(19, 44, 66)");await expect(original.locator(".brand-card")).toHaveCSS("max-width","640px");await expect(original.getByRole("img",{name:"Embedded brand logo"})).toHaveAttribute("src",/^blob:/);await expect.poll(()=>original.getByRole("img",{name:"Embedded brand logo"}).evaluate((i:HTMLImageElement)=>i.naturalWidth)).toBeGreaterThan(0);
 expect(await original.locator("script,[onclick],iframe,form").count()).toBe(0);await expect(page.locator('iframe[title="Original email"]')).toHaveAttribute("sandbox","allow-same-origin");expect(await page.evaluate(()=>(window as any).mailUnsafe||document.body.dataset.mailUnsafe)).toBeUndefined();
 let remoteAttempts=0;await page.route("https://tracker.invalid/**",route=>route.request().url().endsWith("/pixel")&&++remoteAttempts===1?route.fulfill({status:404,body:"Temporarily missing"}):route.fulfill({contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1WQAAAAASUVORK5CYII=","base64")}));await page.getByRole("button",{name:"Load external images",exact:true}).click();await expect.poll(()=>trackers.length).toBeGreaterThan(0);await expect(original.getByRole("img",{name:"External brand image"})).toHaveAttribute("src","https://tracker.invalid/pixel");await expect(page.getByRole("button",{name:"Retry images",exact:true})).toBeVisible();await page.getByRole("button",{name:"Retry images",exact:true}).click();await expect.poll(()=>original.getByRole("img",{name:"External brand image"}).evaluate((i:HTMLImageElement)=>i.naturalWidth)).toBeGreaterThan(0);await expect(original.getByRole("img",{name:"Lazy remote image"})).toHaveAttribute("src",/^https:\/\/tracker.invalid\/lazy(?:#|$)/);await page.getByRole("button",{name:"Block external images",exact:true}).click();await expect(original.getByRole("img",{name:"External brand image",includeHidden:true})).not.toHaveAttribute("src",/https:/);
 const renderer=page.frames().find(f=>f.url().includes("/api/mail/render"))!;expect(renderer).toBeTruthy();
 const parentHeaders=(await context.request.get("/workspace/petronik/email")).headers();expect(parentHeaders["content-security-policy"]).toContain("img-src 'self' data: blob:");expect(parentHeaders["x-frame-options"]).toBe("DENY");
 const formValues=await page.evaluate(()=>{const f=document.querySelector('iframe[title="Original email"]') as HTMLIFrameElement;return f.contentDocument?.body.getAttribute("data-mail-render");});expect(formValues).toBe("ready");
 const sync=await actor.request("POST","/api/mail/connection",{action:"sync",manual:true});const reference=sync.body.messages[0].id;
 const raw=new URLSearchParams({id:reference,html:'<html><body><script>window.mailUnsafe=1</script><p onclick="alert(1)">Safe preview</p><img src="https://tracker.invalid/pixel"></body></html>',images:"0"}).toString();
 const render=await context.request.post("/api/mail/render",{data:raw,headers:{Origin:new URL(page.url()).origin,"Content-Type":"application/x-www-form-urlencoded"}});expect(render.status()).toBe(200);expect(render.headers()["content-security-policy"]).toContain("script-src 'none'");expect(render.headers()["content-security-policy"]).not.toContain("https:");expect(render.headers()["cache-control"]).toContain("no-store");expect(await render.text()).not.toMatch(/<script|onclick=|src="https:/);
 expect((await actor.request("POST","/api/mail/render",undefined,{raw,origin:"https://foreign.invalid"})).status).toBe(403);expect((await actor.request("POST","/api/mail/render",undefined,{raw,cookie:null})).status).toBe(401);const other=await Client.login("pg33");expect((await other.request("POST","/api/mail/render",undefined,{raw})).status).toBe(404);
 await page.screenshot({path:"test-results/mail-original-styled.png"});
 for(const theme of ["dark","light"]){await page.evaluate(t=>document.documentElement.setAttribute("data-theme",t),theme);for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});await expect(original.locator(".brand-header")).toHaveCSS("background-color","rgb(19, 44, 66)");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.locator('iframe[title="Original email"]').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/mail-original-${theme}-${width}.png`});}}
 const calls=bodyRequests;await nav.getByRole("button",{name:/^Inbox/}).click();await nav.getByRole("button",{name:/^Sent/}).click();await page.getByRole("button",{name:/Fictional sent message 1/}).click();await expect(original.locator("table")).toBeVisible();await expect(page.getByRole("status",{name:"Loading email content"})).toHaveCount(0);expect(bodyRequests).toBe(calls);await page.unroute("**/api/mail/message?*");
 await nav.getByRole("button",{name:/^Drafts/}).click();await expect(page.locator(".mail-reader")).not.toContainText("Greetings from Fictional Company");await page.getByRole("button",{name:/Fictional drafts message 1/}).click();await page.getByRole("button",{name:"Copy to new draft",exact:true}).click();await expect(page.getByRole("textbox",{name:"Subject",exact:true})).toHaveValue("Fictional drafts message 1");await page.getByRole("button",{name:"Close dialog",exact:true}).click();
 await page.screenshot({path:"test-results/mail-outlook-folders.png"});await actor.request("POST","/api/mail/connection",{action:"disconnect",confirmed:true});await context.close();
});
test("40-message inbox and long forwarded email scroll independently",async({browser})=>{
 const actor=await Client.login("pg30");await actor.request("POST","/api/mail/connection",{action:"disconnect",confirmed:true});
 expect((await actor.request("POST","/api/mail/connection",{action:"connect",address:`scroll${Date.now()}@local-mail.invalid`,password:"Local-Mailbox-Test-Only-1",host:"mail.petronik.ae"})).status).toBe(200);
 expect((await actor.request("POST","/api/mail/connection",{action:"sync",manual:true})).status).toBe(200);
 const context=await browser.newContext({viewport:{width:1080,height:720}});await actor.signInBrowser(context);const page=await context.newPage();await page.goto("/workspace/petronik/email");
 await page.getByRole("button",{name:/Scroll regression message 1 Fictional/}).first().click();await expect(page.locator(".mail-body")).toContainText("Quoted correspondence line 160");
 for(const width of [1080,1440,390]){
  await page.setViewportSize({width,height:720});await page.waitForTimeout(500);
  if(width>680&&await page.getByRole("button",{name:"Collapse sidebar",exact:true}).isVisible()){await page.getByRole("button",{name:"Collapse sidebar",exact:true}).click();await page.waitForTimeout(400);}
  const reader=page.locator(".mail-reader");await reader.hover();await page.mouse.wheel(0,700);
  const metrics=await page.evaluate(()=>{const r=document.querySelector(".mail-reader")!,l=document.querySelector(".mail-message-list")!;return {reader:r.clientHeight,readerTotal:r.scrollHeight,readerScroll:r.scrollTop,list:l.clientHeight,listTotal:l.scrollHeight,page:document.documentElement.scrollHeight,viewport:innerHeight};});console.log("mail-scroll",width,metrics);
  await expect.poll(()=>reader.evaluate(e=>e.scrollTop)).toBeGreaterThan(100);
  expect(await page.evaluate(()=>scrollY)).toBe(0);
  await reader.evaluate(e=>e.scrollTop=0);
  await page.getByRole("button",{name:"Scroll email down",exact:true}).click();await expect.poll(()=>reader.evaluate(e=>e.scrollTop)).toBeGreaterThan(100);await page.getByRole("button",{name:"Scroll email up",exact:true}).click();await expect.poll(()=>reader.evaluate(e=>e.scrollTop)).toBe(0);
  if(width>680){const list=page.locator(".mail-message-list");await list.hover();await page.mouse.wheel(0,700);await expect.poll(()=>list.evaluate(e=>e.scrollTop)).toBeGreaterThan(100);expect(await reader.evaluate(e=>e.scrollTop)).toBe(0);}
  await page.screenshot({path:`test-results/mail-long-${width}.png`});
 }
 await page.setViewportSize({width:1080,height:450});await page.waitForTimeout(500);expect(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight)).toBe(true);await page.getByRole("heading",{name:"Email",exact:true}).hover();await page.mouse.wheel(0,350);await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
 await actor.request("POST","/api/mail/connection",{action:"disconnect",confirmed:true});await context.close();
});
test("private mailbox connection, sync, lead review, read flags, send capture and disconnect", async ({
  browser,
}) => {
  const actor = await Client.login("pg32"),
    other = await Client.login("pg33");
  await actor.request("POST", "/api/mail/connection", {
    action: "disconnect",
    confirmed: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  await actor.signInBrowser(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/workspace/petronik/email");
  await page
    .getByRole("button", { name: "Connect email", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill(`one${Date.now()}@local-mail.invalid`);
  await page
    .getByRole("textbox", { name: "Email password", exact: true })
    .fill("Local-Mailbox-Test-Only-1");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Connect securely", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".mail-message-list").getByText("Fictional SN500 quotation enquiry", { exact: true }),
  ).toBeVisible();
  const saved = await actor.request("GET", "/api/mail");expect(saved.body.mode).toBe("connected");expect(saved.body.messages.filter((m:any)=>m.folder==="inbox")).toHaveLength(0);
  const inbox = await actor.request("POST","/api/mail/connection",{action:"sync",manual:true});
  expect(inbox.body.messages.filter((m:any)=>m.folder==="inbox")).toHaveLength(3);
  expect(inbox.body.messages.find((m:any)=>m.sender==="notification@facebookmail.com").candidate).toBe(0);
  const facebook=inbox.body.messages.find((m:any)=>m.sender==="notification@facebookmail.com");const triage=await actor.request("POST","/api/mail/analyze",{id:facebook.id});expect(triage.status).toBe(200);expect(triage.body.suggestion.category).toBe("other");
  expect(JSON.stringify(inbox.body)).not.toContain("passwordSeal");
  expect(
    (await other.request("GET", "/api/mail")).body.messages.some(
      (m: any) => m.id === inbox.body.messages[0].id,
    ),
  ).toBe(false);
  expect(
    (
      await other.request("POST", "/api/mail/connection", {
        action: "seen",
        id: inbox.body.messages[0].id,
        read: true,
      })
    ).status,
  ).toBe(409);
  await page.getByRole("button", { name: /Possible enquiries/ }).click();
  await expect(page.getByText("See more of the conversions you're already driving",{exact:true})).toHaveCount(0);
  await expect(
    page.getByText("Fictional office newsletter", { exact: true }),
  ).toHaveCount(0);
  await page
    .locator(".mail-message-list").getByText("Fictional SN500 quotation enquiry", { exact: true })
    .click();
  const original=page.frameLocator('iframe[title="Original email"]');await expect(original.locator("table")).toBeVisible();expect(await original.locator("script,[onclick]").count()).toBe(0);expect(await page.evaluate(()=>(window as any).mailUnsafe)).toBeUndefined();
  await expect(original.getByText("This full message loads even when the email contains large attachments.",{exact:false})).toBeVisible();
  await expect(page.getByRole("region",{name:"Email attachments"})).toBeVisible();
  await page.getByRole("button",{name:"Preview Fictional enquiry.png",exact:true}).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(()=>page.getByRole("img",{name:"Fictional enquiry.png"}).evaluate((i:HTMLImageElement)=>i.complete&&i.naturalWidth>0)).toBe(true);
  await page.getByRole("button",{name:"Close preview",exact:true}).click();
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"Download Fictional specification.txt",exact:true}).click();expect((await download).suggestedFilename()).toBe("Fictional specification.txt");
  expect((await other.request("GET",`/api/mail/message?id=${inbox.body.messages[0].id}&part=2`)).status).toBe(404);
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+2)).toBe(true);
  await page.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Mark unread", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Analyse email", exact: true })
    .click();
  await expect(
    page.getByText(
      "Literal email extraction · not an AI result · verify before saving",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review lead", exact: true }),
  ).toBeDisabled();
  await page.locator(".mail-share-consent input").check();
  await page.getByRole("button", { name: "Review lead", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "New email", exact: true }).click();
  await page
    .getByRole("textbox", { name: "To", exact: true })
    .fill("buyer@example.invalid");
  await page
    .getByRole("textbox", { name: "Subject", exact: true })
    .fill("Fictional connected mailbox reply");
  await page
    .getByRole("textbox", { name: /Message|Body/, exact: true })
    .fill("Please confirm the quantity.");
  await page.getByRole("button", { name: "Review email", exact: true }).click();
  await page.getByRole("button", { name: "Confirm send", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Captured in the test outbox. No real email was sent."),
  ).toBeVisible();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (t) => document.documentElement.setAttribute("data-theme", t),
      theme,
    );
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(500);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+2)).toBe(true);
      const pane=await page.locator(".mail-layout").boundingBox();expect(pane).not.toBeNull();expect(pane!.y+pane!.height).toBeGreaterThan(860);
      await page.screenshot({
        path: `test-results/mailbox-${theme}-${width}.png`,
        fullPage: false,
        animations: "disabled",
      });
    }
  }
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page
    .getByRole("button", { name: "Disconnect and clear cache", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Connect email", exact: true }),
  ).toBeVisible();
  expect(
    (await actor.request("GET", "/api/mail/connection")).body.connected,
  ).toBe(false);
  expect(errors).toEqual([]);
  await context.close();
});
