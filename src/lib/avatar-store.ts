"use client";
import { useEffect, useState } from "react";

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
  window.dispatchEvent(new CustomEvent(changed, { detail: id }));
}

/** Reads after mount so the server and first client render stay identical. */
export function useAvatar(id: string) {
  const [image, setImage] = useState("");
  useEffect(() => {
    const sync = () => setImage(readAvatar(id));
    sync();
    window.addEventListener(changed, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(changed, sync);
      window.removeEventListener("storage", sync);
    };
  }, [id]);
  return image;
}
