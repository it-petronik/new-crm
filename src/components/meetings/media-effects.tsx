"use client";

import { useEffect, useRef, useState } from "react";
import type { LocalVideoTrack } from "livekit-client";
import { Ban, ImagePlus, Sparkles, UserRoundX } from "lucide-react";
import {
  BLUR_RADIUS,
  OFFICE_BACKGROUNDS,
  REMOVED_BACKGROUND_HEX,
  SEGMENTER_ASSETS,
  SOLID_COLOURS,
  backgroundImagePath,
  backgroundThumbPath,
  noteMedia,
  sameEffect,
  type BackgroundEffect,
} from "@/lib/meeting-media";

/**
 * Background effects — blur, removal, office images, solid colours and a
 * person's own image — processed entirely in this browser (MediaPipe
 * segmentation through LiveKit's track processor). No frame ever leaves the
 * device except as the meeting video itself.
 *
 * One processor lives on the camera track for as long as the track does:
 * switching effects changes its settings in place, so the published track
 * is never replaced and nobody sees a black frame. "None" keeps the
 * processor but disables it. The same track — and its processor — moves
 * from the pre-join preview into the meeting.
 */

/**
 * Mirrors the processor's own support check, without loading it — worked
 * out ONCE per page. (Every WebGL context counts against a small browser
 * limit; probing on each render would push out the processor's own context.)
 */
let supported: boolean | null = null;
export function effectsSupported() {
  if (typeof window === "undefined") return false;
  if (supported !== null) return supported;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    const modern = "MediaStreamTrackProcessor" in window && "MediaStreamTrackGenerator" in window;
    const legacy = typeof canvas.captureStream === "function";
    supported = typeof OffscreenCanvas !== "undefined" && typeof VideoFrame !== "undefined" && typeof createImageBitmap !== "undefined" && !!gl && (modern || legacy);
  } catch {
    supported = false;
  }
  return supported;
}

/* --------------------------------------------------------- image sources */

const colourUrls = new Map<string, string>();
/** A 1280×720 solid image, made once per colour on this device. */
async function solidImage(hex: string) {
  const cached = colourUrls.get(hex);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, 1280, 720);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("solid background");
  const url = URL.createObjectURL(blob);
  colourUrls.set(hex, url);
  return url;
}

async function imageFor(effect: BackgroundEffect, customUrl: string | null): Promise<string | null> {
  switch (effect.kind) {
    case "image":
      return backgroundImagePath(effect.id);
    case "colour":
      return solidImage(SOLID_COLOURS.find((c) => c.id === effect.id)?.hex ?? REMOVED_BACKGROUND_HEX);
    case "remove":
      // An opaque, neutral backdrop: the published video never carries
      // transparency (which would arrive as black).
      return solidImage(REMOVED_BACKGROUND_HEX);
    case "custom":
      return customUrl;
    default:
      return null;
  }
}

/* ---------------------------------------------------------- the processor */

type Monitor = { onSlow: () => void; average: number; slowSince: number | null; fired: boolean };
const monitors = new WeakMap<LocalVideoTrack, Monitor>();

/**
 * Frames taking this long on average mean the device can't keep up (under
 * ~16 fps). A page may set `__enercoreEffectsBudgetMs` (automated tests do,
 * to exercise both outcomes); it only affects this browser's own fallback.
 */
const SLOW_FRAME_MS = 60;
const SLOW_FOR_MS = 5000;
const frameBudget = () => {
  const override = (window as unknown as { __enercoreEffectsBudgetMs?: unknown }).__enercoreEffectsBudgetMs;
  return typeof override === "number" && override >= 0 ? override : SLOW_FRAME_MS;
};

/** One change at a time per track: overlapping switches on one processor race. */
const queues = new WeakMap<LocalVideoTrack, Promise<unknown>>();

type ProcessorLike = { switchTo: (o: { mode: "disabled" } | { mode: "background-blur"; blurRadius: number } | { mode: "virtual-background"; imagePath: string }) => Promise<void> };

/**
 * Applies an effect to a camera track, creating its processor the first
 * time. Resolves once the new effect is in place; throws if it can't be
 * (the caller returns to no effect and says so).
 */
export function applyEffect(track: LocalVideoTrack, effect: BackgroundEffect, options: { customUrl: string | null; onSlow: () => void }): Promise<void> {
  const previous = queues.get(track) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => applyNow(track, effect, options));
  queues.set(track, next);
  return next;
}

