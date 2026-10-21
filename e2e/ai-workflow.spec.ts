import {test, expect} from "@playwright/test";
import {makePreview, previewActor, demoAccounts} from "../src/lib/fixtures";

for (const theme of ["light", "dark"]) test(`inquiry detection is local, fills drafts only and preserves typed fields · ${theme}`, async ({page}, info) => {
  await page.setViewportSize({width:theme==="dark"?390:1440,height:1000});
  await page.addInitScript(({data,actor,theme})=>{localStorage.setItem("enercore-preview-v1",JSON.stringify(data));localStorage.setItem("enercore-preview-actor",JSON.stringify(actor));localStorage.setItem("enercore-theme",theme);},{data:makePreview(),actor:previewActor,theme});
  const aiCalls: string[] = []; page.on("request", r=>{if(r.url().includes("/api/ai")&&r.method()==="POST")aiCalls.push(r.url());});
  await page.goto("/workspace/all-companies/sales-pipeline");
  await page.getByRole("button",{name:"Quick add",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Quick add",exact:true});
  await dialog.locator('input[name="name"]').fill("Typed company preserved");
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem("enercore-preview-v1")!).records.length);
  await dialog.locator("summary").filter({hasText:"Fill from an inquiry"}).click();
  await dialog.getByLabel("Paste an email or WhatsApp message").fill("Company: Fictional Acme\nProduct: Base Oil SN500\n80 KG\nDestination: Mombasa\nEmail: buyer@example.com");
  await expect(dialog.getByText("buyer@example.com",{exact:true})).toBeVisible();
  await dialog.getByRole("button",{name:"Fill empty fields",exact:true}).click();
  await expect(dialog.locator('input[name="name"]')).toHaveValue("Typed company preserved");
  await expect(dialog.locator('input[name="email"]')).toHaveValue("buyer@example.com");
  await expect(dialog.getByRole("spinbutton",{name:"Quantity",exact:true})).toHaveValue("80");
  await expect(dialog.getByRole("textbox",{name:"Quantity unit",exact:true})).toHaveValue("KG");
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("enercore-preview-v1")!).records.length)).toBe(before);
  expect(aiCalls).toEqual([]);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await dialog.screenshot({path:info.outputPath(`inquiry-${theme}.png`)});
  await dialog.getByRole("button",{name:"Save lead",exact:true}).click();
  await expect(dialog).toHaveCount(0);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("enercore-preview-v1")!).records.find((r:any)=>r.title==="Typed company preserved"));
  expect(saved.quantity).toBe(80);expect(saved.unit).toBe("KG");expect(saved.destination).toBe("Mombasa");expect(saved.attributes.grade).toBe("SN500");
});

test("role priorities have real insets and native disclosures use a consistent chevron", async ({page},info)=>{
  const actor=demoAccounts.find(a=>a.actor.role==="Logistics Manager")!.actor;
  await page.addInitScript(({data,actor})=>{localStorage.setItem("enercore-preview-v1",JSON.stringify(data));localStorage.setItem("enercore-preview-actor",JSON.stringify(actor));localStorage.setItem("enercore-theme","dark");},{data:makePreview(),actor});
  for(const width of [390,768,1440]){
    await page.setViewportSize({width,height:1000});await page.goto("/workspace/all-companies/overview");
    const row=page.locator(".role-queue-item").first();await expect(row).toBeVisible();
    expect(await row.evaluate(el=>{const style=getComputedStyle(el);return parseFloat(style.paddingLeft)>=12&&parseFloat(style.paddingRight)>=12;})).toBe(true);
    const summary=page.locator(".daily-routine > summary");
    expect(await summary.evaluate(el=>getComputedStyle(el).listStyleType)).toBe("none");
    await summary.focus();await page.keyboard.press("Enter");await expect(page.locator(".daily-routine")).toHaveAttribute("open","");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath(`logistics-${width}.png`),fullPage:true});
  }
});

test("authenticated AI capture sends only on click and leaves the draft unsaved", async ({browser},info)=>{
  const context=await browser.newContext({baseURL:"http://127.0.0.1:8789",viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  try {
    const auth=await context.request.post("/api/auth",{headers:{Origin:"http://localhost:8788"},data:{email:"studio@collab.test",password:"Collab-Test-Password-1"}});
    expect(auth.status()).toBe(200);
    const cookie=(await context.cookies()).map(c=>`${c.name}=${c.value}`).join("; ");
    const page=await context.newPage(), sent:string[]=[];
    // This isolated Worker listens on 8789 but its fixture's trusted APP_URL
    // remains 8788. Production uses matching origins; don't weaken its guard.
    await page.route("**/api/ai/capture", async route=>{
      const response=await context.request.post(route.request().url(), {headers:{Origin:"http://localhost:8788",Cookie:cookie},data:JSON.parse(route.request().postData()!)});
      await route.fulfill({response});
    });
    page.on("request",r=>{if(r.method()==="POST"&&r.url().includes("/api/ai/capture"))sent.push(r.postData()||"");});
    await page.goto("/workspace/all-companies/sales-pipeline");
    await page.getByRole("button",{name:"Quick add",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"Quick add",exact:true});
    await dialog.locator("summary").filter({hasText:"Fill from an inquiry"}).click();
    await dialog.getByLabel("Paste an email or WhatsApp message").fill("Company: Fictional AI Customer\nProduct: Base Oil SN500\n80 MT\nEmail: buyer@example.com");
    expect(sent).toEqual([]);
    const result=page.waitForResponse(r=>r.url().includes("/api/ai/capture")&&r.request().method()==="POST");
    await dialog.getByRole("button",{name:"Suggest with AI",exact:true}).click();
    const response=await result;expect(response.status(),JSON.stringify(await response.json())+" request="+sent[0]).toBe(200);
    await expect(dialog.getByText("AI suggestions checked against your text.",{exact:false})).toBeVisible();
    expect(sent.length).toBe(1);
    await expect(dialog.locator('input[name="name"]')).toHaveValue("");
    await dialog.getByRole("button",{name:"Fill empty fields",exact:true}).click();
    await expect(dialog.locator('input[name="name"]')).toHaveValue("Fictional AI Customer");
    await expect(dialog).toBeVisible();
    await dialog.screenshot({path:info.outputPath("authenticated-ai-draft.png")});
    await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
    await expect(dialog).toHaveCount(0);
  } finally {await context.close();}
});
