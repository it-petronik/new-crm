import {test,expect} from '@playwright/test';
import {Client} from './client';
let session: Promise<Client> | undefined;
const layoutActor=()=>session??=Client.login('cmmd');
const routes=['overview','sales-pipeline','quotations','sales-orders','customers','suppliers','products','logistics','accounts','people-hr','marketing','it-support','approvals','activity','settings','access-control','profile','appearance','my-requests','email','collaboration','prospecting','enercore-ai'];
test('calendar and shared empty states follow dark theme on desktop and phone',async({browser})=>{
  const actor=await layoutActor();const context=await browser.newContext();await actor.signInBrowser(context);const page=await context.newPage();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    for(const route of ['marketing','accounts','my-requests']){
      await page.goto(`/workspace/all-companies/${route}`);
      await expect(page.locator('.main-content')).toBeVisible();
      await expect(page.locator('.main-content .skeleton')).toHaveCount(0);
      await page.evaluate(()=>document.documentElement.dataset.theme='dark');
      expect.soft(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await page.screenshot({path:`test-results/layout-dark-${route}-${width}.png`,animations:'disabled'});
    }
  }
  await context.close();
});
for(const width of [1440,768,390]) test(`workspace layouts at ${width}px`,async({browser})=>{
  const actor=await layoutActor();
  const context=await browser.newContext({viewport:{width,height:900}});
  await actor.signInBrowser(context);
  const page=await context.newPage();
  for(const route of routes){
    await page.goto(`/workspace/all-companies/${route}`);
    await expect(page.locator('.main-content')).toBeVisible();
    await page.waitForTimeout(200);
    await expect(page.locator('.main-content .skeleton')).toHaveCount(0);
    const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth,offenders:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0 && r.right>innerWidth+2 && getComputedStyle(e).position!=='fixed';}).slice(0,5).map(e=>e.className)}));
    expect.soft(overflow.page,`${route} at ${width}: ${JSON.stringify(overflow.offenders)}`).toBeLessThanOrEqual(width+1);
    if(['marketing','overview','sales-pipeline','accounts','my-requests'].includes(route)) await page.screenshot({path:`test-results/layout-${route}-${width}.png`,animations:'disabled'});
  }
  await context.close();
});
test('people picker avatar stays beside its label and dialog fits phone',async({browser})=>{
  const actor=await layoutActor();const context=await browser.newContext({viewport:{width:1440,height:900}});await actor.signInBrowser(context);const page=await context.newPage();
  await page.goto('/workspace/all-companies/collaboration');
  await page.getByRole('button',{name:'New message',exact:true}).first().click();
  const row=page.locator('.collab-picker-list button').first();await expect(row).toBeVisible();
  const box=await row.evaluate(e=>{const a=e.querySelector('.collab-person-avatar')!.getBoundingClientRect();const label=e.querySelector('.collab-picker-label')!.getBoundingClientRect();return {gap:label.left-a.right,avatarWidth:a.width};});
  expect(box.gap).toBeLessThanOrEqual(16);expect(box.avatarWidth).toBeLessThanOrEqual(40);
  await page.screenshot({path:'test-results/layout-people-picker.png',animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('dialog')).toBeInViewport();
  await expect(page.getByRole('button',{name:'Close',exact:true})).toBeInViewport();
  await page.screenshot({path:'test-results/layout-people-picker-phone.png',animations:'disabled'});
  await context.close();
});

test('creation dialogs keep header and footer visible without horizontal overflow',async({browser})=>{
  const actor=await layoutActor();const context=await browser.newContext();await actor.signInBrowser(context);const page=await context.newPage();
  const forms=[['sales-pipeline','New lead'],['quotations','New quotation'],['customers','Add customer'],['suppliers','Add supplier'],['products','Add product'],['people-hr','Add employee'],['marketing','Plan a post'],['it-support','New ticket']];
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:844});
    for(const [route,label] of forms){
      await page.goto(`/workspace/all-companies/${route}`);
      await page.getByRole('button',{name:label,exact:true}).first().click();
      const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
      await expect.soft(dialog.locator('.dialog-heading'),`${route} header at ${width}`).toBeInViewport();
      await expect.soft(dialog.locator('.ui-dialog-footer'),`${route} footer at ${width}`).toBeInViewport();
      expect.soft(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1),`${route} dialog overflow at ${width}`).toBe(true);
      expect.soft(await dialog.locator('.dialog-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1),`${route} fields overflow at ${width}`).toBe(true);
      await dialog.locator('.dialog-body').evaluate(e=>e.scrollTop=e.scrollHeight);
      await expect.soft(dialog.locator('.ui-dialog-footer')).toBeInViewport();
      await page.screenshot({path:`test-results/layout-form-${route}-${width}.png`,animations:'disabled'});
      await page.keyboard.press('Escape');
    }
  }
  await context.close();
});

