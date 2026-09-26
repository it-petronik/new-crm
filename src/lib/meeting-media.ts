/**
 * Meeting media, shared by employees and guests alike: quality presets,
 * per-device preferences, the background-effect catalogue, friendly device
 * errors, device fallback and privacy-safe diagnostics.
 *
 * Nothing here ever records device ids, frames, audio, images or raw error
 * text — only states and event names.
 */

import type { LocalAudioTrack, LocalVideoTrack } from "livekit-client";

/**
 * What the pre-join screen hands the meeting: the live tracks themselves
 * (published as they are — never re-opened) and the person's settings.
 */
export type MediaHandoff = {
  video?: LocalVideoTrack;
  audio?: LocalAudioTrack;
  quality: QualityMode;
  effect: BackgroundEffect;
  /** A local object URL for "your image"; the meeting revokes it when it ends. */
  customUrl: string | null;
};

/* ------------------------------------------------------------- quality */

export type QualityMode = "auto" | "saver" | "high";

export const QUALITY_LABELS: Record<QualityMode, { label: string; hint: string }> = {
  auto: { label: "Auto", hint: "Recommended — adjusts to your connection" },
  saver: { label: "Data saver", hint: "Lower video quality, less data" },
  high: { label: "High quality", hint: "Sharper video when your connection allows" },
};

type Layer = { width: number; height: number; maxBitrate: number; maxFramerate: number };

/**
 * What each mode captures and publishes. Everyone — employees and guests —
 * uses the same presets. Simulcast sends a few layers so each viewer gets
 * what their tile size and connection need (adaptive stream + dynacast).
 */
export const QUALITY_PRESETS: Record<QualityMode, { capture: { width: number; height: number; frameRate: number }; encoding: { maxBitrate: number; maxFramerate: number }; layers: Layer[] }> = {
  auto: {
    capture: { width: 1280, height: 720, frameRate: 30 },
    encoding: { maxBitrate: 1_700_000, maxFramerate: 30 },
    layers: [
      { width: 320, height: 180, maxBitrate: 160_000, maxFramerate: 15 },
      { width: 640, height: 360, maxBitrate: 450_000, maxFramerate: 20 },
    ],
  },
  saver: {
    capture: { width: 640, height: 360, frameRate: 15 },
    encoding: { maxBitrate: 350_000, maxFramerate: 15 },
    layers: [{ width: 320, height: 180, maxBitrate: 120_000, maxFramerate: 15 }],
  },
  high: {
    capture: { width: 1280, height: 720, frameRate: 30 },
    encoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
    layers: [
      { width: 320, height: 180, maxBitrate: 160_000, maxFramerate: 15 },
      { width: 960, height: 540, maxBitrate: 900_000, maxFramerate: 30 },
    ],
  },
};

/* ---------------------------------------------------------- backgrounds */

export type BackgroundEffect =
  | { kind: "none" }
  | { kind: "blur"; strength: "normal" | "strong" }
  | { kind: "remove" }
  | { kind: "image"; id: OfficeBackgroundId }
  | { kind: "colour"; id: SolidColourId }
  | { kind: "custom" };

export const OFFICE_BACKGROUNDS = [
  { id: "modern-office", label: "Modern office" },
  { id: "conference-room", label: "Conference room" },
  { id: "minimal-office", label: "Minimal office" },
  { id: "neutral-workspace", label: "Neutral workspace" },
  { id: "executive-library", label: "Executive library" },
] as const;
export type OfficeBackgroundId = (typeof OFFICE_BACKGROUNDS)[number]["id"];

export const SOLID_COLOURS = [
  { id: "gray", label: "Neutral gray", hex: "#8e9399" },
  { id: "charcoal", label: "Charcoal", hex: "#3a3f44" },
  { id: "navy", label: "Navy", hex: "#1f2f4a" },
  { id: "blue", label: "Soft blue", hex: "#9fb8cf" },
  { id: "green", label: "Muted green", hex: "#8fa58f" },
  { id: "black", label: "Black", hex: "#111315" },
  { id: "light", label: "Light neutral", hex: "#eceae6" },
] as const;
export type SolidColourId = (typeof SOLID_COLOURS)[number]["id"];

