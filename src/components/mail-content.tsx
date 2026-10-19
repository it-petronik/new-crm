"use client";
import { useEffect, useRef, useState } from "react";
import { mailJson, mailBytes } from "@/lib/mail/request";
import MailOriginal from "./mail-original";
import { compactMailText } from "@/lib/mail/display";
import {
  Download,
  FileText,
  ImageIcon,
  Paperclip,
  RefreshCw,
  X,
} from "lucide-react";
import { Button, Dialog } from "./ui/controls";
import type { MailMessage } from "@/lib/mail/model";
import type { MailDetail, MailAttachment } from "@/lib/mail/imap";
import type { ReaderCache } from "@/lib/mail/reader-cache";
import styles from "./studio/communication.module.css";
const size = (n: number) =>
  n >= 1048576
    ? `${(n / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
function linkText(text:string){
  return text.split(/(https?:\/\/[^\s<>]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi).map((part,i)=>{
    if(!/^(?:https?:\/\/|[A-Z0-9._%+-]+@)/i.test(part))return part;
    const href=part.includes("://")?part:`mailto:${part}`;
    return <a key={i} href={href} target="_blank" rel="noopener noreferrer" title={href}>{part}</a>;
  });
}
function AttachmentThumbnail({id,file}:{id:string;file:MailAttachment}){
  const [url,setUrl]=useState("");
  useEffect(()=>{const controller=new AbortController();let objectUrl="";
    mailBytes(`/api/mail/message?id=${encodeURIComponent(id)}&part=${encodeURIComponent(file.part)}`,{signal:controller.signal}).then(bytes=>{
      if(controller.signal.aborted||bytes.byteLength>262144)return;
      objectUrl=URL.createObjectURL(new Blob([bytes],{type:file.type}));setUrl(objectUrl);
    }).catch(()=>{});return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[id,file.part,file.type]);
  return url?<img className="mail-attachment-thumb" src={url} alt={`Thumbnail of ${file.name}`}/>:<span className="mail-attachment-thumb-placeholder"><ImageIcon size={20}/></span>;
}
export default function MailContent({
  message,
  connected,
  cache,
}: {
  message: MailMessage;
  connected: boolean;
  cache: ReaderCache;
}) {
  const [detail, setDetail] = useState<MailDetail | null>(()=>connected?cache.get(message.id):null),
    [loading, setLoading] = useState(connected&&!cache.get(message.id)),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [downloading, setDownloading] = useState(""),
    [preview, setPreview] = useState<{
      url: string;
      name: string;
      type: string;
    } | null>(null);
  const [metadata,setMetadata]=useState<MailAttachment[]>([]);
  const attempts=useRef(0),failed=useRef(false),blocked=useRef(false);
  useEffect(()=>{if(!connected)return;const recover=()=>{if(failed.current&&!blocked.current){attempts.current=0;setRetry(n=>n+1);}};window.addEventListener("online",recover);window.addEventListener("focus",recover);return()=>{window.removeEventListener("online",recover);window.removeEventListener("focus",recover);};},[connected]);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const cached=cache.get(message.id);
    if(cached&&!retry){setDetail(cached);setLoading(false);return;}
    setDetail(null);
    setLoading(true);
    setError("");
    mailJson(`/api/mail/message?id=${encodeURIComponent(message.id)}&metadata=1`,{signal:controller.signal},1).then(data=>{if(!controller.signal.aborted)setMetadata(data.attachments||[]);}).catch(()=>{});
    cache.load(message.id,Boolean(retry))
      .then((data) => {
        if (!controller.signal.aborted){setDetail(data);setError("");failed.current=false;attempts.current=0;}
      })
      .catch((e) => {
        if (!controller.signal.aborted&&e.name !== "AbortError"){failed.current=true;blocked.current=[401,403,404].includes(e.status);setError(e.message);if(!blocked.current&&attempts.current<3){timer=setTimeout(()=>setRetry(n=>n+1),2000*2**attempts.current++);}}
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {controller.abort();clearTimeout(timer);};
  }, [message.id, connected, retry, cache]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  async function open(file: MailAttachment, view = false) {
    if (downloading) return;
    setDownloading(file.part);
    setError("");
    if(view)setPreview({url:"",name:file.name,type:file.type});
    try {
      const bytes = await mailBytes(
        `/api/mail/message?id=${encodeURIComponent(message.id)}&part=${encodeURIComponent(file.part)}`,
        { cache: "no-store" },
      );
      const type = /^image\/(png|jpeg|gif|webp)$|^application\/pdf$/.test(file.type)
          ? file.type
          : "application/octet-stream",
        url = URL.createObjectURL(new Blob([bytes], { type }));
      if (view) setPreview({ url, name: file.name, type });
      else {
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      if(view)setPreview(null);
      setError(e instanceof Error ? e.message : "Download unavailable.");
    } finally {
      setDownloading("");
    }
  }
  const files = detail?.attachments || metadata;
  return (
    <>
      <div className="mail-content-state" aria-live="polite">
        {loading && (
          <span className="sr-only">
            <RefreshCw size={12} className="ui-spinner" />
            Loading full message and attachments…
          </span>
        )}
        {error && (
          <p role="alert">
            {error}{" "}
            <Button
              className="secondary"
              onClick={() => {attempts.current=0;setRetry((n) => n + 1);}}
            >
              Retry
            </Button>
          </p>
        )}
      </div>
      {files.length > 0 && (
        <section className="mail-attachments" aria-label="Email attachments">
          <h3>
            <Paperclip size={15} />
            {files.length} attachment{files.length !== 1 ? "s" : ""}
          </h3>
          <div className="mail-attachment-grid">
            {files.map((file) => (
              <article key={file.part} className="mail-attachment">
                {/^image\/(png|jpeg|gif|webp)$/.test(file.type)&&file.size>0&&file.size<=262144&&files.indexOf(file)<2?<AttachmentThumbnail id={message.id} file={file}/>:<FileText size={21} />}
                <div>
                  <strong title={file.name}>{file.name}</strong>
                  <small>
                    {size(file.size)} · {file.type}
                  </small>
                </div>
                <div className="mail-attachment-actions">
                  {/^image\/(png|jpeg|gif|webp)$|^application\/pdf$/.test(
                    file.type,
                  ) && (
                    <Button
                      className="secondary"
                      aria-label={`Preview ${file.name}`}
                      disabled={Boolean(downloading)}
                      onClick={() => void open(file, true)}
                    >
                      <ImageIcon size={14} />
                      Preview
                    </Button>
                  )}
                  <Button
                    className="secondary"
                    aria-label={`Download ${file.name}`}
                    disabled={Boolean(downloading)}
                    onClick={() => void open(file)}
                  >
                    <Download size={14} />
                    {downloading === file.part ? "Loading…" : "Download"}
                  </Button>
                </div>
              </article>
            ))}
          </div>
          <small>
            Downloads on demand · up to 25 MB per attachment · files are not
            scanned for malware
          </small>
        </section>
      )}
      {loading&&<div className="mail-loading-skeleton" role="status" aria-label="Loading email content" aria-busy="true">{!files.length&&<div className="mail-skeleton-attachments"><i/><i/></div>}{Array.from({length:7},(_,i)=><i key={i}/>)}</div>}
      {!loading&&(!connected||detail)&&(detail?.html ? (
        <MailOriginal html={detail.html} id={message.id} files={files}/>
      ) : (
        <div className="mail-body">
          {linkText(compactMailText(detail?.body || message.body)) ||
            (loading ? "" : "Select a message to load its content.")}
        </div>
      ))}
      {detail?.truncated && (
        <p className="mail-body-limit">
          Long message: showing up to 512 KB of text. Attachments are listed
          above.
        </p>
      )}
      {preview && (
        <Dialog
          title={preview.name}
          description="Private attachment preview. No external images or scripts are loaded."
          onClose={() => setPreview(null)}
          className={`mail-attachment-preview ${styles.attachmentPreview}`}
        >
          {!preview.url?<div className="mail-loading-skeleton" role="status" aria-label="Loading attachment preview"><i/><i/><i/></div>:preview.type === "application/pdf" ? (
            <iframe sandbox="" title={preview.name} src={preview.url} />
          ) : (
            <img alt={preview.name} src={preview.url} />
          )}
          <Button className="secondary" onClick={() => setPreview(null)}>
            <X size={14} />
            Close preview
          </Button>
        </Dialog>
      )}
    </>
  );
}
