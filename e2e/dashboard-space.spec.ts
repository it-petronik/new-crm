import { test, expect } from "@playwright/test";
test("dashboard gives rankings wider independent columns without row gaps", async ({page}, info) => {
  await page.setViewportSize({width:1600,height:1000});
  await page.goto("/?module=overview");
  const stacks = page.locator(".insight-stack");
  await expect(stacks).toHaveCount(2);
  const first = await stacks.first().boundingBox();
  expect(first!.width).toBeGreaterThan(500);
  for (const stack of await stacks.all()) {
    const cards = await stack.locator(":scope > .panel").all();
    for(let i=1;i<cards.length;i++) {
      const previous = (await cards[i-1].boundingBox())!;
      const current = (await cards[i].boundingBox())!;
      expect(Math.round(current.y - previous.y - previous.height)).toBe(20);
    }
  }
  await stacks.first().scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath("dashboard-wide.png"),animations:"disabled"});
  for(const width of [1024,768,390]) {
    await page.setViewportSize({width,height:900});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
