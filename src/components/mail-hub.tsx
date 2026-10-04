"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, FileText, Inbox, Mail, Plus, RefreshCw, Reply, Send, ShieldCheck } from "lucide-react";
import { Button, Dialog, DialogActions, Field, Input, Textarea } from "./ui/controls";
import type { MailDraft, MailMessage } from "@/lib/mail/model";
import MailIntakePanel, { type IntakeProps } from "./mail-intake";
import SocialChannels from "./social-channels";
import { PageHeader } from "./ui/layout";
import styles from "./studio/communication.module.css";

export default function MailHub({ preview, records, onCreate }: { preview: boolean } & IntakeProps) {
  const [section, setSection] = useState<"email" | "channels">("email");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [mode, setMode] = useState("loading");
  const [folder, setFolder] = useState<MailMessage["folder"]>("inbox");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MailMessage | null>(null);
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function load() {
    const response = await fetch("/api/mail", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load email.");
    setMode(data.mode); setMessages(data.messages);
  }
  useEffect(() => {
    if (!preview) void load().catch(error => { setMode("error"); setNotice(error.message); });
  }, [preview]);
  function compose(message?: MailMessage) {
    setNotice(""); setConfirm(false);
    setDraft(message?.folder === "drafts" ? { id: message.id, to: message.to, subject: message.subject, body: message.body } : {
      id: crypto.randomUUID(), to: message?.sender || "",
      subject: message ? `Re: ${message.subject.replace(/^Re:\s*/i, "")}` : "", body: "",
    });
  }
  async function save(send: boolean) {
    if (!draft || busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/mail", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, action: send ? "send-test" : "save", ...(send ? { confirmed: true } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save message.");
      setDraft(null); setConfirm(false); setSelected(null); setFolder(send ? "outbox" : "drafts");
      await load(); setNotice(send ? "Captured in the test outbox. No real email was sent." : "Draft saved privately.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Email unavailable."); setConfirm(false); }
    finally { setBusy(false); }
  }
  const shown = messages.filter(m => m.folder === folder && `${m.subject} ${m.sender} ${m.to}`.toLowerCase().includes(query.toLowerCase()));
  const patch = (key: keyof MailDraft, value: string) => setDraft(d => d && ({ ...d, [key]: value }));
  const dateLabel = (value: number) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return <section className={`mail-hub ${styles.hub}`}>
    <nav className="communication-tabs" aria-label="Communication workspace"><Button aria-pressed={section === "email"} onClick={() => setSection("email")}>Email workspace</Button><Button aria-pressed={section === "channels"} onClick={() => setSection("channels")}>Social channels</Button></nav>
    {section === "channels" ? <SocialChannels sandbox={mode === "sandbox"}/> : <>
    <PageHeader title="Email" description="Your private customer conversations. Only you can read your mailbox." actions={mode === "sandbox" && <Button className="primary" onClick={() => compose()}><Plus size={16}/>New email</Button>}/>
    <div className="mail-status"><ShieldCheck size={18}/><span>{preview ? "Browser preview — use the local test workspace for email and collaboration." : mode === "sandbox" ? "Local test inbox · fictional messages · sending is captured, never delivered" : mode === "loading" ? "Loading your mailbox…" : "Not connected · no mail is being received or sent"}</span></div>
    {notice && <p role="status" className="mail-notice">{notice}</p>}
    {preview || mode === "disconnected" || mode === "error" ? <div className="panel mail-setup"><Mail size={28}/><h2>{preview ? "Test with separate signed-in users" : "Your cPanel mailbox"}</h2>
      <p>IMAP: mail.petronik.ae · 993 · SSL/TLS<br/>SMTP: mail.petronik.ae · 465 · SSL/TLS</p>
      <p>Live connection is not enabled yet. Do not enter email passwords in the browser preview.</p>
      {preview && <p>Start the local review environment with <code>npm run dev:review</code>, then open <a href="http://localhost:8788/login">the local test workspace</a>.</p>}
      {mode === "error" && <Button className="secondary" onClick={() => void load().catch(e => setNotice(e.message))}>Try again</Button>}
    </div> : mode === "sandbox" && <div className={`mail-layout panel ${styles.mail} ${selected ? "has-selection" : ""}`}>
      <aside className={styles.folders}><p>Your mailbox</p><nav className={styles.folderNav} aria-label="Email folders">{(["inbox", "drafts", "outbox"] as const).map(f => <Button key={f} aria-pressed={folder === f} onClick={() => { setFolder(f); setSelected(null); }}>{f === "inbox" ? <Inbox size={15}/> : f === "drafts" ? <FileText size={15}/> : <Send size={15}/>}{f === "outbox" ? "Test outbox" : f === "inbox" ? "Inbox" : "Drafts"}<span className="mail-count">{messages.filter(m => m.folder === f).length}</span></Button>)}</nav></aside>
      <aside className="mail-list"><div className={styles.listTitle}><h2>{folder === "inbox" ? "Inbox" : folder === "drafts" ? "Drafts" : "Test outbox"}</h2><span>{shown.length} messages</span></div>
        <div className="mail-search"><Input aria-label="Search email" placeholder="Search this folder…" value={query} onChange={e => setQuery(e.target.value)}/><Button aria-label="Refresh email" onClick={() => void load().catch(e => setNotice(e.message))}><RefreshCw size={16}/></Button></div>
        {shown.map(m => <button key={m.id} aria-pressed={selected?.id === m.id} className={`mail-row ${selected?.id === m.id ? "selected" : ""}`} onClick={() => setSelected(m)}><span className="mail-row-meta"><span>{m.folder === "inbox" ? m.sender : `To: ${m.to}`}</span><time>{dateLabel(m.updatedAt)}</time></span><strong>{m.subject}</strong><span className="mail-snippet">{m.body}</span></button>)}
        {!shown.length && <p className="mail-empty">{query ? "No matching messages." : "No messages in this folder yet."}</p>}
        <small>Most recent 200 messages · private to your account</small>
      </aside>
      <article className="mail-reader">{selected ? <><div className="mail-reader-toolbar"><Button className="secondary mail-back" onClick={() => setSelected(null)}><ArrowLeft size={16}/>Back to messages</Button><span className="mail-reader-label">{selected.folder === "outbox" ? "Captured test email" : selected.folder === "drafts" ? "Private draft" : "Inbox"}</span><time>{dateLabel(selected.updatedAt)}</time></div><h2>{selected.subject}</h2><div className="mail-sender"><span className="mail-avatar">{selected.sender.slice(0, 1).toUpperCase()}</span><div><strong>{selected.sender}</strong><p>To: {selected.to}</p></div></div><div className="mail-body">{selected.body}</div><div className="mail-reader-footer">{selected.folder !== "outbox" ? <Button className="secondary" onClick={() => compose(selected)}><Reply size={16}/>{selected.folder === "drafts" ? "Edit draft" : "Reply"}</Button> : <p><ShieldCheck size={16}/>Captured locally. This message was not delivered.</p>}</div></> : <div className="mail-empty mail-reader-empty"><span className="mail-empty-icon"><Mail size={26}/></span><h2>Your conversations, in one place</h2><p>Select a message to read it, or start a new email.<br/>Your mailbox is visible only to you.</p></div>}</article>
    </div>}
    {draft && <Dialog title={confirm ? "Review your email" : "Compose email"} description="Private mailbox · local test mode" dismissOnOutside={false} onClose={() => { if (!busy) { setDraft(null); setConfirm(false); } }} className="mail-compose simple-entry-dialog">
      {confirm ? <div className="mail-review"><div className="mail-status"><ShieldCheck size={18}/><span>No external email will be sent. This copy stays in your test outbox.</span></div><dl><dt>To</dt><dd>{draft.to}</dd><dt>Subject</dt><dd>{draft.subject}</dd></dl><div className="mail-body">{draft.body}</div><DialogActions pending={busy} onCancel={() => setConfirm(false)} cancel="Back to edit" primary={{ label: busy ? "Capturing…" : "Confirm test send", icon:<Send size={16}/>, onClick: () => void save(true), disabled: busy }}/></div> : <form id="mail-compose-form" onSubmit={e => { e.preventDefault(); setConfirm(true); }}>
        <div className="mail-compose-fields"><Field>To<Input type="email" required value={draft.to} onChange={e => patch("to", e.target.value)} maxLength={254}/></Field>
          <Field>Subject<Input required value={draft.subject} onChange={e => patch("subject", e.target.value)} maxLength={200}/></Field>
          <Field>Message<Textarea placeholder="Write your message…" required rows={7} value={draft.body} onChange={e => patch("body", e.target.value)} maxLength={20000}/></Field>
          <Button type="button" className="text-button" disabled={Boolean(draft.body.trim())} onClick={() => patch("body", "Hello,\n\nThank you for your enquiry. Could you confirm the required quantity and delivery destination?\n\nKind regards")}>Use enquiry reply template</Button>
          {notice && <p role="alert">{notice}</p>}</div>
        <DialogActions pending={busy} cancel={false} start={<span className="mail-footer-hint"><ShieldCheck size={15}/>Not sent externally</span>} secondary={<Button type="button" className="secondary" disabled={busy} onClick={() => void save(false)}>Save draft</Button>} primary={{label:"Review test email",type:"submit",form:"mail-compose-form",icon:<Send size={16}/>,disabled:busy}}/>
      </form>}
    </Dialog>}
    {selected?.folder === "inbox" && <MailIntakePanel key={selected.id} message={selected} records={records} onCreate={onCreate}/>}
    </>}
  </section>;
}
