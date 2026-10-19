"use client";
import { useEffect, useRef, useState } from "react";

/** Play once on entry, not on hover or every refresh. Data remains in the DOM. */
export function useChartReveal(enabled = true) {
  const ref = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    if (!window.IntersectionObserver || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setEntered(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setEntered(true); observer.disconnect(); }
    // A zoomed chart can be taller than the viewport. Requiring a fixed
    // fraction to enter would leave its data invisible indefinitely.
    }, { threshold: 0 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled]);
  return { ref, "data-chart-entered": entered };
}
