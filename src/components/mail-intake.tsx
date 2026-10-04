"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "./ui/controls";
import { AiResultHeading } from "./ai/ai-answer";
import type { MailIntake } from "@/lib/mail/intake";
import type { MailMessage } from "@/lib/mail/model";
import type { RecordItem } from "@/lib/domain";
export type IntakeKind = "leads" | "customers" | "it";
export type IntakeProps = { records: RecordItem[]; onCreate: (kind: IntakeKind, message: MailMessage, suggestion: MailIntake) => void };
export default function MailIntakePanel({ message, records, onCreate }: IntakeProps & { message: MailMessage }) {
  const [result, setResult] = useState<{ mode: string; suggestion: MailIntake } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  async function analyze() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/mail/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: message.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not analyse email.");
      setResult(data); setReviewed(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Try again."); }
    finally { setBusy(false); }
  }
  const s = result?.suggestion;
  const matches = records.filter(r => r.email?.trim().toLowerCase() === message.sender.trim().toLowerCase() || (s?.company && r.title.trim().toLowerCase() === s.company.trim().toLowerCase()));
  return <section className="mail-intake">
    <div className="mail-intake-heading"><div><h3><Sparkles size={16}/>Email to CRM</h3><p>Extract details and review before creating a record.</p></div><Button className="secondary compact" disabled={busy} onClick={() => void analyze()}>{busy ? "Analysing…" : result ? "Analyse again" : "Analyse email"}</Button></div>
    {error && <p role="alert">{error}</p>}
    {s && <div className="ai-answer mail-intake-result" role="region" aria-label="Email analysis result" tabIndex={0}><AiResultHeading/><small>{result?.mode === "simulation" ? "Local simulation · not a live AI result" : "AI suggestion · verify before saving"}</small>
      <h4>{({sales:"Sales enquiry",customer:"Customer registration",it:"IT support issue",other:"Needs your review"})[s.category]}</h4><p className="ai-summary">{s.summary}</p>
      <dl><dt>Company</dt><dd>{s.company || "Not stated"}</dd><dt>Contact</dt><dd>{s.contact || "Not stated"}</dd><dt>Product</dt><dd>{s.product || "Not stated"}</dd><dt>Quantity</dt><dd>{s.quantity === null ? "Not stated" : `${s.quantity} ${s.unit}`}</dd></dl>
      <details><summary>Source excerpts</summary>{s.evidence.map((v,i) => <blockquote key={i}>{v}</blockquote>)}</details>
      {matches.length > 0 && <div role="status"><strong>Possible existing records</strong>{matches.slice(0,5).map(r => <p key={r.id}>{r.title} · {r.kind}</p>)}<p>Check these before creating a duplicate. Nothing is merged automatically.</p></div>}
      <label className="mail-share-consent"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)}/><span>I reviewed these details. Saving shares the record’s fields with authorised module users. The full email stays private.</span></label>
      <div className="mail-intake-actions">{(["leads","customers","it"] as const).map(kind => <Button key={kind} className="secondary" disabled={!reviewed} onClick={() => onCreate(kind,message,s)}>{kind === "leads" ? "Review lead" : kind === "customers" ? "Review customer" : "Review IT ticket"}</Button>)}</div><small>Nothing is created until you save the next form.</small>
    </div>}
  </section>;
}
