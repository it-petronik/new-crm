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
test("page headings, preview strip and content have consistent left and right gutters", async ({
  page,
}, info) => {
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of [
      "people-hr",
      "lead-desk",
      "customers",
      "enercore-ai",
    ]) {
      await page.goto(`/workspace/all-companies/${route}`);
      await expect(page.locator("#main h1").first()).toBeVisible();
      const metrics = await page.locator("#main").evaluate((el) => {
        const css = getComputedStyle(el),
          header = el.querySelector('[data-ui="page-header"]'),
          h = header?.querySelector("h1");
        const banner =
          document.querySelector('header[role="banner"]') ||
          document.querySelector("header[class*=topbar_]");
        const preview = document.querySelector("[class*=frame_preview_]");
        return {
          left: css.paddingLeft,
          right: css.paddingRight,
          headingInset:
            header && h
              ? h.getBoundingClientRect().left -
                header.getBoundingClientRect().left
              : 0,
          topbar: banner ? getComputedStyle(banner).paddingLeft : null,
          preview: preview ? getComputedStyle(preview).paddingLeft : null,
        };
      });
      expect(metrics.left).toBe(metrics.right);
      expect(metrics.headingInset).toBeLessThanOrEqual(1);
      expect(metrics.topbar).toBe(metrics.left);
      expect(metrics.preview).toBe(metrics.left);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
    await page.screenshot({
      path: info.outputPath(`page-gutters-${width}.png`),
    });
  }
});
test("AI drawer shares one gutter and uses a retained slide-out on every close path", async ({
  page,
}, info) => {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/ai/.test(r.url())) posts.push(r.url());
  });
  await page.goto("/workspace/all-companies/people-hr");
  const trigger = page.getByRole("button", {
    name: "Open Enercore assistant",
    exact: true,
  });
  const widget = page.locator(".ai-page-assistant");
  for (const closing of ["Close", "Close dialog", "Escape"]) {
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(widget).toHaveAttribute("data-state", "open");
    await expect(
      widget.getByRole("textbox", { name: "Message Enercore AI", exact: true }),
    ).toBeVisible();
    expect(
      await widget.evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("ai-panel-enter");
    await widget.evaluate(async (el) => {
      await Promise.allSettled(el.getAnimations().map((a) => a.finished));
    });
    const gutters = await widget.evaluate((el) =>
      [
        ...el.querySelectorAll(
          ".studio-dialog-heading,.ui-dialog-footer,[class*=heading_],[class*=conversation_],[class*=composerArea_]",
        ),
      ].map((e) => ({
        left: getComputedStyle(e).paddingLeft,
        right: getComputedStyle(e).paddingRight,
      })),
    );
    expect(gutters.length).toBeGreaterThanOrEqual(5);
    for (const g of gutters) expect(g).toEqual({ left: "20px", right: "20px" });
    const rect = await widget.boundingBox();
    expect(rect!.y).toBe(16);
    expect(1000 - rect!.y - rect!.height).toBe(16);
    expect(1440 - rect!.x - rect!.width).toBe(16);
    await expect(page.locator(".ui-dialog-overlay")).toHaveCount(0);
    for (const theme of closing === "Close" ? ["light", "dark"] : []) {
      await page.evaluate(
        (t) => (document.documentElement.dataset.theme = t),
        theme,
      );
      await page.screenshot({
        path: info.outputPath(`assistant-${theme}.png`),
        animations: "disabled",
      });
    }
    if (closing === "Escape") await page.keyboard.press("Escape");
    else
      await widget.getByRole("button", { name: closing, exact: true }).click();
    await expect(widget).toHaveAttribute("data-state", "closed");
    expect(
      await widget.evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("ai-panel-exit");
    await expect(widget).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  expect(posts).toEqual([]);
});
test("chat history collapses smoothly without remounting the draft or exposing hidden controls", async ({
  page,
}, info) => {
  await page.goto("/workspace/all-companies/enercore-ai");
  const chat = page.getByRole("region", {
    name: "Enercore AI chat",
    exact: true,
  });
  const composer = chat.getByRole("textbox", {
    name: "Message Enercore AI",
    exact: true,
  });
  await composer.fill("Keep this draft while I switch the sidebar");
  await chat
    .getByRole("button", { name: "Hide chat history", exact: true })
    .click();
  const hidden = chat.locator('aside[aria-label="Chat history"]');
  await expect(hidden).toHaveAttribute("inert", "");
  await expect(hidden).toHaveAttribute("aria-hidden", "true");
  await expect(
    chat.getByRole("button", { name: "Show chat history", exact: true }),
  ).toBeFocused();
  expect(
    await chat.evaluate((el) => getComputedStyle(el).transitionProperty),
  ).toContain("grid-template-columns");
  await expect
    .poll(() => hidden.evaluate((el) => el.getBoundingClientRect().width))
    .toBeLessThanOrEqual(1);
  await expect(composer).toHaveValue(
    "Keep this draft while I switch the sidebar",
  );
  await page.screenshot({ path: info.outputPath("history-collapsed.png") });
  await chat
    .getByRole("button", { name: "Show chat history", exact: true })
    .click();
  await expect(
    chat.getByRole("complementary", { name: "Chat history", exact: true }),
  ).toBeVisible();
  await expect(
    chat.getByRole("button", { name: "Hide chat history", exact: true }),
  ).toBeFocused();
  await expect(hidden).not.toHaveAttribute("inert");
  await expect
    .poll(() => hidden.evaluate((el) => el.getBoundingClientRect().width))
    .toBeGreaterThan(200);
  await expect(composer).toHaveValue(
    "Keep this draft while I switch the sidebar",
  );
});
test("reduced-motion users get immediate panel and history changes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/workspace/all-companies/people-hr");
  await page
    .getByRole("button", { name: "Open Enercore assistant", exact: true })
    .click();
  const widget = page.locator(".ai-page-assistant");
  await expect(widget).toBeVisible();
  expect(
    await widget.evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await widget.getByRole("button", { name: "Close", exact: true }).click();
  await expect(widget).toHaveCount(0);
  await page
    .getByRole("button", { name: "Ask Enercore AI", exact: true })
    .click();
  const chat = page.getByRole("region", {
    name: "Enercore AI chat",
    exact: true,
  });
  await chat
    .getByRole("button", { name: "Hide chat history", exact: true })
    .click();
  expect(
    await chat.evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  await expect(
    chat.getByRole("button", { name: "Show chat history", exact: true }),
  ).toBeFocused();
});
