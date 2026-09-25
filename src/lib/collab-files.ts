/**
 * Collaboration attachments: limits, type detection and safe headers.
 *
 * Pure (no bindings, no DOM), so the upload route, the Worker's file route and
 * the composer share one definition of what is allowed.
 *
 * A file is accepted only when its EXTENSION and its leading BYTES agree on
 * one of the types below. The browser's Content-Type is never consulted, and
 * the type served back is the one decided here. Anything that could run in a
 * browser — HTML, SVG, XML, scripts, executables — matches no rule and is
 * rejected, and only images, PDFs and audio are ever served inline. Archives
 * (ZIP) are deliberately not accepted: their contents cannot be vetted.
 */

import type { AttachmentKind } from "./collab";

export const MB = 1024 * 1024;

/** Per-file ceilings. A voice note of the maximum length is ~3 MB. */
export const ATTACHMENT_LIMITS: Record<AttachmentKind, number> = {
  image: 15 * MB,
  pdf: 25 * MB,
  document: 25 * MB,
  audio: 10 * MB,
};
export const ATTACHMENTS_PER_MESSAGE = 10;
export const THUMBNAIL_MAX = 400 * 1024;
export const ROOM_AVATAR_MAX = 2 * MB;
export const VOICE_NOTE_MAX_MS = 5 * 60_000;
/** Absolute request ceiling for an upload (largest file + thumbnail + form). */
export const UPLOAD_REQUEST_MAX = 26 * MB;

/** For the file picker; the server re-checks everything regardless. */
export const ACCEPT_ATTRIBUTE = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".csv",
].join(",");

type Rule = {
  ext: string[];
  mime: string;
  kind: AttachmentKind;
  label: string;
  magic: (b: Uint8Array) => boolean;
};

const starts = (b: Uint8Array, bytes: number[], offset = 0) =>
  bytes.every((x, i) => b[offset + i] === x);
const ascii = (b: Uint8Array, text: string, offset = 0) =>
  starts(b, [...text].map((c) => c.charCodeAt(0)), offset);

const ZIP = (b: Uint8Array) => starts(b, [0x50, 0x4b, 0x03, 0x04]);
const OLE = (b: Uint8Array) => starts(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Plain text: valid UTF-8 and no NUL bytes in the sampled prefix. */
function isText(b: Uint8Array) {
  const sample = b.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.length === b.length ? sample : trimPartial(sample));
    return true;
  } catch {
    return false;
  }
}
// A sample can end mid-character; drop a trailing partial UTF-8 sequence.
function trimPartial(b: Uint8Array) {
  let end = b.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const c = b[end - i];
    if ((c & 0xc0) === 0xc0) return b.subarray(0, end - i);
    if ((c & 0x80) === 0) break;
  }
  return b;
}

const RULES: Rule[] = [
  { ext: ["jpg", "jpeg"], mime: "image/jpeg", kind: "image", label: "Image", magic: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  { ext: ["png"], mime: "image/png", kind: "image", label: "Image", magic: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { ext: ["gif"], mime: "image/gif", kind: "image", label: "Image", magic: (b) => ascii(b, "GIF87a") || ascii(b, "GIF89a") },
  { ext: ["webp"], mime: "image/webp", kind: "image", label: "Image", magic: (b) => ascii(b, "RIFF") && ascii(b, "WEBP", 8) },
  { ext: ["pdf"], mime: "application/pdf", kind: "pdf", label: "PDF", magic: (b) => ascii(b, "%PDF-") },
  { ext: ["docx"], mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document", label: "Word", magic: ZIP },
  { ext: ["xlsx"], mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "document", label: "Excel", magic: ZIP },
  { ext: ["pptx"], mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "document", label: "PowerPoint", magic: ZIP },
  { ext: ["doc"], mime: "application/msword", kind: "document", label: "Word", magic: OLE },
  { ext: ["xls"], mime: "application/vnd.ms-excel", kind: "document", label: "Excel", magic: OLE },
  { ext: ["ppt"], mime: "application/vnd.ms-powerpoint", kind: "document", label: "PowerPoint", magic: OLE },
  { ext: ["txt"], mime: "text/plain; charset=utf-8", kind: "document", label: "Text", magic: isText },
  { ext: ["csv"], mime: "text/csv; charset=utf-8", kind: "document", label: "CSV", magic: isText },
  // Voice notes (MediaRecorder output) and ordinary audio files.
  { ext: ["webm", "weba"], mime: "audio/webm", kind: "audio", label: "Audio", magic: (b) => starts(b, [0x1a, 0x45, 0xdf, 0xa3]) },
  { ext: ["ogg", "oga", "opus"], mime: "audio/ogg", kind: "audio", label: "Audio", magic: (b) => ascii(b, "OggS") },
  { ext: ["m4a", "mp4", "aac"], mime: "audio/mp4", kind: "audio", label: "Audio", magic: (b) => ascii(b, "ftyp", 4) },
  { ext: ["mp3"], mime: "audio/mpeg", kind: "audio", label: "Audio", magic: (b) => ascii(b, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { ext: ["wav"], mime: "audio/wav", kind: "audio", label: "Audio", magic: (b) => ascii(b, "RIFF") && ascii(b, "WAVE", 8) },
];

export const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export type DetectedFile = { mimeType: string; kind: AttachmentKind; label: string };

/** The file's real type, or null when extension and bytes do not agree. */
export function detectFile(bytes: Uint8Array, name: string): DetectedFile | null {
  const ext = extensionOf(name);
  const rule = RULES.find((r) => r.ext.includes(ext));
  if (!rule || !rule.magic(bytes)) return null;
  return { mimeType: rule.mime, kind: rule.kind, label: rule.label };
}

/** Images a room avatar or thumbnail may be (no GIF animation for avatars). */
export function detectImage(bytes: Uint8Array): string | null {
  for (const rule of RULES.filter((r) => r.kind === "image"))
    if (rule.magic(bytes)) return rule.mime;
  return null;
}

/** A short type label for a stored MIME type ("PDF", "Excel"…). */
export function fileLabel(mimeType: string, name = "") {
  const byName = RULES.find((r) => r.ext.includes(extensionOf(name)) && r.mime === mimeType);
  return (byName ?? RULES.find((r) => r.mime === mimeType))?.label ?? "File";
}

/**
 * A filename safe to store and to echo in a header: no path, no control or
 * bidi characters, no quotes or separators that could break the header,
 * bounded length, extension preserved.
 */
export function safeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩"<>|:*?;]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim();
  if (!cleaned) return "file";
  if (cleaned.length <= 160) return cleaned;
  const ext = extensionOf(cleaned);
  return `${cleaned.slice(0, 150 - ext.length)}….${ext}`;
}

/**
 * RFC 6266 Content-Disposition with an ASCII fallback and the exact UTF-8
 * name, so non-Latin filenames survive and nothing can inject a header.
 */
export function contentDisposition(name: string, inline: boolean) {
  const safe = safeFileName(name);
  const fallback = safe.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/** Served inline (viewable in the page) only for these; all else downloads. */
export const inlineKinds: AttachmentKind[] = ["image", "pdf", "audio"];

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
}

/** Random, opaque storage key: nothing in it comes from the user. */
export function storageKey(prefix: "att" | "room") {
  const random = [...crypto.getRandomValues(new Uint8Array(20))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}/${random}`;
}
