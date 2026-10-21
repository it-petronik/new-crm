"use client";
import { useId, useMemo, useRef, useState } from "react";
import { Sparkles, WandSparkles } from "lucide-react";
import { Button, Textarea } from "../ui/controls";
import { CAPTURE_LABELS, detectInquiry, type CaptureDraft, type CaptureField } from "@/lib/ai/capture-fields";
import styles from "./inquiry-capture.module.css";
import { requestJson, friendlyError } from "@/lib/client-request";
import { useAiStatus } from "./ai-answer";

/** Typing stays local. Only the explicit AI button sends this inquiry. */
export function InquiryCapture({onApply, company, branch, preview}: {onApply: (draft: CaptureDraft) => void; company: string; branch: string; preview: boolean}) {
  const id = useId();
  const status = useAiStatus(!preview), revision = useRef(0), running = useRef(false);
  const [text, setText] = useState(""), [applied, setApplied] = useState(false);
  const [open, setOpen] = useState(false);
  const [aiDraft, setAiDraft] = useState<CaptureDraft | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const local = useMemo(() => detectInquiry(text), [text]), draft = aiDraft ?? local;
  const entries = Object.entries(draft) as [CaptureField, string][];
  async function suggest() {
    if (running.current) return;
    const version = revision.current;
    running.current = true; setBusy(true); setError("");
    try {
      const result = await requestJson<{draft: CaptureDraft}>("/api/ai/capture", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({text, company, branch})});
      if (version === revision.current) {setAiDraft(result.draft); setApplied(false);}
    } catch(e) {if (version === revision.current) setError(friendlyError(e));}
    finally {running.current = false; setBusy(false);}
  }
  return <details className={styles.capture} open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary><WandSparkles size={15} aria-hidden="true"/>{applied ? "Inquiry details added · review below" : "Fill from an inquiry"}</summary>
    <label htmlFor={id}>Paste an email or WhatsApp message</label>
    <Textarea id={id} rows={3} maxLength={2500} value={text} placeholder={"Company: Acme Trading\nProduct: Base Oil SN500\n80 MT · Email: buyer@example.com"} onChange={e => {revision.current++; setText(e.target.value); setApplied(false); setAiDraft(null); setError("");}} />
    <p className={styles.hint}>{aiDraft ? "AI suggestions checked against your text." : "Detected on this device. Only the AI button sends this text to Groq."} Nothing is saved automatically.</p>
    {entries.length > 0 && <dl>{entries.map(([field, value]) => <div key={field}><dt>{CAPTURE_LABELS[field]}</dt><dd>{value}</dd></div>)}</dl>}
    {text.length > 9 && entries.length === 0 && <p role="status" className={styles.hint}>No clear details detected. Try “Company: …” or fill the fields below.</p>}
    <div className={styles.actions}>
      {entries.length > 0 && <Button variant="secondary" disabled={applied || busy} onClick={() => {onApply(draft); setApplied(true); setOpen(false);}}>Fill empty fields</Button>}
      {status?.available && status.features.lead && <Button variant="ghost" disabled={busy || text.trim().length < 10} loading={busy} onClick={() => void suggest()}><Sparkles size={14}/>{busy ? "Reading inquiry…" : "Suggest with AI"}</Button>}
    </div>
    {error && <p role="alert" className={styles.hint}>{error} You can still use local detection.</p>}
    {applied && <p className={styles.hint} role="status">Review the fields below. Nothing has been saved yet.</p>}
  </details>;
}