/** "Remove background" composites onto this: an opaque, calm studio tone — never transparency. */
export const REMOVED_BACKGROUND_HEX = "#dfe2e5";

export const BLUR_RADIUS = { normal: 10, strong: 24 } as const;

export const backgroundImagePath = (id: OfficeBackgroundId) => `/meetings/backgrounds/${id}.jpg`;
export const backgroundThumbPath = (id: OfficeBackgroundId) => `/meetings/backgrounds/${id}-thumb.jpg`;
export const SEGMENTER_ASSETS = {
  tasksVisionFileSet: "/meetings/segmenter/wasm",
  modelAssetPath: "/meetings/segmenter/selfie_segmenter.tflite",
};

export function effectLabel(effect: BackgroundEffect) {
  switch (effect.kind) {
    case "none":
      return "No effect";
    case "blur":
      return effect.strength === "strong" ? "Strong blur" : "Blur";
    case "remove":
      return "Background removed";
    case "image":
      return `${OFFICE_BACKGROUNDS.find((b) => b.id === effect.id)?.label ?? "Office"} background`;
    case "colour":
      return `Solid ${SOLID_COLOURS.find((c) => c.id === effect.id)?.label.toLowerCase() ?? "colour"} background`;
    case "custom":
      return "Your image";
  }
}

export const sameEffect = (a: BackgroundEffect, b: BackgroundEffect) => JSON.stringify(a) === JSON.stringify(b);

/* ---------------------------------------------------------- preferences */

export type MediaPrefs = { quality: QualityMode; effect: BackgroundEffect };
export const DEFAULT_PREFS: MediaPrefs = { quality: "auto", effect: { kind: "none" } };

const PREFS_KEY = "enercore-meeting-media";

/** Validates stored preferences: anything unknown falls back to the default. */
export function parsePrefs(raw: string | null): MediaPrefs {
  try {
    const value = JSON.parse(raw ?? "null") as Partial<MediaPrefs> | null;
    const quality = value?.quality && value.quality in QUALITY_PRESETS ? value.quality : "auto";
    const e = value?.effect as BackgroundEffect | undefined;
    const effect: BackgroundEffect =
      e?.kind === "blur" && (e.strength === "normal" || e.strength === "strong")
        ? { kind: "blur", strength: e.strength }
        : e?.kind === "remove"
          ? { kind: "remove" }
          : e?.kind === "image" && OFFICE_BACKGROUNDS.some((b) => b.id === e.id)
            ? { kind: "image", id: e.id }
            : e?.kind === "colour" && SOLID_COLOURS.some((c) => c.id === e.id)
              ? { kind: "colour", id: e.id }
              : { kind: "none" }; // "custom" images are never stored: session only
    return { quality, effect };
  } catch {
    return DEFAULT_PREFS;
  }
}

/**
 * Employees keep their choice on this device (localStorage); guests only for
 * this visit (sessionStorage). Never the CRM, never image bytes.
 */
