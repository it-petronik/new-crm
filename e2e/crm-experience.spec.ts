import { test, expect } from "@playwright/test";
import { makePreview, previewActor } from "../src/lib/fixtures";
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(
    ({ actor, data }) => {
      localStorage.setItem("enercore-preview-actor", JSON.stringify(actor));
      localStorage.setItem("enercore-preview-v1", JSON.stringify(data));
    },
    { actor: previewActor, data: makePreview() },
  );
});
test("chat uses a left history rail and plain answers; chats restore and delete locally", async ({
  page,
}, info) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/(ai|records)/.test(r.url()))
      writes.push(r.url());
  });
  await page.goto("/workspace/all-companies/enercore-ai");
  const history = page.getByRole("complementary", { name: "Chat history" });
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(history).toBeVisible();
  const h = await history.boundingBox(),
    l = await log.boundingBox();
  expect(h!.x + h!.width).toBeLessThanOrEqual(l!.x + 1);
  await history.getByRole("button", { name: "New chat", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message Enercore AI" })
    .fill("Which leads need attention now?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const answer = page.getByRole("region", { name: "AI answer", exact: true });
  await expect(answer).toContainText(/overdue leads?/);
  await expect(
    answer.locator(".ai-result-heading,.ai-summary,.ai-facts"),
  ).toHaveCount(0);
  await expect(answer.locator("details")).not.toHaveAttribute("open", "");
  await expect(
    answer.getByRole("button", { name: "Copy answer", exact: true }),
  ).toBeVisible();
  await expect(
    answer.getByRole("button", { name: "Read answer aloud", exact: true }),
  ).toBeVisible();
  await history.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(answer).toHaveCount(0);
  await history
    .getByRole("button", {
      name: "Which leads need attention now?",
      exact: true,
    })
    .click();
  await expect(answer).toBeVisible();
  await page.reload();
  await expect(answer).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.screenshot({
      path: info.outputPath(`conversation-${theme}.png`),
    });
  }
  await history
    .getByRole("button", {
      name: "Delete chat: Which leads need attention now?",
      exact: true,
    })
    .click();
  const confirm = page.getByRole("dialog", {
    name: "Delete this chat?",
    exact: true,
  });
  await confirm
    .getByRole("button", { name: "Delete chat", exact: true })
    .click();
  await expect(answer).toHaveCount(0);
  expect(writes).toEqual([]);
});
test("restored page widget shares only by explicit send and opens its chat in the full view", async ({
  page,
}, info) => {
  const aiRequests: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/ai/.test(r.url())) aiRequests.push(r.url());
  });
  await page.goto("/workspace/all-companies/lead-desk");
  await page
    .getByRole("button", { name: "Open Enercore assistant", exact: true })
    .click();
  const widget = page.getByRole("dialog", {
    name: "Enercore assistant",
    exact: true,
  });
  await expect(widget).toBeVisible();
  await expect(page.locator(".ui-dialog-overlay")).toHaveCount(0);
  await page
    .getByRole("columnheader", { name: "Lead / company", exact: true })
    .getByRole("button")
    .click();
  await expect(widget).toBeVisible();
  const share = widget.getByRole("checkbox", {
    name: "Use current page context",
    exact: true,
  });
  await expect(share).not.toBeChecked();
  await widget
    .getByRole("button", { name: "Explain this page", exact: true })
    .click();
  await expect(share).toBeChecked();
  await expect(
    widget.getByRole("region", { name: "AI answer", exact: true }),
  ).toHaveCount(0);
  await expect(widget).toContainText(
    "No screen image, unsaved form fields or files.",
  );
  await widget
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(
    widget.getByRole("region", { name: "AI answer", exact: true }),
  ).toContainText("This is your Lead Desk");
  await page.screenshot({ path: info.outputPath("page-assistant.png") });
  expect(aiRequests).toEqual([]);
  await widget
    .getByRole("button", { name: "Open full chat", exact: true })
    .click();
  await expect(widget).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Chat history" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "AI answer", exact: true }),
  ).toContainText("This is your Lead Desk");
});
test("Lead Desk uses one pipeline icon and preserves the list when switched back", async ({
  page,
}, info) => {
  await page.goto("/workspace/all-companies/lead-desk");
  await expect(
    page.getByRole("tablist", { name: "Lead Desk views", exact: true }),
  ).toHaveCount(0);
  const desk = page.getByRole("region", { name: "Lead Desk", exact: true });
  const toggle = page.locator(".pipeline-toggle");
  await expect(toggle).toHaveAccessibleName("Show pipeline");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const search = desk.getByRole("searchbox", {
    name: "Search leads or product grade",
    exact: true,
  });
  await search.fill("Atlas");
  const sort = desk.getByRole("columnheader", {
    name: "Lead / company",
    exact: true,
  });
  await sort.getByRole("button").click();
  await desk
    .getByRole("checkbox", {
      name: "Select Atlas Marine Services",
      exact: true,
    })
    .check();
  const actions = page.locator('.page-action-group[data-action-count="6"]');
  await expect(actions).toBeVisible();
  await expect(
    actions.getByRole("button", { name: "Import", exact: true }),
  ).toBeVisible();
  await expect(
    actions.getByRole("button", {
      name: "More actions for Lead Desk",
      exact: true,
    }),
  ).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAccessibleName("Hide pipeline");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const pipeline = page.getByRole("region", {
    name: "Lead pipeline board",
    exact: true,
  });
  await expect(pipeline).toBeVisible();
  await expect(desk).toBeHidden();
  await expect(page).toHaveURL(/\/lead-desk$/);
  await expect(
    pipeline.getByRole("button", { name: "Add lead", exact: true }),
  ).toHaveCount(0);
  expect(
    await pipeline
      .locator("article footer")
      .evaluateAll((els) =>
        els.every((el) => el.scrollWidth <= el.clientWidth + 1),
      ),
  ).toBe(true);
  await pipeline
    .getByRole("button", {
      name: "More actions for Atlas Marine Services",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Edit details", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Lead Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Lead workspace view", exact: true }),
  ).toHaveCount(0);
  await page.locator("#main").focus();
  await page.mouse.move(255,100);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.screenshot({
      path: info.outputPath(`lead-pipeline-${theme}.png`),
    });
  }
  const stage = pipeline.getByRole("combobox", {
    name: "Pipeline stage",
    exact: true,
  });
  await stage.click();
  await page.getByRole("option", { name: "On Hold", exact: true }).click();
  await expect(pipeline.getByText("No leads", { exact: true })).toBeVisible();
  await expect(stage).toBeVisible();
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(pipeline).toBeHidden();
  await expect(desk).toBeVisible();
  await expect(search).toHaveValue("Atlas");
  await expect(sort).toHaveAttribute("aria-sort", "ascending");
  await expect(
    desk.getByRole("checkbox", {
      name: "Select Atlas Marine Services",
      exact: true,
    }),
  ).toBeChecked();
  await page.addInitScript(
    (actor) =>
      localStorage.setItem(
        "enercore-preview-actor",
        JSON.stringify({ ...actor, role: "Sales Executive" }),
      ),
    previewActor,
  );
  await page.reload();
  const salesActions = page.locator(
    '.page-action-group[data-action-count="5"]',
  );
  await expect(salesActions).toBeVisible();
  await expect(
    salesActions.getByRole("button", { name: /More actions/ }),
  ).toHaveCount(0);
  await expect(
    salesActions.getByRole("button", { name: "Weekly report", exact: true }),
  ).toBeVisible();
});
test("interactive tables use one visual specification in light and dark", async ({
  page,
}, info) => {
  for (const theme of ["light", "dark"]) {
    const styles: unknown[] = [];
    for (const route of ["lead-desk", "customers", "people-hr"]) {
      await page.goto(`/workspace/all-companies/${route}`);
      if (route === "people-hr") {
        await page
          .getByRole("combobox", { name: "HR workspace section", exact: true })
          .click();
        await page
          .getByRole("option", { name: "Attendance", exact: true })
          .click();
      }
      await page.evaluate(
        (t) => (document.documentElement.dataset.theme = t),
        theme,
      );
      const table = page.locator("table[data-crm-table]").first();
      await expect(table).toBeVisible();
      styles.push(
        await table.evaluate((el) => {
          const th = el.querySelector("thead th:not(.table-select-cell)")!,
            s = getComputedStyle(th),
            body = getComputedStyle(el);
          const sort = th.querySelector(".column-sort");
          return {
            bodyFont: body.fontSize,
            headerFont: s.fontSize,
            background: s.backgroundColor,
            padding: sort ? getComputedStyle(sort).padding : s.padding,
          };
        }),
      );
      await page.screenshot({
        path: info.outputPath(`table-${route}-${theme}.png`),
      });
    }
    expect(styles[1]).toEqual(styles[0]);
    expect(styles[2]).toEqual(styles[0]);
  }
});

