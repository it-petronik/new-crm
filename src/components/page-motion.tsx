"use client";
import { useEffect, useRef } from "react";
/** Animate only the visible content, never remount forms or reset navigation. */
export function PageMotion({ routeKey }: { routeKey: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const content = anchor.current
      ?.closest("main")
      ?.querySelector<HTMLElement>(".page-under-record");
    const animation = content?.animate(
      [
        { opacity: 0.45, transform: "translateY(5px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
    return () => animation?.cancel();
  }, [routeKey]);
  return <span ref={anchor} hidden />;
}
