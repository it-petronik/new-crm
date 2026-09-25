"use client";

import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Mic,
  Pause,
  Play,
  Presentation,
  X,
} from "lucide-react";
import type { AttachmentView } from "@/lib/collab";
import { fileLabel, formatBytes } from "@/lib/collab-files";
import { businessDateTimeLong } from "@/lib/gst";
import { Button, Dialog, DialogActions } from "../ui/controls";

/* ------------------------------------------------------------ pending tray */

export type PendingUpload = {
  localId: string;
  name: string;
  size: number;
  isImage: boolean;
  previewUrl: string | null;
  progress: number;
  status: "uploading" | "ready" | "failed";
  error?: string;
  attachment?: AttachmentView;
  abort?: () => void;
};

/** Makes a small JPEG preview and reads an image's size, in the browser. */
export async function imageExtras(file: File): Promise<{ thumbnail: Blob | null; width?: number; height?: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    const thumbnail = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
    return { thumbnail, ...size };
  } catch {
    return { thumbnail: null };
  }
}

function fileIcon(mimeType: string, name: string, size = 20) {
  const label = fileLabel(mimeType, name);
  if (label === "PDF" || label === "Word" || label === "Text") return <FileText size={size} aria-hidden="true" />;
  if (label === "Excel" || label === "CSV") return <FileSpreadsheet size={size} aria-hidden="true" />;
  if (label === "PowerPoint") return <Presentation size={size} aria-hidden="true" />;
  if (label === "Audio") return <Mic size={size} aria-hidden="true" />;
  return <FileIcon size={size} aria-hidden="true" />;
}

