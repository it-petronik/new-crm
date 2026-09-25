"use client";

import { useEffect, useRef } from "react";

/**
 * Makes a scrolling strip's overflow visible on purpose.
 *
 * Marks the element with `data-fade-start` / `data-fade-end` while there is
 * more content before / after the visible part; the `.overflow-fade-x` and
 * `.overflow-fade-y` classes (layout-system.css) turn those into a soft edge
 * fade. At either end the fade disappears, so nothing is ever permanently
 * covered. Recomputed on scroll, on resize and when the content changes.
 */
export function useOverflowFade<T extends HTMLElement>(axis: "x" | "y") {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const start = axis === "x" ? el.scrollLeft : el.scrollTop;
      const room = axis === "x" ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
      const before = start > 1;
      const after = room - start > 1;
      if (el.dataset.fadeStart !== String(before)) el.dataset.fadeStart = String(before);
      if (el.dataset.fadeEnd !== String(after)) el.dataset.fadeEnd = String(after);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    const content = new MutationObserver(update);
    // Content added or removed, or a section expanded/collapsed.
    content.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "aria-expanded", "style"],
    });
    return () => {
      el.removeEventListener("scroll", update);
      resize.disconnect();
      content.disconnect();
    };
  }, [axis]);
  return ref;
}
