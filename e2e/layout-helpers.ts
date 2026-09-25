import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Layout assertions with tolerance.
 *
 * Deliberately not screenshot comparison: font rendering differs between
 * machines and would fail for reasons that have nothing to do with layout.
 * These measure the relationships that actually matter — does anything spill
 * out, do siblings line up, is the gap between sections plausible — and allow
 * a pixel or two of rounding.
 */

/** Nothing may make the page scroll sideways. */
export async function expectNoHorizontalOverflow(page: Page, note = "") {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow${note ? ` (${note})` : ""}`).toBeLessThanOrEqual(1);
}

/** Every element must sit inside the viewport horizontally. */
export async function expectInsideViewport(locator: Locator, page: Page, note = "") {
  const box = (await locator.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x, `${note} starts left of the viewport`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${note} extends past the viewport`).toBeLessThanOrEqual(width + 1);
}

/** Two elements must not sit on top of one another. */
export async function expectNotOverlapping(a: Locator, b: Locator, note = "") {
  const [one, two] = [await a.boundingBox(), await b.boundingBox()];
  if (!one || !two) return;
  const apart =
    one.y + one.height <= two.y + 1 ||
    two.y + two.height <= one.y + 1 ||
    one.x + one.width <= two.x + 1 ||
    two.x + two.width <= one.x + 1;
  expect(apart, `${note} overlap`).toBe(true);
}

/** Siblings that should share an alignment line. */
export async function expectAlignedLeft(a: Locator, b: Locator, tolerance = 2, note = "") {
  const [one, two] = [(await a.boundingBox())!, (await b.boundingBox())!];
  expect(Math.abs(one.x - two.x), `${note} left edges differ`).toBeLessThanOrEqual(tolerance);
}

export async function expectAlignedTop(a: Locator, b: Locator, tolerance = 2, note = "") {
  const [one, two] = [(await a.boundingBox())!, (await b.boundingBox())!];
  expect(Math.abs(one.y - two.y), `${note} top edges differ`).toBeLessThanOrEqual(tolerance);
}

/** The vertical gap between two stacked sections. */
export async function expectReasonableGap(
  above: Locator,
  below: Locator,
  min: number,
  max: number,
  note = "",
) {
  const [one, two] = [(await above.boundingBox())!, (await below.boundingBox())!];
  const gap = two.y - (one.y + one.height);
  expect(gap, `${note} gap of ${Math.round(gap)}px`).toBeGreaterThanOrEqual(min);
  expect(gap, `${note} gap of ${Math.round(gap)}px`).toBeLessThanOrEqual(max);
}

/**
 * The page gutter must be the same on both sides.
 *
 * Measured against the column the container actually sits in, not the
 * viewport: on desktop the sidebar is a real grid column, so comparing to the
 * window would count the sidebar as a left gutter.
 */
export async function expectEqualGutters(container: Locator, page: Page, tolerance = 2) {
  const gutters = await container.evaluate((el) => {
    const parent = el.parentElement ?? document.body;
    const outer = parent.getBoundingClientRect();
    const inner = el.getBoundingClientRect();
    return { left: inner.left - outer.left, right: outer.right - inner.right };
  });
  expect(
    Math.abs(gutters.left - gutters.right),
    `gutters differ: ${Math.round(gutters.left)} vs ${Math.round(gutters.right)}`,
  ).toBeLessThanOrEqual(tolerance);
}

/** Nothing may be hidden behind the sticky header. */
export async function expectBelowHeader(locator: Locator, page: Page, note = "") {
  const header = (await page.locator(".topbar").boundingBox())!;
  const box = (await locator.boundingBox())!;
  expect(box.y, `${note} starts under the header`).toBeGreaterThanOrEqual(header.y + header.height - 1);
}

export const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1536x960", width: 1536, height: 960 },
  { name: "1920x1080", width: 1920, height: 1080 },
] as const;