const store = (guest: boolean): Storage | null => {
  try {
    return guest ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};
export function loadPrefs(guest: boolean): MediaPrefs {
  try {
    return parsePrefs(store(guest)?.getItem(PREFS_KEY) ?? null);
  } catch {
    return DEFAULT_PREFS;
  }
}
export function savePrefs(guest: boolean, prefs: MediaPrefs) {
  try {
    const effect = prefs.effect.kind === "custom" ? { kind: "none" } : prefs.effect;
    store(guest)?.setItem(PREFS_KEY, JSON.stringify({ quality: prefs.quality, effect }));
  } catch {}
}

/* -------------------------------------------------------- device errors */

export type MediaKind = "camera" | "microphone";
export type MediaProblem = "blocked" | "missing" | "busy" | "constraints" | "interrupted" | "publish" | "other";

/** Classifies a device/publish failure by its name only — never its message. */
export function classifyMediaError(error: unknown): MediaProblem {
  const name = (error as { name?: string } | null)?.name ?? "";
  if (["NotAllowedError", "SecurityError", "PermissionDenied", "PermissionDeniedError"].includes(name)) return "blocked";
  if (["NotFoundError", "DevicesNotFoundError", "NotFound"].includes(name)) return "missing";
  if (["NotReadableError", "TrackStartError", "DeviceInUse", "AbortError"].includes(name)) return "busy";
  if (["OverconstrainedError", "ConstraintNotSatisfiedError"].includes(name)) return "constraints";
  if (name === "InvalidStateError") return "interrupted";
  if (/publish|timeout|negotiation/i.test(name)) return "publish";
  return "other";
}

export function mediaMessage(kind: MediaKind, problem: MediaProblem): string {
  const Noun = kind === "camera" ? "Camera" : "Microphone";
  switch (problem) {
    case "blocked":
      return `${Noun} access is blocked. Allow it for this site in your browser's settings (the icon next to the address bar), then try again.`;
    case "missing":
      return `No ${kind} was found. Connect one and try again.`;
    case "busy":
      return `Your ${kind} is being used by another app. Close it there, then try again.`;
    case "constraints":
      return `Your ${kind} doesn't support the requested settings. Try another ${kind} or the Data saver quality.`;
    case "interrupted":
      return `Your ${kind} was interrupted. Try again.`;
    case "publish":
      return kind === "camera" ? "Your camera started but couldn't be shared with the meeting. Check your connection and try again." : "Couldn't start your microphone. Check your connection and try again.";
    default:
      return kind === "camera" ? "Couldn't start your camera. Try again." : "Couldn't start your microphone. Try again.";
  }
}

/* ------------------------------------------------------ device fallback */

/**
 * After a device list change: the device to switch to, or null to stay.
 * A chosen device that disappeared falls back to the system default.
 */
export function fallbackDevice(available: { deviceId: string }[], active: string | undefined): "default" | null {
  if (!active || active === "default") return null;
  return available.some((d) => d.deviceId === active) ? null : "default";
}

/* ---------------------------------------------------------- diagnostics */

export type DiagnosticEvent =
  | "camera_start_failed"
  | "microphone_start_failed"
  | "camera_publish_failed"
  | "microphone_publish_failed"
  | "track_ended"
  | "track_recovered"
  | "track_recovery_failed"
  | "video_stalled"
  | "video_recovered"
  | "video_unavailable"
  | "background_processor_failed"
  | "background_processor_slow"
  | "reconnecting"
  | "reconnected"
  | "device_fallback"
  | "audio_blocked"
  | "mic_silent";

type Diagnostics = {
  startedAt: number;
  reconnects: number;
  counts: Partial<Record<DiagnosticEvent, number>>;
  recent: { at: number; event: DiagnosticEvent; detail?: string }[];
};

const diagnostics: Diagnostics = { startedAt: Date.now(), reconnects: 0, counts: {}, recent: [] };

/**
 * Records an operational event: its name and, at most, a short non-sensitive
 * detail (an error NAME such as "NotReadableError", or "camera"/"microphone").
 */
export function noteMedia(event: DiagnosticEvent, detail?: string) {
  const safe = detail && /^[A-Za-z_ -]{1,40}$/.test(detail) ? detail : undefined;
  diagnostics.counts[event] = (diagnostics.counts[event] ?? 0) + 1;
  if (event === "reconnecting") diagnostics.reconnects += 1;
  diagnostics.recent.push({ at: Date.now(), event, ...(safe ? { detail: safe } : {}) });
  if (diagnostics.recent.length > 40) diagnostics.recent.shift();
  if (typeof console !== "undefined") console.info(`[meeting] ${event}${safe ? ` (${safe})` : ""}`);
}

export const diagnosticsLog = () => ({ ...diagnostics, counts: { ...diagnostics.counts }, recent: [...diagnostics.recent] });

export function environmentSummary() {
  if (typeof navigator === "undefined") return {};
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Other";
  const platform = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Other";
  return { browser, platform, touch: typeof window !== "undefined" && "ontouchstart" in window };
}
