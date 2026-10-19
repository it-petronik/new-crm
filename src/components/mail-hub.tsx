"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ArrowDownUp,
  FileText,
  Inbox,
  Mail,
  Plus,
  RefreshCw,
  Reply,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogActions,
  Field,
  Input,
  Textarea,
} from "./ui/controls";
import type { MailDraft, MailMessage } from "@/lib/mail/model";
import MailIntakePanel, { type IntakeProps } from "./mail-intake";
import SocialChannels from "./social-channels";
import { PageHeader } from "./ui/layout";
import styles from "./studio/communication.module.css";
import OutboundPanel from "./outbound/outbound-panel";
import type { Actor } from "@/lib/domain";
import MailboxConnect from "./mailbox-connect";
import MailContent from "./mail-content";
import { createReaderCache } from "@/lib/mail/reader-cache";
import { sortMail, mergeMailPreviews, type MailSort } from "@/lib/mail/list";
import { mailJson } from "@/lib/mail/request";

export default function MailHub({
  actor,
  preview,
  records,
  onCreate,
}: { actor: Actor; preview: boolean } & IntakeProps) {
  const [section, setSection] = useState<"email" | "channels" | "outbound">(
    "email",
  );
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [mode, setMode] = useState("loading");
  const [folder, setFolder] = useState<MailMessage["folder"]>("inbox");
  const [query, setQuery] = useState("");
  const [sort,setSort]=useState<MailSort>("newest");
  const [connectionNotice,setConnectionNotice]=useState("");
  const [selected, setSelected] = useState<MailMessage | null>(null);
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [onlyLeads, setOnlyLeads] = useState(false);
  const [folderState,setFolderState]=useState<{syncedAt?:number;inbox?:{total:number;available:boolean};sent?:{total:number;available:boolean};drafts?:{total:number;available:boolean}}>({}),[folderBusy,setFolderBusy]=useState(false);
  const folderWorking=useRef(false);
  const previews=useRef<MailMessage[]>([]);
  const pageWorking=useRef(false),pageDone=useRef(new Set<string>()),pageAttempts=useRef(0),previewGeneration=useRef(0);
  const [pageBusy,setPageBusy]=useState(false),[pageError,setPageError]=useState(""),[pageRetry,setPageRetry]=useState(0);
  function acceptPreview(data:{kind?:string;total?:number;messages?:MailMessage[]}){if(!data.messages)return;const inbox=data.kind==="inbox";previews.current=mergeMailPreviews(previews.current,data.messages);if(inbox&&data.total!==undefined)setFolderState(old=>({...old,inbox:{total:data.total!,available:true}}));}
  const readerCache=useRef(createReaderCache());
  useEffect(()=>{if(mode!=="connected"){readerCache.current.clear();previews.current=[];pageDone.current.clear();previewGeneration.current++;}},[mode]);
  useEffect(()=>{readerCache.current.clear();return()=>readerCache.current.clear();},[actor.id]);
  async function syncFolders(){if(folderWorking.current)return;folderWorking.current=true;setFolderBusy(true);try{const data=await mailJson("/api/mail/folders",{method:"POST"});acceptPreview(data);await load();}catch(e){setConnectionNotice(e instanceof Error?e.message:"Folders unavailable. Retrying automatically.");}finally{folderWorking.current=false;setFolderBusy(false);}}
  const readerRef=useRef<HTMLElement>(null),listRef=useRef<HTMLDivElement>(null);
  function movePane(pane:HTMLElement|null,direction:number){pane?.scrollBy({top:direction*Math.max(160,pane.clientHeight*0.75),behavior:"smooth"});}
  async function load() {
    const data = await mailJson("/api/mail",{},1);
    setConnectionNotice("");
    setMode(data.mode);
    const next=data.mode==="connected"?[...data.messages,...previews.current]:data.messages;
    setMessages(next);
    setFolderState(data.folders||{});
    setSelected((old) =>
      old
        ? next.find((m: MailMessage) => m.id === old.id) || null
        : null,
    );
  }
  useEffect(() => {
    if (!preview)
      void load().catch((error) => {
        setMode("error");
        setConnectionNotice(error.message);
      });
  }, [preview]);
  useEffect(()=>{if(mode!=="connected"&&mode!=="error")return;const recover=()=>{void load().catch(e=>setConnectionNotice(e.message));if(mode==="connected")void syncFolders();};if(mode==="connected")void syncFolders();const timer=setInterval(()=>{if(document.visibilityState==="visible")recover();},mode==="error"?10000:60000);window.addEventListener("online",recover);window.addEventListener("focus",recover);return()=>{clearInterval(timer);window.removeEventListener("online",recover);window.removeEventListener("focus",recover);};},[mode]);
  useEffect(()=>{if(listRef.current)listRef.current.scrollTop=0;},[folder,onlyLeads,sort,query]);
  useEffect(()=>{setPageError("");pageAttempts.current=0;},[folder]);
  async function compose(message?: MailMessage) {
    setNotice("");
    setConfirm(false);
    if(message?.remote&&message.folder==="drafts"){try{const r=await fetch(`/api/mail/message?id=${message.id}`,{cache:"no-store"});const data=await r.json();if(!r.ok)throw new Error(data.error);setDraft({id:crypto.randomUUID(),to:message.to,subject:message.subject,body:data.body});setNotice("Editing a private copy. Your original server draft is unchanged.");}catch(e){setNotice(e instanceof Error?e.message:"Draft unavailable.");}return;}
    setDraft(
      message?.folder === "drafts"&&!message.remote
        ? {
            id: message.id,
            to: message.to,
            subject: message.subject,
            body: message.body,
            version: message.version,
          }
        : {
            id: crypto.randomUUID(),
            to: message?.remote&&message.folder==="outbox"?message.to:message?.sender || "",
            subject: message
              ? `Re: ${message.subject.replace(/^Re:\s*/i, "")}`
              : "",
            body: "",
          },
    );
  }
  async function save(send: boolean) {
    if (!draft || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          action: send ? (mode === "connected" ? "send" : "send-test") : "save",
          ...(send ? { confirmed: true } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Could not save message.");
      setDraft(null);
      setConfirm(false);
      setSelected(null);
      setFolder(send ? mode==="connected"?"history":"outbox" : "drafts");
      await load();
      setNotice(
        !send
          ? "Draft saved privately."
          : data.delivery === "accepted"
            ? "Your email server accepted the message. Delivery is not confirmed."
            : data.delivery === "uncertain"
              ? "Submission uncertain. Check your mailbox history before sending again."
              : data.delivery === "rejected"
                ? "Your email server rejected the message. Check its details before creating a replacement."
                : "Captured in the test outbox. No real email was sent.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Email unavailable.");
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  const shown = sortMail(messages.filter(
    (m) =>
      m.folder === folder &&
      (!onlyLeads || m.folder !== "inbox" || m.candidate === 1) &&
      `${m.subject} ${m.sender} ${m.to}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  ),sort);
  const loaded=messages.filter(m=>m.folder===folder).length;
  const folderTotal=mode!=="connected"?loaded:folder==="inbox"?folderState.inbox?.total:folder==="outbox"?folderState.sent?.total:folder==="drafts"?(folderState.drafts?.total??0)+messages.filter(m=>m.folder==="drafts"&&!m.remote).length:loaded;
  const waitingForHeaders=mode==="connected"&&loaded===0&&!query&&!onlyLeads&&folder!=="history"&&(folderTotal===undefined||folderTotal>0);
  useEffect(()=>{
    if(mode!=="connected"||folder==="history"||pageWorking.current||pageDone.current.has(folder)||pageError)return;
    const candidates=previews.current.filter(m=>m.folder===folder&&m.uid),oldest=candidates.reduce<MailMessage|undefined>((a,b)=>!a||b.uid!<a.uid!?b:a,undefined);
    if(!oldest)return;
    if(folderTotal!==undefined&&loaded>=folderTotal){pageDone.current.add(folder);return;}
    const generation=previewGeneration.current;pageWorking.current=true;setPageBusy(true);
    void mailJson("/api/mail/page",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({folder,cursor:oldest.id})},2).then(async data=>{
      if(generation!==previewGeneration.current)return;
      if(!data.hasMore||!data.messages?.length)pageDone.current.add(folder);
      previews.current=mergeMailPreviews(previews.current,data.messages||[]);pageAttempts.current=0;await load();
    }).catch(e=>{if(generation===previewGeneration.current){setPageError(e.message||"Could not load older messages.");}}).finally(()=>{pageWorking.current=false;setPageBusy(false);});
  },[messages,mode,folder,folderTotal,pageRetry,pageError]);
  useEffect(()=>{if(!pageError||pageAttempts.current>=3)return;const timer=setTimeout(()=>{pageAttempts.current++;setPageError("");setPageRetry(n=>n+1);},2000*2**pageAttempts.current);const retry=()=>{pageAttempts.current=0;setPageError("");setPageRetry(n=>n+1);};window.addEventListener("online",retry);return()=>{clearTimeout(timer);window.removeEventListener("online",retry);};},[pageError,pageRetry]);
  useEffect(()=>{if(window.innerWidth>680&&shown.length&&(!selected||!shown.some(m=>m.id===selected.id)))setSelected(shown[0]);},[messages,folder,query,onlyLeads,sort]);
  const patch = (key: keyof MailDraft, value: string) =>
    setDraft((d) => d && { ...d, [key]: value });
  const dateLabel = (value: number) =>
    new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  return (
    <section className={`mail-hub ${styles.hub}`} data-mail-view={section}>
      <nav className="communication-tabs" aria-label="Communication workspace">
        <Button
          aria-pressed={section === "email"}
          onClick={() => setSection("email")}
        >
          Email workspace
        </Button>
        <Button
          aria-pressed={section === "outbound"}
          onClick={() => setSection("outbound")}
        >
          Outbound &amp; templates
        </Button>
        <Button
          aria-pressed={section === "channels"}
          onClick={() => setSection("channels")}
        >
          Social channels
        </Button>
      </nav>
      {section === "outbound" ? (
        <OutboundPanel actor={actor} records={records} preview={preview} />
      ) : section === "channels" ? (
        <SocialChannels sandbox={mode === "sandbox"} />
      ) : (
        <>
          <PageHeader title="Email"
            description="Your private customer conversations. Only you can read your mailbox."
            actions={
              ["sandbox", "connected"].includes(mode) && (
                <Button className="primary" onClick={() => compose()}>
                  <Plus size={16} />
                  New email
                </Button>
              )
            }
          />
          <MailboxConnect
            preview={preview}
            onChanged={(reset,snapshot) => {
              if (reset) {
                readerCache.current.clear();
                previews.current=[];
                previewGeneration.current++;pageDone.current.clear();pageAttempts.current=0;setPageError("");
                setSelected(null);
                setDraft(null);
                setOnlyLeads(false);
              }
              if(snapshot)acceptPreview(snapshot);
              void load().catch((e) => setNotice(e.message));
            }}
          />
          <div className="mail-status">
            <ShieldCheck size={18} />
            <span>
              {preview
                ? "Browser preview — use the local test workspace for email and collaboration."
                : mode === "connected"
                  ? "Temporary previews only · no synced email copies saved · enquiry matches require review"
                  : mode === "sandbox"
                    ? "Local test inbox · fictional messages · sending is captured, never delivered"
                    : mode === "loading"
                      ? "Loading your mailbox…"
                      : "Not connected · no mail is being received or sent"}
            </span>
          </div>
          {notice && (
            <p role="status" className="mail-notice">
              {notice}
            </p>
          )}
          {connectionNotice&&<p role="status" className="mail-notice">{connectionNotice}</p>}
          {mode === "loading"&&!preview ? <div className="panel mail-loading-skeleton" role="status" aria-label="Loading mailbox">{Array.from({length:8},(_,i)=><i key={i}/>)}</div> : preview || mode === "disconnected" || mode === "error" ? (
            <div className="panel mail-setup">
              <Mail size={28} />
              <h2>
                {preview
                  ? "Test with separate signed-in users"
                  : "Your cPanel mailbox"}
              </h2>
              <p>
                IMAP: mail.petronik.ae · 993 · SSL/TLS
                <br />
                SMTP: mail.petronik.ae · 465 · SSL/TLS
              </p>
              <p>
                {preview
                  ? "Do not enter email passwords in this browser-only preview. Use the full local workspace."
                  : "Connect your email above to fetch your inbox securely. Your mailbox remains private to you."}
              </p>
              {preview && (
                <p>
                  Start the local review environment with{" "}
                  <code>npm run dev:review</code>, then open{" "}
                  <a href="http://localhost:8788/login">
                    the local test workspace
                  </a>
                  .
                </p>
              )}
              {mode === "error" && (
                <Button
                  className="secondary"
                  onClick={() => void load().catch((e) => setNotice(e.message))}
                >
                  Try again
                </Button>
              )}
            </div>
          ) : (
            ["sandbox", "connected"].includes(mode) && (
              <div
                className={`mail-layout panel ${styles.mail} ${selected ? "has-selection" : ""}`}
              >
                <aside className={styles.folders}>
                  <p>Your mailbox</p>
                  <nav className={styles.folderNav} aria-label="Email folders">
                    {(["inbox", "drafts", "outbox",...(mode==="connected"?["history" as const]:[])] as const).map((f) => (
                      <Button
                        key={f}
                        aria-pressed={folder === f}
                        onClick={() => {
                          setFolder(f);
                          setSelected(null);
                          if(mode==="connected"&&(f==="drafts"||f==="outbox"))void syncFolders();
                        }}
                      >
                        {f === "inbox" ? (
                          <Inbox size={15} />
                        ) : f === "drafts" ? (
                          <FileText size={15} />
                        ) : (
                          <Send size={15} />
                        )}
                        {f === "outbox"
                          ? mode === "connected"
                            ? "Sent"
                            : "Test outbox"
                          : f==="history"?"Activity":f === "inbox"
                            ? "Inbox"
                            : "Drafts"}
                        <span className="mail-count">
                          {mode==="connected"&&f==="inbox"?(folderState.inbox?.total??"…"):mode==="connected"&&(f==="drafts"||f==="outbox")?(folderState.syncedAt?(f==="outbox"?folderState.sent?.total||0:(folderState.drafts?.total||0)+messages.filter(m=>m.folder==="drafts"&&!m.remote).length):"…"):messages.filter((m) => m.folder === f).length}
                        </span>
                      </Button>
                    ))}
                  </nav>
                  {mode==="connected"&&<Button className="secondary mail-lead-filter" title={onlyLeads?"Show the complete inbox and clear enquiry/search filters.":"Conservative rule-based matching, not confirmed buyers. Automated notifications are excluded."} aria-pressed={onlyLeads} onClick={()=>{if(onlyLeads)setQuery("");setOnlyLeads(v=>!v);setFolder("inbox");setSelected(null);}}>{onlyLeads?"Show all emails":"Possible enquiries"} · {onlyLeads?(folderState.inbox?.total??"…"):messages.filter(m=>m.folder==="inbox"&&m.candidate===1).length}</Button>}
                  {folderBusy&&<small className="mail-folder-status" role="status">Syncing folders…</small>}
                </aside>
                <aside className="mail-list">
                  <div className={styles.listTitle}>
                    <h2>
                      {folder === "inbox"
                        ? "Inbox"
                        : folder === "drafts"
                          ? "Drafts"
                          : folder==="history"?"Activity":mode === "connected"
                            ? "Sent"
                            : "Test outbox"}
                    </h2>
                    <span>{onlyLeads&&folder==="inbox"?`${shown.length} enquiry matches`:query?`${shown.length} search matches`:`${loaded} loaded`}{folderTotal!==undefined?` · ${folderTotal} total`:""}</span>
                  </div>
                  <div className="mail-search">
                    <Input
                      aria-label="Search email"
                      placeholder="Search this folder…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <Button
                      aria-label="Refresh email"
                      onClick={() =>
                        mode==="connected"?(folder==="outbox"||folder==="drafts"?void syncFolders():window.dispatchEvent(new Event("enercore-mail-sync"))):void load().catch((e) => setNotice(e.message))
                      }
                    >
                      <RefreshCw size={16} />
                    </Button>
                    <Button className="secondary mail-sort-button" aria-label={`Sort emails: ${sort==="newest"?"newest":"oldest"} first`} title={`Sort: ${sort==="newest"?"newest":"oldest"} first. Click to reverse.`} onClick={()=>setSort(v=>v==="newest"?"oldest":"newest")}><ArrowDownUp size={16}/></Button>
                  </div>
                  {onlyLeads&&<div className="mail-sort"><small>Enquiry filter active · not all mail</small></div>}
                  <div ref={listRef} className="mail-message-list" role="region" aria-label="Messages" tabIndex={0}>{shown.map((m) => (
                    <button
                      key={m.id}
                      aria-pressed={selected?.id === m.id}
                      className={`mail-row ${selected?.id === m.id ? "selected" : ""}`}
                      onClick={() => setSelected(m)}
                    >
                      <span className="mail-row-meta">
                        <span>
                          {m.folder === "inbox" ? m.sender : `To: ${m.to}`}
                        </span>
                        <time>{dateLabel(m.updatedAt)}</time>
                      </span>
                      <strong>{m.subject}</strong>
                      <span className="mail-snippet">{m.body.replace(/\s+/g," ").trim()||"Open to read message"}</span>
                    </button>
                  ))}
                  {waitingForHeaders&&<div className="mail-loading-skeleton" role="status" aria-label="Loading mailbox messages"><i/><i/><i/><p>Fetching your messages… <Button className="secondary" onClick={()=>window.dispatchEvent(new Event("enercore-mail-sync"))}>Retry inbox</Button></p></div>}
                  {!shown.length && !waitingForHeaders && (
                    <p className="mail-empty">
                      {mode==="connected"&&folderState.syncedAt&&((folder==="outbox"&&folderState.sent?.available===false)||(folder==="drafts"&&folderState.drafts?.available===false))?"Your server did not identify this folder. No folder was created or changed.":folderBusy?"Loading mailbox folders…":query
                        ? "No matching messages."
                        : "No messages in this folder yet."}
                    </p>
                  )}
                  </div>{pageError&&<div className="mail-page-status" role="status">Older messages interrupted. <Button className="secondary" onClick={()=>{pageAttempts.current=0;setPageError("");setPageRetry(n=>n+1);}}>Retry older messages</Button></div>}<div className="mail-list-scroll-controls"><small>{shown.length} shown{folderTotal!==undefined?` · ${folderTotal} in folder`:""}{pageBusy?" · loading remaining messages…":""}</small><Button className="secondary" aria-label="Scroll inbox up" onClick={()=>movePane(listRef.current,-1)}><ArrowUp size={14}/></Button><Button className="secondary" aria-label="Scroll inbox down" onClick={()=>movePane(listRef.current,1)}><ArrowDown size={14}/></Button></div>
                </aside>
                <article key={`${folder}:${selected?.id||"empty"}`} ref={readerRef} className="mail-reader" aria-label="Email reader" tabIndex={0}>
                  {selected ? (
                    <>
                      <div className="mail-reader-toolbar">
                        <Button
                          className="secondary mail-back"
                          onClick={() => setSelected(null)}
                        >
                          <ArrowLeft size={16} />
                          Back to messages
                        </Button>
                        <span className="mail-reader-label">
                          {selected.remote?(selected.folder==="drafts"?"Server draft":"Sent mail"):selected.folder === "outbox"||selected.folder==="history"
                            ? selected.status
                              ? (
                                  {
                                    accepted:
                                      "Accepted by email server · delivery unconfirmed",
                                    captured:
                                      "Captured locally · not delivered",
                                    uncertain:
                                      "Submission uncertain · do not resend",
                                    sending: "Submitting · do not retry",
                                    rejected: "Server rejected",
                                  } as Record<string, string>
                                )[selected.status]
                              : "Captured test email"
                            : selected.folder === "drafts"
                              ? "Private draft"
                              : "Inbox"}
                        </span>
                        <time>{dateLabel(selected.updatedAt)}</time><span className="mail-reader-scroll-controls"><Button className="secondary" aria-label="Scroll email up" onClick={()=>movePane(readerRef.current,-1)}><ArrowUp size={14}/></Button><Button className="secondary" aria-label="Scroll email down" onClick={()=>movePane(readerRef.current,1)}><ArrowDown size={14}/></Button></span>
                      </div>
                      <h2>{selected.subject}</h2>
                      <div className="mail-sender">
                        <span className="mail-avatar">
                          {selected.sender.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <strong>{selected.sender}</strong>
                          <p>To: {selected.to}</p>
                        </div>
                      </div>
                      <MailContent key={selected.id} cache={readerCache.current} message={selected} connected={mode==="connected"&&(selected.folder==="inbox"||Boolean(selected.remote))}/>
                      <div className="mail-reader-footer">
                        {selected.folder !== "history"&&(selected.folder!=="outbox"||selected.remote) ? (
                          <Button
                            className="secondary"
                            onClick={() => compose(selected)}
                          >
                            <Reply size={16} />
                            {selected.folder === "drafts"
                              ? selected.remote?"Copy to new draft":"Edit draft"
                              : "Reply"}
                          </Button>
                        ) : mode === "sandbox" ? (
                          <p>
                            <ShieldCheck size={16} />
                            Captured locally. This message was not delivered.
                          </p>
                        ) : (
                          <p>
                            Message reference: {selected.id}. Submissions are
                            not retried automatically.
                          </p>
                        )}
                        {mode === "connected" &&
                          selected.folder === "inbox" && (
                            <Button
                              className="secondary"
                              onClick={async () => {
                                try {
                                  const r = await fetch(
                                    "/api/mail/connection",
                                    {
                                      method: "POST",
                                      headers: {
                                        "Content-Type": "application/json",
                                      },
                                      body: JSON.stringify({
                                        action: "seen",
                                        id: selected.id,
                                        read: !selected.isRead,
                                      }),
                                    },
                                  );
                                  const d = await r.json();
                                  if (!r.ok) throw new Error(d.error);
                                  previews.current=previews.current.map(m=>m.id===selected.id?{...m,isRead:Number(!selected.isRead)}:m);await load();
                                } catch (e) {
                                  setNotice(
                                    e instanceof Error
                                      ? e.message
                                      : "Could not update message.",
                                  );
                                }
                              }}
                            >
                              {selected.isRead ? "Mark unread" : "Mark read"}
                            </Button>
                          )}
                      </div>
                      {selected.folder === "inbox"&&<MailIntakePanel key={selected.id} message={selected} records={records} onCreate={onCreate}/>}
                    </>
                  ) : (
                    <div className="mail-empty mail-reader-empty">
                      <span className="mail-empty-icon">
                        <Mail size={26} />
                      </span>
                      <h2>{waitingForHeaders?"Loading your mailbox…":"Your conversations, in one place"}</h2>
                      <p>
                        Select a message to read it, or start a new email.
                        <br />
                        Your mailbox is visible only to you.
                      </p>
                    </div>
                  )}
                </article>
              </div>
            )
          )}
          {draft && (
            <Dialog
              title={confirm ? "Review your email" : "Compose email"}
              description={
                mode === "connected"
                  ? "Private connected mailbox"
                  : "Private mailbox · local test mode"
              }
              dismissOnOutside={false}
              onClose={() => {
                if (!busy) {
                  setDraft(null);
                  setConfirm(false);
                }
              }}
              className="mail-compose simple-entry-dialog"
            >
              {confirm ? (
                <div className="mail-review">
                  <div className="mail-status">
                    <ShieldCheck size={18} />
                    <span>
                      {mode === "connected"
                        ? "Confirming submits this message to your email server. Check the recipient and content before sending."
                        : "No external email will be sent. This copy stays in your test outbox."}
                    </span>
                  </div>
                  <dl>
                    <dt>To</dt>
                    <dd>{draft.to}</dd>
                    <dt>Subject</dt>
                    <dd>{draft.subject}</dd>
                  </dl>
                  <div className="mail-body">{draft.body}</div>
                  <DialogActions
                    pending={busy}
                    onCancel={() => setConfirm(false)}
                    cancel="Back to edit"
                    primary={{
                      label: busy
                        ? "Submitting…"
                        : mode === "connected"
                          ? "Confirm send"
                          : "Confirm test send",
                      icon: <Send size={16} />,
                      onClick: () => void save(true),
                      disabled: busy,
                    }}
                  />
                </div>
              ) : (
                <form
                  id="mail-compose-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setConfirm(true);
                  }}
                >
                  <div className="mail-compose-fields">
                    <Field>
                      To
                      <Input
                        type="email"
                        required
                        value={draft.to}
                        onChange={(e) => patch("to", e.target.value)}
                        maxLength={254}
                      />
                    </Field>
                    <Field>
                      Subject
                      <Input
                        required
                        value={draft.subject}
                        onChange={(e) => patch("subject", e.target.value)}
                        maxLength={200}
                      />
                    </Field>
                    <Field>
                      Message
                      <Textarea
                        placeholder="Write your message…"
                        required
                        rows={7}
                        value={draft.body}
                        onChange={(e) => patch("body", e.target.value)}
                        maxLength={20000}
                      />
                    </Field>
                    <Button
                      type="button"
                      className="text-button"
                      disabled={Boolean(draft.body.trim())}
                      onClick={() =>
                        patch(
                          "body",
                          "Hello,\n\nThank you for your enquiry. Could you confirm the required quantity and delivery destination?\n\nKind regards",
                        )
                      }
                    >
                      Use enquiry reply template
                    </Button>
                    {notice && <p role="alert">{notice}</p>}
                  </div>
                  <DialogActions
                    pending={busy}
                    cancel={false}
                    start={
                      <span className="mail-footer-hint">
                        <ShieldCheck size={15} />
                        Not sent until confirmed
                      </span>
                    }
                    secondary={
                      <Button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => void save(false)}
                      >
                        Save draft
                      </Button>
                    }
                    primary={{
                      label:
                        mode === "connected"
                          ? "Review email"
                          : "Review test email",
                      type: "submit",
                      form: "mail-compose-form",
                      icon: <Send size={16} />,
                      disabled: busy,
                    }}
                  />
                </form>
              )}
            </Dialog>
          )}
        </>
      )}
    </section>
  );
}
