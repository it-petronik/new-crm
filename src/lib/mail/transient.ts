import { z } from "zod";
import { findConnection, mailboxTransport, type MailboxEnv } from "./mailbox";
import { MailboxError, openPassword } from "./credentials";
import { mailReference, resolveMailReference } from "./reference";
import { classifyBuyer } from "./buyer";
import type { Incoming, MailTransport } from "./imap";
type Connection = NonNullable<Awaited<ReturnType<typeof findConnection>>>;
const safe = (c: Connection) => ({
  address: c.address,
  host: c.host,
  lastSyncAt: c.lastSyncAt,
  lastError: c.lastError,
  version: c.version,
});
async function account(env: MailboxEnv, c: Connection) {
  return {
    host: c.host,
    address: c.address,
    password: await openPassword(
      c.passwordSeal,
      env.MAILBOX_ENCRYPTION_KEY,
      c.ownerId,
      c.id,
    ),
  };
}
async function rows(
  env: MailboxEnv,
  c: Connection,
  messages: Incoming[],
  path: string,
  validity: string,
  folder: "inbox" | "drafts" | "outbox",
) {
  return Promise.all(
    messages.slice(-100).map(async (m) => ({
      uid: m.uid,
      id: await mailReference(env.MAILBOX_ENCRYPTION_KEY, c.ownerId, c.id, {
        uid: m.uid,
        uidValidity: validity,
        path,
      }),
      sender: m.sender,
      to: m.recipient,
      subject: m.subject,
      body: m.body.slice(0, 4000),
      updatedAt: m.receivedAt,
      isRead: Number(m.isRead),
      truncated: Number(m.truncated),
      folder,
      remote: folder === "inbox" ? undefined : 1,
      candidate:
        folder === "inbox"
          ? Number(
              classifyBuyer(m.sender, m.subject, m.body, m.truncated).candidate,
            )
          : 0,
      candidateReason:
        folder === "inbox"
          ? classifyBuyer(m.sender, m.subject, m.body, m.truncated).reason
          : undefined,
    })),
  );
}
/** Sync responses are transient. Only operational connection metadata is persisted. */
export async function mailboxPage(env:MailboxEnv,ownerId:string,input:unknown,transport?:MailTransport){
  const {cursor,folder}=z.object({cursor:z.string().min(1).max(2048),folder:z.enum(["inbox","outbox","drafts"])}).strict().parse(input);
  const c=await findConnection(env.DB,ownerId);if(!c)throw new MailboxError(404,"Mailbox unavailable.");
  const ref=await resolveMailReference(env.MAILBOX_ENCRYPTION_KEY,ownerId,c.id,cursor);
  if((folder==="inbox")!==(ref.path==="INBOX"))throw new MailboxError(400,"Invalid mailbox folder.");
  const t=transport||mailboxTransport(env,c.address);if(!t.page)throw new MailboxError(503,"Older messages unavailable. Please retry.");
  const page=await t.page(await account(env,c),ref.path,ref.uid,ref.uidValidity);
  if(page.validity!==ref.uidValidity)throw new MailboxError(409,"Mailbox changed. Refresh this folder.");
  return {messages:await rows(env,c,page.messages.filter(m=>m.uid<ref.uid),ref.path,page.validity,folder),total:page.total,hasMore:page.hasMore};
}
export async function syncMailbox(
  env: MailboxEnv,
  ownerId: string,
  transport?: MailTransport,
  force = false,
) {
  const c = await findConnection(env.DB, ownerId);
  if (!c) throw new MailboxError(409, "Connect your email first.");
  const now = Date.now(),
    lease = crypto.randomUUID();
  if (!force && c.lastError?.startsWith("Mailbox sign-in failed"))
    return { synced: false };
  if (!force && c.lastError && c.lastAttemptAt && now - c.lastAttemptAt < 5000)
    return { synced: false };
  const claim = await env.DB.prepare(
    "UPDATE MailboxConnection SET syncLease=?,syncLeaseAt=?,lastAttemptAt=? WHERE ownerId=? AND id=? AND (syncLease IS NULL OR syncLeaseAt<?) AND (lastAttemptAt IS NULL OR lastAttemptAt<?)",
  )
    .bind(
      lease,
      now,
      now,
      ownerId,
      c.id,
      now - 120000,
      now - (force ? 0 : 4000),
    )
    .run();
  // Private previews cannot be shared between tabs. A bootstrap/manual read
  // must return headers even while another tab owns the metadata lease.
  if (claim.meta.changes !== 1 && !force) return { synced: false };
  try {
    const result = await (transport || mailboxTransport(env, c.address)).fetch(
      await account(env, c),
    );
    const messages = await rows(
      env,
      c,
      result.messages,
      "INBOX",
      result.validity,
      "inbox",
    );
    const done = await env.DB.prepare(
      "UPDATE MailboxConnection SET uidValidity=?,lastSyncAt=?,folderState=json_set(folderState,'$.inbox',json(?)),lastError=NULL,syncLease=NULL,syncLeaseAt=NULL WHERE ownerId=? AND id=? AND syncLease=?",
    )
      .bind(
        result.validity,
        Date.now(),
        JSON.stringify({
          total: result.total ?? messages.length,
          available: true,
        }),
        ownerId,
        c.id,
        lease,
      )
      .run();
    if (done.meta.changes !== 1) {
      const current=await findConnection(env.DB,ownerId);
      if(!current||current.id!==c.id||current.passwordSeal!==c.passwordSeal)
        throw new MailboxError(409,"Mailbox connection changed. Reload the connection.");
    }
    return {
      synced: true,
      kind: "inbox",
      count: messages.length,
      total: result.total ?? messages.length,
      messages,
    };
  } catch (error) {
    const auth = error instanceof MailboxError && error.status === 403;
    await env.DB.prepare(
      "UPDATE MailboxConnection SET lastError=?,syncLease=NULL,syncLeaseAt=NULL WHERE ownerId=? AND id=? AND syncLease=?",
    )
      .bind(
        auth
          ? "Mailbox sign-in failed. Reconnect with your updated mailbox password."
          : "Sync failed. Retry without reconnecting.",
        ownerId,
        c.id,
        lease,
      )
      .run();
    throw new MailboxError(
      auth ? 403 : 502,
      auth
        ? "Mailbox sign-in failed. Reconnect with your updated mailbox password."
        : "Inbox sync failed. Your open tab's temporary previews remain available; retry the connection.",
    );
  }
}
export async function readMailboxMessage(
  env: MailboxEnv,
  ownerId: string,
  id: string,
  part?: string,
  transport?: MailTransport,
  metadataOnly = false,
) {
  const c = await findConnection(env.DB, ownerId);
  if (!c) throw new MailboxError(404, "Email not found.");
  const ref = await resolveMailReference(
      env.MAILBOX_ENCRYPTION_KEY,
      ownerId,
      c.id,
      id,
    ),
    t = transport || mailboxTransport(env, c.address),
    a = await account(env, c);
  if (metadataOnly)
    return {
      body: "",
      truncated: false,
      attachments: t.metadata
        ? await t.metadata(a, ref.uid, ref.uidValidity, ref.path)
        : [],
    };
  if (part) {
    if (!t.attachment) throw new MailboxError(503, "Attachments unavailable.");
    return t.attachment(a, ref.uid, ref.uidValidity, part, ref.path);
  }
  if (!t.detail) throw new MailboxError(503, "Email content unavailable.");
  return t.detail(a, ref.uid, ref.uidValidity, ref.path);
}
export async function syncMailboxFolders(
  env: MailboxEnv,
  ownerId: string,
  transport?: MailTransport,
) {
  const c = await findConnection(env.DB, ownerId);
  if (!c) throw new MailboxError(409, "Connect your email first.");
  if (c.lastError?.startsWith("Mailbox sign-in failed"))
    throw new MailboxError(403, c.lastError);
  const now = Date.now();
  const claim = await env.DB.prepare(
    "UPDATE MailboxConnection SET folderLeaseAt=? WHERE ownerId=? AND id=? AND (folderLeaseAt IS NULL OR folderLeaseAt<?)",
  )
    .bind(now, ownerId, c.id, now - 60000)
    .run();
  try {
    const t = transport || mailboxTransport(env, c.address);
    if (!t.folders) throw new MailboxError(503, "Mailbox folders unavailable.");
    const result = await t.folders(await account(env, c));
    const folders: Record<string, any> = { syncedAt: now };
    const messages = [];
    for (const kind of ["sent", "drafts"] as const) {
      const f = result.find((x) => x.kind === kind);
      folders[kind] = { total: f?.total || 0, available: Boolean(f) };
      if (f)
        messages.push(
          ...(await rows(
            env,
            c,
            f.messages,
            f.path,
            f.validity,
            kind === "sent" ? "outbox" : "drafts",
          )),
        );
    }
    const done = await env.DB.prepare(
      "UPDATE MailboxConnection SET folderState=json_set(folderState,'$.sent',json(?),'$.drafts',json(?),'$.syncedAt',?),folderLeaseAt=NULL WHERE id=? AND ownerId=? AND folderLeaseAt=?",
    )
      .bind(
        JSON.stringify(folders.sent),
        JSON.stringify(folders.drafts),
        now,
        c.id,
        ownerId,
        now,
      )
      .run();
    if(done.meta.changes!==1){const current=await findConnection(env.DB,ownerId);if(!current||current.id!==c.id||current.passwordSeal!==c.passwordSeal)throw new MailboxError(409,"Mailbox connection changed.");}
    return { synced: true, kind: "folders", messages, folders };
  } catch {
    await env.DB.prepare(
      "UPDATE MailboxConnection SET folderLeaseAt=NULL WHERE id=? AND ownerId=? AND folderLeaseAt=?",
    )
      .bind(c.id, ownerId, now)
      .run();
    throw new MailboxError(
      502,
      "Could not load server folders. Retry without reconnecting.",
    );
  }
}
export async function mailboxView(env: MailboxEnv, ownerId: string) {
  const c = await findConnection(env.DB, ownerId);
  if (!c)
    return {
      connected: false,
      mode: "disconnected",
      messages: [],
      configured: Boolean(env.MAILBOX_ENCRYPTION_KEY),
      host: "mail.petronik.ae",
    };
  const drafts = await env.DB.prepare(
    "SELECT id,recipient AS \"to\",subject,body,status,version,updatedAt,CASE WHEN status='draft' THEN 'drafts' ELSE 'history' END AS folder FROM MailboxDraft WHERE ownerId=? AND connectionId=? ORDER BY updatedAt DESC LIMIT 100",
  )
    .bind(ownerId, c.id)
    .all();
  return {
    connected: true,
    mode: "connected",
    connection: safe(c),
    mailbox: c.address,
    messages: drafts.results.map((d) => ({ ...d, sender: c.address })),
    folders: JSON.parse(c.folderState || "{}"),
    storage: "temporary-browser-memory",
    limit: 40,
  };
}
export async function mailboxAction(
  env: MailboxEnv,
  ownerId: string,
  raw: unknown,
  transport?: MailTransport,
) {
  const input = z
    .discriminatedUnion("action", [
      z
        .object({ action: z.literal("disconnect"), confirmed: z.literal(true) })
        .strict(),
      z
        .object({ action: z.literal("sync"), manual: z.boolean().optional() })
        .strict(),
      z
        .object({
          action: z.literal("seen"),
          id: z.string().min(1).max(2048),
          read: z.boolean(),
        })
        .strict(),
    ])
    .parse(raw);
  if (input.action === "sync")
    return syncMailbox(env, ownerId, transport, input.manual === true);
  if (input.action === "disconnect") {
    await env.DB.prepare("DELETE FROM MailboxConnection WHERE ownerId=?")
      .bind(ownerId)
      .run();
    return { connected: false };
  }
  const c = await findConnection(env.DB, ownerId);
  if (!c) throw new MailboxError(409, "Connect your email first.");
  const ref = await resolveMailReference(
    env.MAILBOX_ENCRYPTION_KEY,
    ownerId,
    c.id,
    input.id,
  );
  if (ref.path !== "INBOX")
    throw new MailboxError(400, "Only inbox read flags are supported.");
  await (transport || mailboxTransport(env, c.address)).seen(
    await account(env, c),
    ref.uid,
    ref.uidValidity,
    input.read,
  );
  return { ok: true };
}
