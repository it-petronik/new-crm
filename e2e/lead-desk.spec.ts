import { test, expect } from "@playwright/test";
import { makePreview, previewActor } from "../src/lib/fixtures";
import { initializeLead, businessToday } from "../src/lib/lead-desk";
import type { Actor } from "../src/lib/domain";
import { readFileSync } from "node:fs";
async function choose(page: import("@playwright/test").Page, root: import("@playwright/test").Locator, name: string, value: string) {
  await root.getByRole("combobox", {name,exact:true}).click();
  await page.getByRole("option", {name:new RegExp(`^${value}$`,"i")}).click();
}
async function tools(page: import("@playwright/test").Page, desk: import("@playwright/test").Locator, action: string) {
  const label=action==="Export weekly report"?"Weekly report":action;
  const direct=desk.getByRole("button",{name:label,exact:true});
  if(await direct.count())await direct.click();else{await desk.getByRole("button",{name:"More actions for Lead Desk",exact:true}).click();await page.getByRole("menuitem",{name:label,exact:true}).click();}
  if(action==="More numbers") await desk.getByText("Management breakdown · brand, product, owner & source",{exact:true}).click();
}

function seed(actor: Actor = previewActor) {
  const data = makePreview();
  const base = data.records.find((r) => r.kind === "leads")!;
  data.records = [
    ...data.records.filter((r) => r.kind !== "leads"),
    ...["Buyer inquiry", "Buyer prospect", "Supplier offer"].map(
      (leadType, i) =>
        initializeLead(
          {
            ...base,
            id: `DESK-${i}`,
            title: `Fictional ${leadType}`,
            ownerId: actor.id,
            owner: actor.name,
            status: "New",
            due: businessToday(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attributes: { leadType },
          },
          actor,
        ),
    ),
  ];
  return { actor, data };
}
async function load(
  page: import("@playwright/test").Page,
  input = seed(),
  dark = false,
) {
  await page.addInitScript(
    ({ actor, data, dark }) => {
      if (!localStorage.getItem("enercore-preview-v1"))
        localStorage.setItem("enercore-preview-v1", JSON.stringify(data));
      localStorage.setItem("enercore-preview-actor", JSON.stringify(actor));
      localStorage.setItem("enercore-theme", dark ? "dark" : "light");
    },
    { ...input, dark },
  );
  await page.goto("/?module=leads&company=Petronik");
  await expect(
    page.getByRole("heading", { name: "Lead Desk", exact: true }),
  ).toBeVisible();
}
test("one-page lead update records acknowledgement, outcome and next follow-up without fake response timing", async ({
  page,
}, info) => {
  await load(page, seed({ ...previewActor, role: "Sales Executive" }));
  const desk = page.getByRole("region", { name: "Lead Desk", exact: true });
  await choose(page,desk,"Show leads","All leads");
  const row = desk.locator("[data-lead-row]").filter({
    has: page.getByRole("button", {
      name: "Fictional Buyer inquiry",
      exact: true,
    }),
  });
  await row.getByRole("button", { name: "Update / feedback" }).click();
  const update = page.getByRole("dialog", {name:"Lead update",exact:true});
  await update.getByRole("button", { name: "Acknowledge assignment" }).click();
  await expect(update.getByText(/Assignment acknowledged/).first()).toBeVisible();
  await choose(page,update,"Conversation outcome","Interested");
  await update.getByRole("button", { name: "Save outcome" }).click();
  await expect(
    update.locator("strong").filter({ hasText: "Interested" }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("enercore-preview-v1")!).records.find(
      (r: { id: string }) => r.id === "DESK-0",
    ),
  );
  expect(saved.status).toBe("Contacted");
  expect(saved.attributes.leadFirstResponseAt).toBeTruthy();
  expect(saved.attributes.leadReceivedAt).toBeUndefined();
  await update.getByRole("button", {name:"Close dialog",exact:true}).click();
  await expect(row.getByRole("button",{name:"Update / feedback"})).toBeFocused();
  await tools(page,desk,"More numbers");
  await expect(desk.getByText("Unknown", { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await tools(page,desk,"Export weekly report");
  const download = await downloadPromise;
  const path = await download.path();
  const csv = readFileSync(path!, "utf8");
  expect(csv).toContain("Supplier offer");
  expect(csv).toContain("Buyer inquiries,1");
  expect(csv).toContain("Median first response,Unknown");
  for (const section of ["By brand", "By product / grade", "By owner", "By source", "New inquiries", "Quantity,Unit,Destination / port", "Missing qualification details"])
    expect(csv).toContain(section);
  await page.screenshot({
    path: info.outputPath("lead-desk-desktop.png"),
    fullPage: true,
  });
});
test("needs assignment finds manager-held leads and the guide names the agreed review facilitators", async ({ page }) => {
  const input = seed();
  const assigned = input.data.records.find(r => r.id === "DESK-0")!;
  assigned.attributes = { ...assigned.attributes, leadOwnerRole: "Sales Executive" };
  await load(page, input);
  const desk = page.getByRole("region", { name: "Lead Desk", exact: true });
  await choose(page, desk, "Show leads", "Needs assignment");
  await expect(desk.locator("[data-lead-row]")).toHaveCount(2);
  await expect(desk.getByRole("button", { name: "Fictional Buyer inquiry", exact: true })).toHaveCount(0);
  await desk.getByText("Team guide · daily routine & responsibilities", { exact: true }).click();
  await expect(desk.getByText(/IT, Liera or the MD can run the weekly/)).toBeVisible();
  await expect(desk.getByText(/Aleena and Max handle Sales/)).toBeVisible();
  await choose(page, desk, "Show leads", "All leads");
  await expect(desk.locator("[data-lead-row]")).toHaveCount(3);
});
test("management breakdown covers five allowed brands and source summaries in light/dark mobile and desktop", async ({ page }, info) => {
  await load(page);
  await page.goto("/workspace/all-companies/sales-pipeline");
  const desk = page.getByRole("region", { name: "Lead Desk", exact: true });
  await desk.getByText("Management breakdown · brand, product, owner & source", { exact: true }).click();
  const brand = desk.locator("section").filter({ has: page.getByRole("heading", { name: "By brand", exact: true }) });
  await expect(brand.locator("tbody tr")).toHaveCount(5);
  await expect(desk.getByRole("heading", { name: "By source", exact: true })).toBeVisible();
  for (const width of [360, 768, 1440]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`management-${theme}-${width}.png`), fullPage: true });
  }
});
test("not-relevant needs a reason, supplier opportunities cannot request customer quotations", async ({
  page,
}) => {
  await load(page);
  const desk = page.getByRole("region", { name: "Lead Desk", exact: true });
  await choose(page,desk,"Show leads","All leads");
  const row = desk.locator("[data-lead-row]").filter({
    has: page.getByRole("button", {
      name: "Fictional Supplier offer",
      exact: true,
    }),
  });
  await row.getByRole("button", { name: "Update / feedback" }).click();
  const update = page.getByRole("dialog", {name:"Lead update",exact:true});
  await update.getByRole("combobox",{name:"Conversation outcome"}).click();
  await expect(page.getByRole("option",{name:"Quotation Needed",exact:true})).toHaveCount(0);
  await page.getByRole("option",{name:"Not Relevant",exact:true}).click();
  await expect(update.getByRole("alert")).toHaveCount(0);
  await update.getByRole("button", { name: "Save outcome" }).click();
  await expect(update.getByRole("alert")).toContainText("reason");
  await update
    .getByRole("textbox", { name: "Lead feedback note" })
    .fill("Wrong product category");
  await expect(update.getByRole("textbox",{name:"Lead feedback note"})).toHaveValue("Wrong product category");
  await expect(update.getByRole("alert")).toHaveCount(0);
  await update.getByRole("button", { name: "Save outcome" }).click();
  await expect(update.getByText(/Wrong product category/)).toBeVisible();
  await update.getByRole("button",{name:"Close dialog",exact:true}).click();
  await expect(row.getByText("Lost",{exact:true})).toBeVisible();
  await page.reload();
  await choose(page,desk,"Show leads","All leads");
  await row.getByRole("button",{name:"View feedback"}).click();
  await expect(update.getByText(/Wrong product category/)).toBeVisible();
});
test("marketing can see feedback but cannot record sales contact; dark mobile fits", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await load(
    page,
    seed({ ...previewActor, role: "Marketing Executive" }),
    true,
  );
  const desk = page.getByRole("region", { name: "Lead Desk", exact: true });
  await choose(page,desk,"Show leads","All leads");
  await desk.getByRole("button", { name: "View feedback" }).first().click();
  await expect(
    page.getByRole("dialog",{name:"Lead update",exact:true}).getByRole("combobox", { name: "Conversation outcome", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: info.outputPath("lead-desk-dark-mobile.png"),
    fullPage: true,
  });
});

test("quick capture separates buyer prospects and preserves source and phone without early errors", async ({
  page,
}) => {
  await load(page);
  await page.getByRole("button", { name: "Quick add", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Quick add", exact: true });
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog
    .getByRole("combobox", { name: "Lead type", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Buyer Prospect", exact: true })
    .click();
  await dialog
    .getByRole("combobox", { name: "Lead source", exact: true })
    .click();
  await page.getByRole("option", { name: "WhatsApp", exact: true }).click();
  await dialog.locator('input[name="name"]').fill("Fictional fast capture");
  await dialog
    .getByRole("textbox", { name: "Phone / WhatsApp", exact: true })
    .fill("+971000000000");
  await dialog.getByRole("button", { name: "Save lead", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("enercore-preview-v1")!).records.find(
      (r: { title: string }) => r.title === "Fictional fast capture",
    ),
  );
  expect(saved.attributes.leadType).toBe("Buyer prospect");
  expect(saved.source).toBe("WhatsApp");
  expect(saved.phone).toBe("+971000000000");
  expect(saved.attributes.leadReceivedAt).toBeUndefined();
  expect(saved.product).toBe("");
});

test("quick capture assigns a salesperson immediately and Enercore behaves as a brand", async ({
  page,
}) => {
  await load(page);
  await page.getByRole("button", { name: "New lead", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Quick add", exact: true });
  await dialog
    .getByRole("combobox", { name: "Lead brand", exact: true })
    .click();
  await page.getByRole("option", { name: "Enercore", exact: true }).click();
  await dialog
    .getByRole("combobox", { name: "Assign to salesperson", exact: true })
    .click();
  await page.getByRole("option", { name: "Leila Ahmed", exact: true }).click();
  await dialog.locator('input[name="name"]').fill("Fictional Enercore inquiry");
  await dialog.getByRole("button", { name: "Save lead", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("enercore-preview-v1")!).records.find(
      (r: { title: string }) => r.title === "Fictional Enercore inquiry",
    ),
  );
  expect(saved.company).toBe("Enercore");
  expect(saved.ownerId).toBe("preview-sales");
  expect(saved.attributes.leadCapturedById).toBe(previewActor.id);
});

test("assignment is available on each lead and team setup is one click away", async ({
  page,
}) => {
  await load(page);
  const desk = page.getByRole("region", { name: "Lead Desk", exact: true });
  await desk.locator("[data-lead-row]").first().getByRole("button",{name:/^Assign salesperson for/}).click();
  const dialog = page.getByRole("dialog", {
    name: "Assign to salesperson",
    exact: true,
  });
  await dialog
    .getByRole("combobox", { name: "Responsible salesperson", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Leila Ahmed · Sales Manager", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await choose(page,desk,"Show leads","Created by me");
  await expect(
    desk.getByRole("button", { name: "Fictional Buyer inquiry", exact: true }),
  ).toBeVisible();
  await tools(page,desk,"Manage team");
  await expect(
    page.getByRole("button", { name: "Add user", exact: true }),
  ).toBeVisible();
});

test("sales lists show created and assigned leads, not unrelated sales colleagues", async ({
  page,
}) => {
  const sales = {
    ...previewActor,
    id: "preview-sales",
    name: "Fictional Sales",
    role: "Sales Executive" as const,
  };
  const input = seed(sales),
    template = input.data.records.find((r) => r.kind === "leads")!;
  input.data.records.push({
    ...template,
    id: "created-and-handed-over",
    title: "Fictional handed over",
    ownerId: "other-sales",
    owner: "Other Sales",
    attributes: { ...template.attributes, leadCapturedById: sales.id },
  });
  input.data.records.push({
    ...template,
    id: "unrelated",
    title: "Fictional private colleague",
    ownerId: "other-sales",
    owner: "Other Sales",
    attributes: { ...template.attributes, leadCapturedById: "other-sales" },
  });
  await load(page, input);
  const desk = page.getByRole("region", { name: "Lead Desk", exact: true });
  await expect(
    desk.getByRole("button", { name: "Fictional Buyer inquiry", exact: true }),
  ).toBeVisible();
  await expect(
    desk.getByRole("button", {
      name: "Fictional private colleague",
      exact: true,
    }),
  ).toHaveCount(0);
  await choose(page,desk,"Show leads","Created by me");
  await expect(
    desk.getByRole("button", { name: "Fictional handed over", exact: true }),
  ).toBeVisible();
  await expect(
    desk.getByRole("button", {
      name: "Fictional private colleague",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(desk.getByRole("button",{name:"Manage team",exact:true})).toHaveCount(0);
});

test("read-only overrides hide capture, assignment and record-edit controls rather than offering failing actions", async ({page}) => {
  const person: Actor = {...previewActor, role:"Sales Executive", moduleAccess:{leads:"read",customers:"read",suppliers:"read",products:"read"}};
  await load(page,seed(person));
  await expect(page.getByRole("button",{name:"Quick add",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"New lead",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:/^Assign salesperson for/})).toHaveCount(0);
  await page.keyboard.press("n");await expect(page.getByRole("dialog",{name:"Quick add",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Fictional Buyer inquiry",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Fictional Buyer inquiry",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Edit record",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Create quotation",exact:true})).toHaveCount(0);
  await expect(page.getByRole("combobox",{name:"Update status",exact:true})).toHaveCount(0);
});