async function applyNow(track: LocalVideoTrack, effect: BackgroundEffect, options: { customUrl: string | null; onSlow: () => void }) {
  const monitor = monitors.get(track) ?? { onSlow: options.onSlow, average: 0, slowSince: null, fired: false };
  monitor.onSlow = options.onSlow;
  monitor.fired = false;
  monitor.slowSince = null;
  monitors.set(track, monitor);

  let processor = track.getProcessor() as unknown as ProcessorLike | undefined;
  if (!processor) {
    if (effect.kind === "none") return; // nothing to turn off
    const { BackgroundProcessor } = await import("@livekit/track-processors");
    const created = BackgroundProcessor({
      mode: "disabled",
      assetPaths: SEGMENTER_ASSETS,
      onFrameProcessed: (stats) => {
        // A rolling view of how long each frame takes on this device.
        monitor.average = monitor.average ? monitor.average * 0.9 + stats.processingTimeMs * 0.1 : stats.processingTimeMs;
        const now = performance.now();
        if (monitor.average > frameBudget()) {
          monitor.slowSince ??= now;
          if (!monitor.fired && now - monitor.slowSince > SLOW_FOR_MS) {
            monitor.fired = true;
            noteMedia("background_processor_slow");
            monitor.onSlow();
          }
        } else monitor.slowSince = null;
      },
    });
    await track.setProcessor(created as never);
    processor = created as unknown as ProcessorLike;
  }
  if (effect.kind === "none") return processor.switchTo({ mode: "disabled" });
  if (effect.kind === "blur") return processor.switchTo({ mode: "background-blur", blurRadius: BLUR_RADIUS[effect.strength] });
  const imagePath = await imageFor(effect, options.customUrl);
  if (!imagePath) return processor.switchTo({ mode: "disabled" });
  await processor.switchTo({ mode: "virtual-background", imagePath });
}

/** The effect currently applied to a track, for diagnostics: whether a processor is attached. */
export const hasProcessor = (track: LocalVideoTrack | undefined) => !!track?.getProcessor();

/**
 * Keeps a camera track's effect in line with the chosen one. Failures and
 * devices that can't keep up return to no effect, with a notice.
 */
export function useBackgroundEffect(
  track: LocalVideoTrack | undefined,
  effect: BackgroundEffect,
  customUrl: string | null,
  onProblem: (message: string) => void,
  onFallback: () => void,
) {
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<BackgroundEffect>({ kind: "none" });
  const latest = useRef({ onProblem, onFallback });
  latest.current = { onProblem, onFallback };

  useEffect(() => {
    if (!track) return;
    if (effect.kind !== "none" && !effectsSupported()) {
      latest.current.onProblem("Background effects aren't supported well on this device.");
      latest.current.onFallback();
      return;
    }
    let cancelled = false;
    setApplying(true);
    applyEffect(track, effect, {
      customUrl,
      onSlow: () => {
        latest.current.onProblem("Background effects aren't supported well on this device, so they've been turned off.");
        latest.current.onFallback();
      },
    })
      .then(() => !cancelled && setApplied(effect))
      .catch((e) => {
        if (cancelled) return;
        noteMedia("background_processor_failed", (e as { name?: string })?.name);
        latest.current.onProblem("The background effect couldn't be applied. You're continuing without it.");
        latest.current.onFallback();
      })
      .finally(() => !cancelled && setApplying(false));
    return () => {
      cancelled = true;
    };
    // effect is compared by value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, JSON.stringify(effect), customUrl]);

  return { applying, applied };
}

/* --------------------------------------------------------- custom images */

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * A background image from this device, for this visit only: checked, drawn
 * to 1280×720 (cover, never stretched) and kept as a local object URL —
 * never uploaded or stored. Revoked when replaced or when the meeting ends.
 */
export function useCustomBackground() {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const current = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
    },
    [],
  );

  async function choose(file: File): Promise<boolean> {
    setError("");
    if (!TYPES.includes(file.type)) return setError("Choose a JPEG, PNG or WebP image."), false;
    if (file.size > MAX_BYTES) return setError("Choose an image under 8 MB."), false;
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width < 320 || bitmap.height < 180 || bitmap.width > 10000 || bitmap.height > 10000) {
        bitmap.close();
        return setError("Choose an image at least 320×180 pixels."), false;
      }
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d")!;
      const scale = Math.max(1280 / bitmap.width, 720 / bitmap.height);
      const w = bitmap.width * scale;
      const h = bitmap.height * scale;
      ctx.drawImage(bitmap, (1280 - w) / 2, (720 - h) / 2, w, h);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
      if (!blob) throw new Error("encode");
      if (current.current) URL.revokeObjectURL(current.current);
      current.current = URL.createObjectURL(blob);
      setUrl(current.current);
      return true;
    } catch {
      setError("That image couldn't be used. Try another.");
      return false;
    }
  }
  /** Hands the image to whoever continues with it (the meeting), which revokes it later. */
  const handOver = () => {
    const kept = current.current;
    current.current = null;
    return kept;
  };
  return { url, error, choose, handOver };
}