test("opening a slow form shows a real dialog skeleton instead of loading text", async ({
  page,
}, info) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(/quick-add_tsx.*\.js(?:\?.*)?$/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/workspace/all-companies/lead-desk");
  await page.getByRole("button", { name: "Quick add", exact: true }).click();
  try {
    const skeleton = page.locator(".dialog-skeleton");
    await expect(skeleton).toBeVisible();
    await expect(
      skeleton.getByRole("status", { name: "Preparing form", exact: true }),
    ).toBeVisible();
    await expect(skeleton.locator(".skeleton")).toHaveCount(15);
    await expect(skeleton.getByText(/Opening|Loading/)).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("dialog-skeleton.png") });
  } finally {
    release();
  }
  await expect(
    page.getByRole("dialog", { name: "Quick add", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".dialog-skeleton")).toHaveCount(0);
});

test("a form can be cancelled before its download finishes", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(/quick-add_tsx.*\.js(?:\?.*)?$/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/workspace/all-companies/lead-desk");
  await page.getByRole("button", { name: "Quick add", exact: true }).click();
  try {
    await expect(page.locator(".dialog-skeleton")).toBeVisible();
    await page
      .locator(".dialog-skeleton")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(page.locator(".dialog-skeleton")).toHaveCount(0);
  } finally {
    release();
  }
  await expect(
    page.getByRole("dialog", { name: "Quick add", exact: true }),
  ).toHaveCount(0);
});
