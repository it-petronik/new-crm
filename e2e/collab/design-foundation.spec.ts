import { test, expect } from '@playwright/test';
import { Client } from './client';

let session: Promise<Client> | undefined;
const actor = () => session ??= Client.login('cmmd');

test('appearance uses live controls and remembers the selected theme', async ({browser}) => {
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  await (await actor()).signInBrowser(context);
  const page=await context.newPage();
  await page.goto('/workspace/all-companies/appearance');
  await page.getByRole('button',{name:/Dark mode A softer/}).click();
  await page.getByRole('button',{name:/Ocean Use this palette/}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('html')).toHaveAttribute('data-palette','ocean');
  await page.reload();
  await expect(page.getByRole('button',{name:/Ocean Selected/})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.screenshot({path:'test-results/appearance-dark-desktop.png',animations:'disabled'});
  await page.getByRole('button',{name:/Light mode Clear/}).click();
  await page.getByRole('button',{name:/Company colours Use this palette/}).click();
  await page.screenshot({path:'test-results/appearance-light-desktop.png',animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Preview form',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Form preview'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Done',exact:true})).toBeInViewport();
  await page.screenshot({path:'test-results/appearance-form-phone.png',animations:'disabled'});
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await context.close();
});

test('every accent palette reaches shared controls in light and dark mode', async ({browser}) => {
  const context = await browser.newContext({viewport:{width:1440,height:900}, reducedMotion:'reduce'});
  await (await actor()).signInBrowser(context);
  const page = await context.newPage();
  await page.goto('/workspace/all-companies/it-support');
  const primary = page.getByRole('button',{name:'New ticket',exact:true});
  await expect(primary).toBeVisible();
  for (const theme of ['light','dark']) {
    let previous = '';
    let danger = '';
    for (const palette of ['company','ocean','forest','violet','rose','slate']) {
      await page.evaluate(({theme,palette}) => {
        document.documentElement.dataset.theme=theme;
        document.documentElement.dataset.palette=palette;
      },{theme,palette});
      const result = await primary.evaluate(element => {
        const root = getComputedStyle(document.documentElement);
        const probe = document.createElement('span');
        probe.style.backgroundColor='var(--brand-action)'; document.body.append(probe);
        const expected = getComputedStyle(probe).backgroundColor; probe.remove();
        const style = getComputedStyle(element);
        const luminance = (color:string) => {
          const values = color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);});
          return values[0]*.2126+values[1]*.7152+values[2]*.0722;
        };
        const a=luminance(style.color),b=luminance(style.backgroundColor);
        return {background:style.backgroundColor,expected,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),danger:root.getPropertyValue('--e-danger').trim(),height:element.getBoundingClientRect().height};
      });
      expect(result.background,`${theme}/${palette} primary`).toBe(result.expected);
      expect(result.contrast,`${theme}/${palette} text contrast`).toBeGreaterThanOrEqual(4.5);
      expect(result.height).toBeGreaterThanOrEqual(36);
      if(previous)expect(result.background).not.toBe(previous);
      if(danger)expect(result.danger).toBe(danger);
      previous=result.background;danger=result.danger;
    }
  }
  await context.close();
});

test('shared page guide, list boundary and form grid work at desktop and phone sizes', async ({browser}) => {
  const context=await browser.newContext({reducedMotion:'reduce'});
  const client=await actor();await client.signInBrowser(context);
  const created=await client.request('POST','/api/records',{kind:'it',company:'Petronik',branch:'Main',title:'Design foundation local test',contact:'Fictional review',product:'Layout test',quantity:0,unit:'',amount:0,currency:'USD',due:'2026-10-10',detail:'Temporary local UI fixture',source:'Design verification',requestId:crypto.randomUUID()});
  expect(created.status).toBe(201);
  const page=await context.newPage();
  try {
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:844});
    await page.goto('/workspace/all-companies/it-support');
    const header=page.locator('[data-ui="page-header"]');await expect(header).toBeVisible();
    // The shared Guide supports keyboard activation, collision handling and dismissal.
    const guide=header.getByRole('button',{name:'How this page works'});await guide.focus();await page.keyboard.press('Enter');
    const help=page.getByRole('dialog',{name:'How this page works'});await expect(help).toBeVisible();
    expect(await help.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})).toBe(true);
    await page.keyboard.press('Escape');await expect(help).toBeHidden();await expect(guide).toBeFocused();
    await expect(page.locator('.record-list-surface[data-ui="surface"]')).toBeVisible();
    await page.goto('/workspace/all-companies/marketing');
    await page.getByRole('button',{name:'Plan a post',exact:true}).click();
    const grid=page.locator('[data-ui="form-grid"]');await expect(grid).toBeVisible();
    const columns=await grid.evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(width===390?1:2);
    const dialog=page.getByRole('dialog');
    await expect(dialog.locator('.ui-dialog-footer')).toBeInViewport();
    expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
    await page.screenshot({path:`test-results/design-foundation-form-${width}.png`,animations:'disabled'});
    await page.keyboard.press('Escape');
  }
  } finally {
    const removed=await client.request('PATCH','/api/records',{action:'delete',id:created.body.record.id,expectedUpdatedAt:created.body.record.updatedAt});
    expect(removed.status).toBe(200);
  await context.close();
  }
});