/* -------------------------------------------------------------- the picker */

export function BackgroundPicker({
  value,
  onChange,
  customUrl,
  onCustomFile,
  customError,
  applying,
}: {
  value: BackgroundEffect;
  onChange: (effect: BackgroundEffect) => void;
  customUrl: string | null;
  onCustomFile: (file: File) => Promise<boolean>;
  customError: string;
  applying: boolean;
}) {
  const supported = effectsSupported();
  const file = useRef<HTMLInputElement>(null);
  const option = (effect: BackgroundEffect, label: string, content: React.ReactNode, className = "") => {
    const selected = sameEffect(value, effect);
    // With no image yet, the custom tile opens the file chooser instead.
    const pickFile = effect.kind === "custom" && !customUrl;
    return (
      <button
        type="button"
        className={`meet-effect${selected ? " is-selected" : ""} ${className}`}
        aria-pressed={selected}
        aria-label={label}
        title={label}
        disabled={!supported && effect.kind !== "none"}
        onClick={() => (pickFile ? file.current?.click() : onChange(effect))}
      >
        {content}
      </button>
    );
  };
  return (
    <div className="meet-effects">
      {!supported && <p className="meet-notice" role="status">Background effects aren&apos;t supported well on this device.</p>}
      {applying && (
        <p className="meet-effects-status" role="status">
          Applying background…
        </p>
      )}
      <div className="meet-effects-group" role="group" aria-label="Effects">
        {option({ kind: "none" }, "No background effect", <><Ban size={18} aria-hidden="true" /><span>None</span></>)}
        {option({ kind: "blur", strength: "normal" }, "Blur background", <><Sparkles size={18} aria-hidden="true" /><span>Blur</span></>)}
        {option({ kind: "blur", strength: "strong" }, "Strong blur", <><Sparkles size={20} aria-hidden="true" strokeWidth={2.6} /><span>Strong blur</span></>)}
        {option({ kind: "remove" }, "Remove background", <><UserRoundX size={18} aria-hidden="true" /><span>Remove</span></>)}
      </div>
      <h4 className="meet-effects-title">Backgrounds</h4>
      <div className="meet-effects-grid" role="group" aria-label="Office backgrounds">
        {OFFICE_BACKGROUNDS.map((b) =>
          option({ kind: "image", id: b.id }, `${b.label} background`, <img src={backgroundThumbPath(b.id)} alt="" loading="lazy" />, "is-image"),
        )}
        {supported && (
          <>
            {option(
              { kind: "custom" },
              customUrl ? "Your image background" : "Add your own image",
              customUrl ? <img src={customUrl} alt="" /> : <><ImagePlus size={18} aria-hidden="true" /><span>Add image</span></>,
              "is-image is-custom",
            )}
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              aria-label="Choose a background image"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f && (await onCustomFile(f))) onChange({ kind: "custom" });
              }}
            />
          </>
        )}
      </div>
      {supported && (
        <button type="button" className="meet-effects-link" onClick={() => file.current?.click()}>
          {customUrl ? "Choose a different image…" : "Use an image from this device…"}
        </button>
      )}
      {customError && <p className="meet-notice" role="alert">{customError}</p>}
      <h4 className="meet-effects-title">Solid colours</h4>
      <div className="meet-effects-grid is-colours" role="group" aria-label="Solid colours">
        {SOLID_COLOURS.map((c) => option({ kind: "colour", id: c.id }, `Solid ${c.label.toLowerCase()} background`, <span className="meet-swatch" style={{ background: c.hex }} />, "is-colour"))}
      </div>
      <p className="meet-fineprint">Effects are processed on this device. Your image stays here — it&apos;s never uploaded.</p>
    </div>
  );
}