test('populated records remain usable on desktop and phone',async({browser})=>{
  const actor=await layoutActor();const context=await browser.newContext();await actor.signInBrowser(context);const page=await context.newPage();
  const created:{id:string;updatedAt:string}[]=[];
  try {
    // Customer/product creation also makes authoritative commercial entities.
    // Reuse those identifiable local fixtures; their audit-safe deletion guard
    // intentionally retains them, even when they have no transactions yet.
    const existing=(await actor.request('GET','/api/records')).body.records;
    for(const kind of ['leads','customers','suppliers','products','it']){
      if(existing.some((r:{kind:string;title:string;detail:string})=>r.kind===kind && r.title===`Layout check ${kind} – long business name for responsive checking` && r.detail==='Fictional local layout verification only.'))continue;
      const result=await actor.request('POST','/api/records',{kind,company:'Petronik',branch:'Main',title:`Layout check ${kind} – long business name for responsive checking`,contact:'Sample contact',product:'Base Oil SN 500 · specification',quantity:240,unit:'MT',amount:192000,currency:'USD',due:'2026-10-10',detail:'Fictional local layout verification only.',source:'Layout test',requestId:crypto.randomUUID()});
      expect(result.status,JSON.stringify(result.body)).toBe(201);created.push(result.body.record);
    }
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:900});
      for(const route of ['sales-pipeline','customers','suppliers','products','it-support']){
        await page.goto(`/workspace/all-companies/${route}`);
        await expect(page.getByText(/Layout check/).first()).toBeVisible();
        if(route==='sales-pipeline') {
          const card=page.locator('.record-card-shell > .lead-card').first();
          for(const theme of ['light','dark']) {
            await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
            await expect(card).toHaveCSS('border-top-width','0px');
            await expect(card).toHaveCSS('border-top-left-radius','0px');
            await card.hover();
            await expect(card).toHaveCSS('border-top-width','0px');
          }
          // hover() may horizontally reveal the card; review the board from its start.
          await page.mouse.move(0,0);
          await page.locator('.kanban').evaluate(e=>e.scrollLeft=0);
          await page.screenshot({path:`test-results/layout-board-dark-${width}.png`,animations:'disabled'});
          await page.evaluate(()=>document.documentElement.dataset.theme='light');
        }
        if(width===390 && route!=='sales-pipeline'){
          const actions=page.locator('.table-record-actions').first();
          const bounds=await actions.evaluate(e=>[...e.querySelectorAll('button')].map(b=>({top:b.getBoundingClientRect().top,height:b.getBoundingClientRect().height})));
          expect.soft(Math.abs(bounds[0].top-bounds[1].top),`${route} actions stay together`).toBeLessThan(2);
          expect.soft(Math.round(bounds[0].height),`${route} touch target`).toBeGreaterThanOrEqual(44);
        }
        expect.soft(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} populated at ${width}`).toBe(true);
        await page.screenshot({path:`test-results/layout-populated-${route}-${width}.png`,animations:'disabled'});
      }
    }
  } finally {
    for(const r of created){
      const result=await actor.request('PATCH','/api/records',{action:'delete',id:r.id,expectedUpdatedAt:r.updatedAt});
      if(result.status!==200) expect(result.body.error).toBe('Commercial history is linked. Set the record inactive instead of deleting it.');
    }
    await context.close();
  }
});
