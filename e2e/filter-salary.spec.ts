import {test,expect} from "@playwright/test";
test("record sorting, search and dashboard custom period",async({page},info)=>{
 await page.goto("/workspace/all-companies/customers");
 // Card views have no columns, so they keep the sort dropdown behind the filter toggle.
 await page.getByRole("button",{name:/^Filters/}).click();
 await page.getByRole("combobox",{name:"Sort records",exact:true}).click();
 await expect(page.getByRole("option",{name:"Newest first",exact:true})).toBeVisible();
 await page.getByRole("option",{name:"Name Z–A",exact:true}).click();
 await page.getByRole("textbox",{name:"Search records",exact:true}).fill("Gulf");
 await expect(page.getByRole("navigation",{name:"records pagination"})).toContainText("1–1 of 1");
 await page.screenshot({path:info.outputPath("filters-desktop.png"),animations:"disabled"});
 await page.goto("/workspace/all-companies/overview");
 await page.locator(".stats-grid").waitFor();
 const segment = page.locator(".chart-segment").first();
 await segment.focus();
 await page.keyboard.press("Enter");
 await expect(segment).toHaveCSS("outline-style","none");
 await expect(segment).toHaveCSS("stroke-width","29px");
 await page.getByRole("combobox",{name:"Dashboard time range"}).click();
 await page.getByRole("option",{name:"Custom dates",exact:true}).click();
 await page.getByRole("button",{name:"Dashboard start date",exact:true}).click();
 await page.getByRole("button",{name:"Today",exact:true}).click();
 await expect(page.getByText("No confirmed orders in this scope and period.",{exact:false})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("pipeline card has one hover surface",async({page})=>{
 await page.goto("/workspace/all-companies/sales-pipeline");
 const card=page.locator(".record-card-shell").first();
 await card.locator(".lead-card").hover();
 await expect(card.locator(".lead-card")).toHaveCSS("transform","none");
 await expect(card.locator(".lead-card")).toHaveCSS("border-top-width","0px");
});