export function AttachmentTray({ items, onRemove }: { items: PendingUpload[]; onRemove: (localId: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="collab-tray" aria-label="Attachments to send">
      {items.map((item) => (
        <li key={item.localId} className={`collab-tray-item is-${item.status}`}>
          <span className="collab-tray-thumb">
            {item.previewUrl ? <img src={item.previewUrl} alt="" /> : fileIcon("", item.name)}
          </span>
          <span className="collab-tray-meta">
            <b title={item.name}>{item.name}</b>
            <small>
              {item.status === "failed" ? (
                <span className="is-error">
                  <AlertCircle size={11} aria-hidden="true" /> {item.error}
                </span>
              ) : item.status === "uploading" ? (
                `Uploading… ${Math.round(item.progress * 100)}%`
              ) : (
                formatBytes(item.size)
              )}
            </small>
          </span>
          {item.status === "uploading" && (
            <span className="collab-tray-progress" aria-hidden="true">
              <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
            </span>
          )}
          <Button className="icon-button collab-tray-remove" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.localId)}>
            <X size={14} />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------- in-message files */

export type OpenImage = (attachmentId: string) => void;

/**
 * Attachments inside a message. Images show inline (their small preview,
 * space reserved from the stored size so nothing jumps), voice notes get a
 * player, documents a file card. Only metadata came with the history;
 * bytes load lazily, per item, through the authorised file route.
 */
export function MessageAttachments({
  attachments,
  onOpenImage,
  onOpenPdf,
}: {
  attachments: AttachmentView[];
  onOpenImage: OpenImage;
  onOpenPdf: (attachment: AttachmentView) => void;
}) {
  if (!attachments.length) return null;
  const images = attachments.filter((a) => a.kind === "image");
  const others = attachments.filter((a) => a.kind !== "image");
  return (
    <div className="collab-attachments">
      {images.length > 0 && (
        <div className={`collab-images count-${Math.min(images.length, 4)}`}>
          {images.map((a) => (
            <button
              key={a.id}
              type="button"
              className="collab-image"
              aria-label={`Open image ${a.name}`}
              onClick={() => onOpenImage(a.id)}
              style={images.length === 1 && a.width && a.height ? { aspectRatio: `${a.width} / ${a.height}` } : undefined}
            >
              <img src={a.thumbUrl ?? a.url} alt={a.name} loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}
      {others.map((a) =>
        a.kind === "audio" ? (
          <VoicePlayer key={a.id} attachment={a} />
        ) : (
          <FileCard key={a.id} attachment={a} onPreview={a.kind === "pdf" ? () => onOpenPdf(a) : undefined} />
        ),
      )}
    </div>
  );
}

export function FileCard({ attachment, onPreview }: { attachment: AttachmentView; onPreview?: () => void }) {
  const label = fileLabel(attachment.mimeType, attachment.name);
  return (
    <div className="collab-file-card">
      <span className={`collab-file-icon is-${label.toLowerCase().replace(/\s.*/, "")}`}>
        {fileIcon(attachment.mimeType, attachment.name, 20)}
      </span>
      {onPreview ? (
        <button type="button" className="collab-file-main" onClick={onPreview} aria-label={`Preview ${attachment.name}`}>
          <b title={attachment.name}>{attachment.name}</b>
          <small>
            {label} · {formatBytes(attachment.size)}
          </small>
        </button>
      ) : (
        <span className="collab-file-main">
          <b title={attachment.name}>{attachment.name}</b>
          <small>
            {label} · {formatBytes(attachment.size)}
          </small>
        </span>
      )}
      <a className="ui-button icon-button collab-file-download" href={attachment.downloadUrl} aria-label={`Download ${attachment.name}`} title="Download">
        <Download size={16} />
      </a>
    </div>
  );
}

const clock = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** A voice note: play/pause, progress (click to seek), time. Never autoplays. */
export function VoicePlayer({ attachment, src }: { attachment?: AttachmentView; src?: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(attachment?.durationMs ?? 0);
  const url = src ?? attachment?.url ?? "";
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audio.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = (((e.clientX - rect.left) / rect.width) * duration) / 1000;
  };
  return (
    <div className="collab-voice">
      <Button className="icon-button collab-voice-toggle" aria-label={playing ? "Pause voice message" : "Play voice message"} onClick={toggle}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </Button>
      <div
        className="collab-voice-track"
        role="slider"
        aria-label="Voice message position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration / 1000)}
        aria-valuenow={Math.round(position / 1000)}
        tabIndex={0}
        onClick={seek}
        onKeyDown={(e) => {
          const el = audio.current;
          if (!el) return;
          if (e.key === "ArrowRight") el.currentTime += 5;
          if (e.key === "ArrowLeft") el.currentTime = Math.max(0, el.currentTime - 5);
        }}
      >
        <span style={{ width: duration ? `${Math.min(100, (position / duration) * 100)}%` : "0%" }} />
      </div>
      <span className="collab-voice-time">{clock(playing || position ? position : duration)}</span>
      {attachment && (
        <a className="ui-button icon-button" href={attachment.downloadUrl} aria-label="Download voice message" title="Download">
          <Download size={14} />
        </a>
      )}
      <audio
        ref={audio}
        src={url}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime * 1000)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d * 1000);
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- lightbox */

export type LightboxItem = { attachment: AttachmentView; authorName: string; createdAt: string };

/**
 * Full-size images: filename, sender, time (GST), download, and previous /
 * next through the conversation's images (arrow keys too). Esc closes.
 */
export function Lightbox({ items, index, onIndex, onClose }: { items: LightboxItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const item = items[index];
  // Focus goes back to whatever opened the lightbox (an image button), also
  // when the lightbox is removed rather than closed.
  const opener = useRef<HTMLElement | null>(typeof document === "undefined" ? null : (document.activeElement as HTMLElement));
  useEffect(
    () => () => {
      const el = opener.current;
      setTimeout(() => el?.isConnected && el.focus(), 0);
    },
    [],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onIndex]);
  if (!item) return null;
  const a = item.attachment;
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="collab-lightbox-overlay" />
        <DialogPrimitive.Content className="collab-lightbox" aria-describedby={undefined} onCloseAutoFocus={(e) => e.preventDefault()}>
          <header className="collab-lightbox-head">
            <div>
              <DialogPrimitive.Title className="collab-lightbox-title">{a.name}</DialogPrimitive.Title>
              <small>
                {item.authorName} · {businessDateTimeLong(item.createdAt)} GST
                {items.length > 1 && ` · ${index + 1} of ${items.length}`}
              </small>
            </div>
            <a className="ui-button icon-button" href={a.downloadUrl} aria-label="Download image" title="Download">
              <Download size={18} />
            </a>
            <DialogPrimitive.Close asChild>
              <Button className="icon-button" aria-label="Close image">
                <X size={20} />
              </Button>
            </DialogPrimitive.Close>
          </header>
          <div className="collab-lightbox-stage">
            {index > 0 && (
              <Button className="icon-button collab-lightbox-nav is-prev" aria-label="Previous image" onClick={() => onIndex(index - 1)}>
                <ChevronLeft size={26} />
              </Button>
            )}
            <img key={a.id} src={a.url} alt={a.name} />
            {index < items.length - 1 && (
              <Button className="icon-button collab-lightbox-nav is-next" aria-label="Next image" onClick={() => onIndex(index + 1)}>
                <ChevronRight size={26} />
              </Button>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * A PDF in the browser's own viewer, inside the app. The file is served
 * inline from the authorised route (frameable only by this site); nothing
 * about it is parsed or run on the server.
 */
export function PdfPreview({ attachment, onClose }: { attachment: AttachmentView; onClose: () => void }) {
  return (
    <Dialog title={attachment.name} onClose={onClose} className="collab-pdf-dialog">
      <iframe className="collab-pdf-frame" src={attachment.url} title={`Preview of ${attachment.name}`} />
      <DialogActions
        cancel="Close"
        start={<span className="ui-dialog-note">PDF · {formatBytes(attachment.size)}</span>}
        primary={{
          label: "Download",
          icon: <Download size={15} aria-hidden="true" />,
          onClick: () => {
            window.location.href = attachment.downloadUrl;
          },
        }}
      />
    </Dialog>
  );
}
