"use client";
import { Form } from '@/components/ui/controls';

import { useEffect, useRef, useState } from "react";
import {
  LockKeyhole,
  Mail,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { Button, Dialog, DialogActions, Field, Input } from "./ui/controls";
import { businessStamp } from "@/lib/gst";
import styles from "./studio/mailbox.module.css";
import { mailJson } from "@/lib/mail/request";
type Connection = {
  connected: boolean;
  configured?: boolean;
  host?: string;
  connection?: {
    address: string;
    host: string;
    lastSyncAt: number | null;
    lastError: string | null;
  };
};
export default function MailboxConnect({
  preview,
  onChanged,
}: {
  preview: boolean;
  onChanged: (reset?: boolean, snapshot?: {kind?:string;total?:number;messages?:import("@/lib/mail/model").MailMessage[]}) => void;
}) {
  const [state, setState] = useState<Connection | null>(null),
    [open, setOpen] = useState(false),
    [disconnect, setDisconnect] = useState(false),
    [address, setAddress] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const callback = useRef(onChanged),
    working = useRef(false);
  const hasInbox=useRef(false);
  const queued=useRef<{body:unknown;reset:boolean;resolve:(v:boolean|undefined)=>void}|null>(null);
  callback.current = onChanged;
  async function load() {
    const data = await mailJson<Connection>("/api/mail/connection",{},1);
    setState(data);
  }
  async function action(body: unknown, reset = false, quiet = false):Promise<boolean|undefined> {
    if (working.current) {if(quiet||queued.current)return;setBusy(true);return new Promise(resolve=>{queued.current={body,reset,resolve};});}
    working.current = true;
    if (!quiet) {
      setBusy(true);
      setError("");
    }
    try {
      const data = await mailJson("/api/mail/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setError("");
      if (!quiet) {
        setPassword("");
        setOpen(false);
        setDisconnect(false);
      }
      callback.current(reset,data);
      if(reset)hasInbox.current=false;
      if(data.kind==="inbox"&&Array.isArray(data.messages))hasInbox.current=true;
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection unavailable.");
      return false;
    } finally {
      working.current = false;
      setBusy(false);
      const pending=queued.current;queued.current=null;if(pending)void action(pending.body,pending.reset).then(pending.resolve);
    }
  }
  useEffect(() => {
    if(preview)return;
    const recover=()=>{if(!working.current)void load().then(()=>setError("")).catch(e=>setError(e.message));};
    recover();const timer=setInterval(recover,10000);window.addEventListener("online",recover);
    return()=>{clearInterval(timer);window.removeEventListener("online",recover);};
  }, [preview]);
  useEffect(() => {
    if (!state?.connected) return;
    // Immediate and five-second checks while the Email page is visible. The server's
    // lease coalesces routine polling, not a tab's first private preview read.
    const check = () => {
      if (document.visibilityState === "visible")
        void action({ action: "sync",manual:!hasInbox.current }, false, true);
    };
    void action({action:"sync",manual:true},false,true);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, 5000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const manual = () => void action({ action: "sync", manual: true });
    window.addEventListener("enercore-mail-sync", manual);
    window.addEventListener("online",manual);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("enercore-mail-sync", manual);
      window.removeEventListener("online",manual);
    };
  }, [state?.connected]);
  const c = state?.connection;
  return (
    <section
      className={styles.card}
      data-connected={Boolean(c)}
      aria-label="Your email connection"
    >
      <span className={styles.icon}>
        <LockKeyhole size={21} />
      </span>
      <div className={styles.copy}>
        <strong>{c ? c.address : "Connect your own email"}</strong>
        <p>
          {c
            ? `Private mailbox · ${c.host} · TLS encrypted connection`
            : "Sign in with your cPanel email account to fetch messages and review potential leads."}
        </p>
        {c && (
          <small>
            {c.lastSyncAt
              ? `Last synced ${businessStamp(new Date(c.lastSyncAt))}`
              : "First sync pending"}{" "}
            · Preview only · checks every 5 seconds
          </small>
        )}
        {c?.lastError && <p role="alert">{c.lastError}</p>}
      </div>
      <div className={styles.actions}>
        {c ? (
          <>
            <Button
              className="secondary"
              disabled={busy}
              onClick={() => void action({ action: "sync", manual: true })}
            >
              <RefreshCw size={15} />
              Sync inbox
            </Button>
            <Button
              className="secondary"
              disabled={busy}
              onClick={() => setDisconnect(true)}
            >
              <Unplug size={15} />
              Disconnect
            </Button>
          </>
        ) : (
          <Button
            className="primary"
            disabled={preview || !state || busy || !state.configured}
            onClick={() => {
              setOpen(true);
              setError("");
            }}
          >
            <Mail size={16} />
            Connect email
          </Button>
        )}
      </div>
      {!state?.connected && state && !state.configured && (
        <p className={styles.full}>
          An administrator must configure mailbox encryption before credentials
          can be saved.
        </p>
      )}
      {error && !open && (
        <p className={styles.full} role="alert">
          {error}
        </p>
      )}
      {open && (
        <Dialog
          title="Connect your email"
          description="Your email stays private to your CRM account. This does not sign you out of your existing email app."
          onClose={() => {
            if (!busy) {
              setOpen(false);
              setPassword("");
            }
          }}
          dismissOnOutside={false}
        >
          <Form
            id="mailbox-connect"
            className={styles.form}
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await action(
                {
                  action: "connect",
                  host: state?.host || "mail.petronik.ae",
                  address,
                  password,
                },
                true,
              );
              if (ok) void action({ action: "sync" });
            }}
          >
            <div className={styles.security}>
              <ShieldCheck size={19} />
              <p>
                Your password is encrypted on the server. It is never returned
                to the browser or saved in browser storage.
              </p>
            </div>
            <Field>
              Email address
              <Input
                type="email"
                autoComplete="username"
                required
                maxLength={254}
                placeholder="you@petronik.ae"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Field>
            <Field>
              Email password
              <Input
                type="password"
                autoComplete="current-password"
                required
                maxLength={500}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <div className={styles.settings}>
              <strong>Secure cPanel settings</strong>
              <span>Server: {state?.host || "mail.petronik.ae"}</span>
              <span>Incoming: IMAP · 993 · SSL/TLS</span>
              <span>Outgoing: SMTP · 465 · SSL/TLS</span>
            </div>
            <label className={styles.consent}>
              <Input type="checkbox" required />I own or am authorised to use
              this mailbox and allow Enercore to fetch and privately cache its
              messages.
            </label>
            <p className={styles.hint}>
              The latest inbox headers load first, then older headers load
              progressively in this tab. Message text loads separately from
              attachments, which download only when requested. Potential leads
              need your review before becoming shared CRM records.
            </p>
            {error && <p role="alert">{error}</p>}
            <DialogActions
              pending={busy}
              onCancel={() => {
                setOpen(false);
                setPassword("");
              }}
              primary={{
                label: busy ? "Connecting securely…" : "Connect securely",
                type: "submit",
                form: "mailbox-connect",
                disabled: busy,
              }}
            />
          </Form>
        </Dialog>
      )}
      {disconnect && (
        <Dialog
          title="Disconnect your mailbox?"
          description="This removes the saved email password, cached messages and private mail drafts from Enercore. Your actual mailbox and any CRM records already created from it are not deleted."
          onClose={() => {
            if (!busy) setDisconnect(false);
          }}
        >
          <DialogActions
            pending={busy}
            onCancel={() => setDisconnect(false)}
            primary={{
              label: "Disconnect and clear cache",
              disabled: busy,
              onClick: () =>
                void action({ action: "disconnect", confirmed: true }, true),
            }}
          />
        </Dialog>
      )}
    </section>
  );
}
