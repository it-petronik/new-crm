"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send, Square, Trash2 } from "lucide-react";
import { VOICE_NOTE_MAX_MS } from "@/lib/collab-files";
import { Button } from "../ui/controls";
import { VoicePlayer } from "./attachments";

/**
 * Voice notes with the browser's MediaRecorder:
 *   Record → timer → Stop → preview → Send or Discard.
 * Capped at five minutes. Permission denial and unsupported browsers get a
 * plain explanation instead of a broken control.
 */

export type VoiceNote = { blob: Blob; name: string; durationMs: number };

export const voiceSupported = () =>
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

function pickType() {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"])
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  return "";
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function VoiceRecorder({ onSend, onCancel }: { onSend: (note: VoiceNote) => void; onCancel: () => void }) {
  const [phase, setPhase] = useState<"starting" | "recording" | "review" | "error">("starting");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState<(VoiceNote & { url: string }) | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const started = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      if (!voiceSupported()) {
        setPhase("error");
        setError("Voice messages aren't supported in this browser.");
        return;
      }
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        setPhase("error");
        setError(
          (e as DOMException)?.name === "NotAllowedError"
            ? "Microphone access was blocked. Allow it in your browser's site settings to record."
            : "No microphone is available.",
        );
        return;
      }
      if (cancelled) return stream.current.getTracks().forEach((t) => t.stop());
      const type = pickType();
      const rec = new MediaRecorder(stream.current, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        const durationMs = Date.now() - started.current;
        const mime = rec.mimeType || type || "audio/webm";
        const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(chunks, { type: mime.split(";")[0] });
        setNote({ blob, name: `Voice message.${ext}`, durationMs, url: URL.createObjectURL(blob) });
        setPhase("review");
      };
      recorder.current = rec;
      started.current = Date.now();
      rec.start(250);
      setPhase("recording");
      timer = setInterval(() => {
        const ms = Date.now() - started.current;
        setElapsed(ms);
        if (ms >= VOICE_NOTE_MAX_MS && rec.state === "recording") rec.stop();
      }, 200);
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => () => void (note && URL.revokeObjectURL(note.url)), [note]);

  const stop = () => recorder.current?.state === "recording" && recorder.current.stop();

  return (
    <div className="ui-field-shell collab-recorder" role="group" aria-label="Voice message">
      {phase === "error" ? (
        <>
          <span className="collab-recorder-error" role="alert">
            <Mic size={15} aria-hidden="true" /> {error}
          </span>
          <Button className="secondary collab-composer-action" onClick={onCancel}>
            Close
          </Button>
        </>
      ) : phase === "review" && note ? (
        <>
          <Button className="icon-button collab-composer-tool" aria-label="Discard voice message" onClick={onCancel}>
            <Trash2 size={16} />
          </Button>
          <div className="collab-recorder-preview">
            <VoicePlayer src={note.url} />
          </div>
          <Button className="primary collab-send" aria-label="Send voice message" onClick={() => onSend(note)}>
            <Send size={16} />
          </Button>
        </>
      ) : (
        <>
          <Button className="icon-button collab-composer-tool" aria-label="Cancel recording" onClick={onCancel}>
            <Trash2 size={16} />
          </Button>
          <span className="collab-recorder-live" aria-live="polite">
            <i aria-hidden="true" /> {phase === "starting" ? "Starting microphone…" : `Recording ${clock(elapsed)}`}
            <small> / {clock(VOICE_NOTE_MAX_MS)}</small>
          </span>
          <Button className="primary collab-send" aria-label="Stop recording" disabled={phase !== "recording"} onClick={stop}>
            <Square size={14} />
          </Button>
        </>
      )}
    </div>
  );
}
