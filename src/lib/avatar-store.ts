"use client";
import { useSyncExternalStore } from "react";

/**
 * Profile pictures are held in this browser only. This is preview storage, not
 * production persistence: it never leaves the device and is not synced.
 */
const key = (id: string) => `enercore-avatar-${id}`;
const changed = "enercore-avatar-changed";

export function readAvatar(id: string) {
  if (typeof window === "undefined" || !id) return "";
  try {
    return window.localStorage.getItem(key(id)) || "";
  } catch {
    return "";
  }
}

export function writeAvatar(id: string, image: string) {
  try {
    if (image) window.localStorage.setItem(key(id), image);
    else window.localStorage.removeItem(key(id));
  } catch {
    // A full or blocked store must not break the page.
  }
  // The boot script's first-paint pictures (boot-script.ts) are only a stand-in
  // until React renders; once a picture changes they would show the old one.
  document.getElementById("enercore-avatar-css")?.remove();
  window.dispatchEvent(new CustomEvent(changed, { detail: id }));
}

const subscribe = (notify: () => void) => {
  window.addEventListener(changed, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(changed, notify);
    window.removeEventListener("storage", notify);
  };
};

/**
 * The saved picture, read during render. The server (and hydration) sees no
 * picture; React then re-renders with the stored one before painting, and
 * the boot script has already shown it on the server-rendered avatar.
 */
export function useAvatar(id: string) {
  return useSyncExternalStore(subscribe, () => readAvatar(id), () => "");
}
