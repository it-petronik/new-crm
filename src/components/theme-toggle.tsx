"use client";
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button, Tooltip } from "./ui/controls";

const subscribe = (notify: () => void) => {
  window.addEventListener("enercore-theme", notify);
  return () => window.removeEventListener("enercore-theme", notify);
};
export const palettes = [
  { id: "company", name: "Company colours", colors: ["#087b89", "#c99d40", "#ba2830"] },
  { id: "ocean", name: "Ocean", colors: ["#0369a1", "#38bdf8", "#e0f2fe"] },
  { id: "forest", name: "Forest", colors: ["#047857", "#34d399", "#ecfdf5"] },
  { id: "violet", name: "Violet", colors: ["#6d28d9", "#a78bfa", "#f5f3ff"] },
  { id: "rose", name: "Rose", colors: ["#be123c", "#fb7185", "#fff1f2"] },
  { id: "slate", name: "Slate", colors: ["#475569", "#94a3b8", "#f1f5f9"] },
] as const;
export function usePalette() {
  return useSyncExternalStore(subscribe, () => document.documentElement.dataset.palette || "company", () => "company");
}
export function setPalette(palette: string) {
  if (!palettes.some(p => p.id === palette)) return;
  document.documentElement.dataset.palette = palette;
  try { localStorage.setItem("enercore-palette", palette); } catch {}
  window.dispatchEvent(new Event("enercore-theme"));
}
export function useTheme() {
  return useSyncExternalStore(
    subscribe,
    () =>
      document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    () => "light",
  );
}
export function setTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("enercore-theme", theme);
  } catch {}
  window.dispatchEvent(new Event("enercore-theme"));
}
export default function ThemeToggle() {
  const dark = useTheme() === "dark";
  function toggle() {
    setTheme(dark ? "light" : "dark");
  }
  return (
    <Tooltip label={dark ? "Switch to light mode" : "Switch to dark mode"}>
      <Button
        type="button"
        className="icon-button theme-toggle"
        aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
        onClick={toggle}
      >
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </Button>
    </Tooltip>
  );
}
