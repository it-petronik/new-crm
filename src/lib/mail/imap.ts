import { ImapFlow, type MessageStructureObject, type MessageEnvelopeObject } from "imapflow";
import PostalMime from "postal-mime";
import { submitSmtp, type SmtpAccount } from "../outbound/smtp";
import { MailboxError } from "./credentials";
export type MailAccount = { host: string; address: string; password: string };
export type Incoming = {
  uid: number;
  uidValidity: string;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  receivedAt: number;
  isRead: boolean;
  truncated: boolean;
  headersOnly?:boolean;
};
export type MailAttachment = {
  contentId?: string;
  part: string;
  name: string;
  type: string;
  size: number;
};
export type MailDetail = {
  subject?: string;
  sender?: string;
  body: string;
  html?: string;
  truncated: boolean;
  attachments: MailAttachment[];
};
export interface MailTransport {
  page?(account: MailAccount, path: string, before: number, validity: string): Promise<{validity:string;total:number;messages:Incoming[];hasMore:boolean}>;
  metadata?(account: MailAccount, uid: number, validity: string, path?: string): Promise<MailAttachment[]>;
  folders?(account: MailAccount): Promise<RemoteFolder[]>;
  verify(account: MailAccount): Promise<void>;
  fetch(
    account: MailAccount,
    cachedUids?: number[],
    cachedValidity?: string,
  ): Promise<{ validity: string; messages: Incoming[]; total?: number }>;
  detail?(
    account: MailAccount,
    uid: number,
    validity: string,
    path?: string,
  ): Promise<MailDetail>;
  attachment?(
    account: MailAccount,
    uid: number,
    validity: string,
    part: string,
    path?: string,
  ): Promise<{ bytes: Uint8Array; file: MailAttachment }>;
  seen(
    account: MailAccount,
    uid: number,
    validity: string,
    read: boolean,
  ): Promise<void>;
  send(
    account: MailAccount,
    message: { id: string; recipient: string; subject: string; body: string },
  ): Promise<{ status: "accepted" | "captured" | "uncertain" | "rejected" }>;
}
export type RemoteFolder = {
  kind: "sent" | "drafts";
  path: string;
  total: number;
  validity: string;
  messages: Incoming[];
};
export function chooseMailFolder(
  folders: { path: string; specialUse?: string; listed?: boolean }[],
  kind: "sent" | "drafts",
) {
  const special = kind === "sent" ? "\\Sent" : "\\Drafts";
  return (
    folders.find((f) => f.specialUse === special)?.path ||
    folders.find((f) =>
      (kind === "sent"
        ? /^(?:sent|sent items|sent messages|sent mail)$/i
        : /^(?:draft|drafts)$/i
      ).test(f.path.split(/[/.]/).pop() || ""),
    )?.path
  );
}
export function mailParts(root: MessageStructureObject) {
  const attachments: MailAttachment[] = [];
  const texts: MessageStructureObject[] = [];
  function walk(node: MessageStructureObject, depth = 0) {
    if (depth > 20) return;
    const name = node.dispositionParameters?.filename || node.parameters?.name,
      type = node.type.toLowerCase();
    if (
      node.disposition?.toLowerCase() === "attachment" ||
      name ||
      (!type.startsWith("multipart/") &&
        !type.startsWith("text/") &&
        !node.childNodes?.length)
    ) {
      attachments.push({
        contentId: node.id?.replace(/[<>]/g, "").slice(0, 500),
        part: node.part || "TEXT",
        name: (name || `Attachment ${node.part}`)
          .replace(/[\r\n\0]/g, "")
          .slice(0, 200),
        type: node.type.toLowerCase(),
        size: node.size || 0,
      });
      return;
    }
    if (["text/plain", "text/html"].includes(node.type.toLowerCase()))
      texts.push(node);
    else for (const child of node.childNodes || []) walk(child, depth + 1);
  }
  walk(root);
  return {
    attachments,
    html: texts.find((t) => t.type.toLowerCase() === "text/html"),
    text: texts.find((t) => t.type.toLowerCase() === "text/plain") || texts[0],
  };
}
export function safeMailText(text: string, html = false) {
  return (
    html
      ? text
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;|&#160;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
      : text
  ).slice(0, 200000);
}
async function downloadPart(
  client: ImapFlow,
  uid: number,
  part: string,
  max: number,
) {
  const result = await client.download(uid, part, {
    uid: true,
    maxBytes: max + 1,
  });
  if (!result.content)
    throw new MailboxError(
      404,
      "This email part is no longer available. Sync your inbox.",
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of result.content) {
    const bytes = new Uint8Array(chunk);
    size += bytes.length;
    if (size > max) {
      result.content.destroy();
      throw new MailboxError(
        413,
        "This attachment exceeds the 25 MB download limit.",
      );
    }
    chunks.push(bytes);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, meta: result.meta };
}
async function bodyDetail(
  client: ImapFlow,
  uid: number,
  structure: MessageStructureObject,
): Promise<MailDetail> {
  const parts = mailParts(structure);
  if (!parts.text)
    return {
      body: "This email has no text body. Its attachments are listed below.",
      truncated: false,
      attachments: parts.attachments,
    };
  // Fetch a single display representation, not plain text followed by HTML.
  const displayPart = parts.html || parts.text;
  const part = displayPart.part || "TEXT";
  const result = await client.download(uid, part, {
    uid: true,
    maxBytes: 524288,
  });
  if (!result.content)
    throw new MailboxError(404, "Email body not found. Sync again.");
  let text = "";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(result.meta.charset || "utf-8");
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  for await (const chunk of result.content)
    text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  return {
    body: safeMailText(text, displayPart.type.toLowerCase() === "text/html"),
    html:
      displayPart.type.toLowerCase() === "text/html"
        ? text.slice(0, 200000)
        : undefined,
    truncated: (displayPart.size || 0) > 524288 || text.length > 200000,
    attachments: parts.attachments,
  };
}
async function withMessage<T>(
  account: MailAccount,
  uid: number,
  validity: string,
  work: (client: ImapFlow, structure: MessageStructureObject, envelope?: MessageEnvelopeObject) => Promise<T>,
  path = "INBOX",
) {
  return session(account, async (client) => {
    const lock = await client.getMailboxLock(path, { readOnly: true });
    try {
      if (!client.mailbox || String(client.mailbox.uidValidity) !== validity)
        throw new MailboxError(
          409,
          "Inbox changed. Sync before opening this email.",
        );
      const m = await client.fetchOne(
        uid,
        { bodyStructure: true, envelope: true },
        { uid: true },
      );
      if (!m || !m.bodyStructure)
        throw new MailboxError(404, "Email is no longer available.");
      return work(client, m.bodyStructure, m.envelope);
    } finally {
      lock.release();
    }
  });
}
async function session<T>(
  account: MailAccount,
  work: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = new ImapFlow({
    host: account.host,
    port: 993,
    secure: true,
    auth: { user: account.address, pass: account.password },
    tls: { rejectUnauthorized: true, servername: account.host },
    logger: false,
    disableCompression: true,
    disableAutoIdle: true,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  client.on("error", () => {});
  const timer = setTimeout(() => client.close(), 25000);
  try {
    await client.connect();
    return await work(client);
  } catch (e) {
    if (e instanceof MailboxError) throw e;
    if(typeof e==="object"&&e!==null&&"authenticationFailed" in e&&e.authenticationFailed)throw new MailboxError(403,"Mailbox sign-in failed. Reconnect with your updated mailbox password.");
    throw new MailboxError(
      502,
      "Could not connect to your email server. Check the email address, password and server settings.",
    );
  } finally {
    clearTimeout(timer);
    client.close();
  }
}
export async function parseIncoming(
  source: Uint8Array,
  meta: Omit<Incoming, "sender" | "recipient" | "subject" | "body">,
): Promise<Incoming> {
  const mail = await PostalMime.parse(source, {
    maxNestingDepth: 20,
    maxPartCount: 100,
    maxHeadersSize: 32768,
    forceRfc822Attachments: true,
  });
  // HTML is never rendered. The reader receives only plain text, with no
  // image requests, tracking pixels or executable email markup.
  const body = (
    mail.text ||
    mail.html
      ?.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ") ||
    ""
  ).slice(0, 20000);
  return {
    ...meta,
    sender: (mail.from?.address || "").slice(0, 254),
    recipient: (
      mail.to
        ?.map((t) => ("address" in t ? t.address : ""))
        .filter(Boolean)
        .join(", ") || ""
    ).slice(0, 1000),
    subject: (mail.subject || "(No subject)").slice(0, 200),
    body,
  };
}
export const realMailTransport: MailTransport = {
  page: (account,path,before,expectedValidity)=>session(account,async client=>{
    const lock=await client.getMailboxLock(path,{readOnly:true});
    try{
      if(!client.mailbox)throw new MailboxError(404,"Mailbox folder unavailable.");
      const validity=String(client.mailbox.uidValidity),total=client.mailbox.exists;
      if(validity!==expectedValidity)throw new MailboxError(409,"Mailbox changed. Refresh this folder to reload its messages.");
      const found=before>1?await client.search({uid:`1:${before-1}`},{uid:true}):[];
      const uids=(found||[]).filter(uid=>uid<before).sort((a,b)=>a-b),batch=uids.slice(-100);
      const metadata=batch.length?await client.fetchAll(batch.join(","),{uid:true,flags:true,internalDate:true,envelope:true},{uid:true}):[];
      return {validity,total,hasMore:uids.length>batch.length,messages:metadata.map(m=>({uid:m.uid,uidValidity:validity,sender:m.envelope?.from?.[0]?.address||"",recipient:(m.envelope?.to||[]).map(a=>a.address||"").join(", ").slice(0,1000),subject:m.envelope?.subject?.slice(0,200)||"(No subject)",body:"",receivedAt:m.internalDate instanceof Date?m.internalDate.getTime():Date.now(),isRead:m.flags?.has("\\Seen")||false,truncated:false,headersOnly:true}))};
    }finally{lock.release();}
  }),
  metadata: (account, uid, validity, path) => withMessage(account, uid, validity, async (_client, structure) => mailParts(structure).attachments, path),
  folders: (account) =>
    session(account, async (client) => {
      const list = await client.list();
      const result: RemoteFolder[] = [];
      for (const kind of ["sent", "drafts"] as const) {
        const path = chooseMailFolder(list, kind);
        if (!path) continue;
        const lock = await client.getMailboxLock(path, { readOnly: true });
        try {
          if (!client.mailbox) continue;
          const total = client.mailbox.exists,
            validity = String(client.mailbox.uidValidity);
          const metadata = total
            ? await client.fetchAll(`${Math.max(1, total - 39)}:*`, {
                uid: true,
                flags: true,
                internalDate: true,
                envelope: true,
              })
            : [];
          result.push({
            kind,
            path,
            total,
            validity,
            messages: metadata.map((m) => ({
              uid: m.uid,
              uidValidity: validity,
              sender: m.envelope?.from?.[0]?.address || account.address,
              recipient: (m.envelope?.to || [])
                .map((a) => a.address || "")
                .join(", ")
                .slice(0, 1000),
              subject: m.envelope?.subject?.slice(0, 200) || "(No subject)",
              body: "",
              receivedAt:
                m.internalDate instanceof Date
                  ? m.internalDate.getTime()
                  : Date.now(),
              isRead: m.flags?.has("\\Seen") || false,
              truncated: false,
            })),
          });
        } finally {
          lock.release();
        }
      }
      return result;
    }),
  verify: (account) => session(account, async () => {}),
  fetch: (account, cachedUids = [], cachedValidity = "") =>
    session(account, async (client) => {
      const lock = await client.getMailboxLock("INBOX", { readOnly: true });
      try {
        if (!client.mailbox) return { validity: "", messages: [], total:0 };
        const validity = String(client.mailbox.uidValidity),
          exists = client.mailbox.exists;
        if (!exists) return { validity, messages: [], total:0 };
        const metadata = await client.fetchAll(
          `${Math.max(1, exists - 39)}:*`,
          {
            uid: true,
            flags: true,
            internalDate: true,
            size: true,
            envelope: true,
          },
        );
        const messages: Incoming[] = [];
        for (const m of metadata) {
          const meta = {
            uid: m.uid,
            uidValidity: validity,
            receivedAt:
              m.internalDate instanceof Date
                ? m.internalDate.getTime()
                : Date.now(),
            isRead: m.flags?.has("\\Seen") || false,
            truncated: false,
          };
          const base = {
            ...meta,
            sender: m.envelope?.from?.[0]?.address || "",
            recipient: account.address,
            subject: m.envelope?.subject?.slice(0, 200) || "(No subject)",
          };
          messages.push({
            ...base,
            body: "",
            headersOnly:true,
            truncated: !(
              cachedValidity === validity && cachedUids.includes(m.uid)
            ),
          });
        }
        return { validity, messages, total:exists };
      } finally {
        lock.release();
      }
    }),
  detail: (a, uid, validity, path = "INBOX") =>
    withMessage(
      a,
      uid,
      validity,
      async (client, structure, envelope) => ({...await bodyDetail(client, uid, structure),subject:envelope?.subject||"",sender:envelope?.from?.[0]?.address||""}),
      path,
    ),
  attachment: (a, uid, validity, part, path = "INBOX") =>
    withMessage(
      a,
      uid,
      validity,
      async (client, structure) => {
        const file = mailParts(structure).attachments.find(
          (f) => f.part === part,
        );
        if (!file) throw new MailboxError(404, "Attachment not found.");
        if (file.size > 35_000_000)
          throw new MailboxError(
            413,
            "This attachment exceeds the 25 MB download limit.",
          );
        const result = await downloadPart(client, uid, part, 25 * 1024 * 1024);
        return { bytes: result.bytes, file };
      },
      path,
    ),
  seen: (account, uid, validity, read) =>
    session(account, async (client) => {
      const lock = await client.getMailboxLock("INBOX");
      try {
        if (!client.mailbox || String(client.mailbox.uidValidity) !== validity)
          throw new MailboxError(
            409,
            "This inbox changed. Sync again before updating this message.",
          );
        if (read) await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        else await client.messageFlagsRemove(uid, ["\\Seen"], { uid: true });
      } finally {
        lock.release();
      }
    }),
  send: async (account, message) => {
    const smtp: SmtpAccount = {
      host: account.host,
      username: account.address,
      password: account.password,
      from: account.address,
      replyTo: account.address,
    };
    return submitSmtp(smtp, message);
  },
};
