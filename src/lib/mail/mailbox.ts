import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import {
  MailboxError,
  connectMailboxInput,
  sealPassword,
  openPassword,
  permittedHost,
} from "./credentials";
import {
  realMailTransport,
  type MailAccount,
  type MailTransport,
} from "./imap";
import { isLocalMailSandbox, mailAction } from "./model";
export type MailboxEnv = {
  DB: D1Database;
  MAILBOX_ENCRYPTION_KEY?: string;
  MAILBOX_ALLOWED_HOSTS?: string;
  MAIL_MODE?: string;
  APP_URL?: string;
  MAILBOX_TEST?: { fetch(request: Request): Promise<Response> };
};
type Connection = {
  ownerId: string;
  id: string;
  address: string;
  host: string;
  passwordSeal: string;
  lastSyncAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  uidValidity: string;
  syncLease: string | null;
  version: number;
  folderState: string;
  folderLeaseAt: number | null;
};
export const findConnection = (db: D1Database, ownerId: string) =>
  db
    .prepare("SELECT * FROM MailboxConnection WHERE ownerId=?")
    .bind(ownerId)
    .first<Connection>();
const safe = (c: Connection) => ({
  address: c.address,
  host: c.host,
  lastSyncAt: c.lastSyncAt,
  lastError: c.lastError,
  version: c.version,
});
async function account(c: Connection, env: MailboxEnv): Promise<MailAccount> {
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
/** A bound local test service handles only fictional .invalid accounts. A real
 * address always uses the actual TLS adapter, even on localhost. */
export function mailboxTransport(
  env: MailboxEnv,
  address: string,
): MailTransport {
  if (
    !env.MAILBOX_TEST ||
    !isLocalMailSandbox(env.MAIL_MODE, env.APP_URL) ||
    !address.endsWith("@local-mail.invalid")
  )
    return realMailTransport;
  async function call(action: string, values: unknown) {
    const r = await env.MAILBOX_TEST!.fetch(
      new Request(`http://mailbox.invalid/${action}`, {
        method: "POST",
        body: JSON.stringify(values),
      }),
    );
    if (!r.ok) throw new MailboxError(502, "Test mailbox sign-in failed.");
    return r.json() as Promise<any>;
  }
  return {
    verify: (a) => call("verify", a),
    page: (a,path,before,validity) => call("page", {...a,path,before,validity}),
    fetch: (a) => call("fetch", a),
    seen: (a, uid, validity, read) =>
      call("seen", { ...a, uid, validity, read }),
    send: (a, message) => call("send", { ...a, message }),
    folders: (a) => call("folders", a),
    metadata: (a, uid, validity, path) => call("metadata", { ...a, uid, validity, path }),
    detail: (a, uid, validity, path) =>
      call("detail", { ...a, uid, validity, path }),
    attachment: async (a, uid, validity, part, path) => {
      const r = await call("attachment", { ...a, uid, validity, part, path });
      return {
        ...r,
        bytes: Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0)),
      };
    },
  };
}
export async function connectMailbox(
  env: MailboxEnv,
  ownerId: string,
  raw: unknown,
  transport?: MailTransport,
) {
  const input = connectMailboxInput.parse(raw),
    host = permittedHost(input.host, env.MAILBOX_ALLOWED_HOSTS),
    id = crypto.randomUUID(),
    now = Date.now();
  const prior = await findConnection(env.DB, ownerId);
  if (prior)
    throw new MailboxError(
      409,
      "Disconnect the current mailbox before connecting another.",
    );
  const seal = await sealPassword(
    input.password,
    env.MAILBOX_ENCRYPTION_KEY,
    ownerId,
    id,
  );
  await env.DB.prepare(
    "INSERT INTO MailboxConnectAttempt(ownerId,startedAt,attempts) VALUES(?,?,1) ON CONFLICT(ownerId) DO UPDATE SET attempts=CASE WHEN startedAt<? THEN 1 ELSE attempts+1 END,startedAt=CASE WHEN startedAt<? THEN excluded.startedAt ELSE startedAt END",
  )
    .bind(ownerId, now, now - 900000, now - 900000)
    .run();
  const attempt = await env.DB.prepare(
    "SELECT attempts FROM MailboxConnectAttempt WHERE ownerId=?",
  )
    .bind(ownerId)
    .first<{ attempts: number }>();
  if ((attempt?.attempts || 0) > 5)
    throw new MailboxError(
      429,
      "Too many connection attempts. Wait 15 minutes before trying again.",
    );
  await (transport || mailboxTransport(env, input.address)).verify({
    host,
    address: input.address,
    password: input.password,
  });
  await env.DB.prepare(
    "INSERT INTO MailboxConnection(ownerId,id,address,host,passwordSeal,createdAt) VALUES(?,?,?,?,?,?)",
  )
    .bind(ownerId, id, input.address.toLowerCase(), host, seal, now)
    .run();
  return { connected: true, address: input.address };
}
export { syncMailbox, readMailboxMessage, syncMailboxFolders, mailboxView, mailboxAction } from "./transient";
export async function saveMailboxDraft(
  env: MailboxEnv,
  ownerId: string,
  raw: unknown,
  transport?: MailTransport,
) {
  const input = mailAction.parse(raw),
    c = await findConnection(env.DB, ownerId);
  if (!c) throw new MailboxError(409, "Connect your email first.");
  if (input.action === "send-test")
    throw new MailboxError(400, "Review and confirm a connected-mailbox send.");
  const prior = await env.DB.prepare("SELECT * FROM MailboxDraft WHERE id=?")
    .bind(input.id)
    .first<{
      ownerId: string;
      connectionId: string;
      status: string;
      version: number;
      recipient: string;
      subject: string;
      body: string;
    }>();
  if (prior && (prior.ownerId !== ownerId || prior.connectionId !== c.id))
    throw new MailboxError(404, "Draft not found.");
  if (prior && prior.status !== "draft")
    throw new MailboxError(
      409,
      "This message was already submitted. Check history; do not send it again.",
    );
  if (prior && prior.version !== input.version)
    throw new MailboxError(
      409,
      "This draft changed. Refresh before continuing.",
    );
  const now = Date.now();
  if (input.action === "send") {
    const quota = await env.DB.prepare(
      "SELECT count(*) AS n FROM MailboxDraft WHERE ownerId=? AND status!='draft' AND updatedAt>?",
    )
      .bind(ownerId, now - 3600000)
      .first<{ n: number }>();
    if ((quota?.n || 0) >= 20)
      throw new MailboxError(
        429,
        "Hourly safety limit reached. Review your message history before sending more.",
      );
  }
  const status = input.action === "save" ? "draft" : "sending";
  if (prior) {
    const changed = await env.DB.prepare(
      "UPDATE MailboxDraft SET recipient=?,subject=?,body=?,status=?,version=version+1,updatedAt=? WHERE id=? AND ownerId=? AND connectionId=? AND status='draft' AND version=?",
    )
      .bind(
        input.to,
        input.subject,
        input.body,
        status,
        now,
        input.id,
        ownerId,
        c.id,
        prior.version,
      )
      .run();
    if (changed.meta.changes !== 1)
      throw new MailboxError(409, "This draft changed. Refresh first.");
  } else
    await env.DB.prepare(
      "INSERT INTO MailboxDraft(id,ownerId,connectionId,recipient,subject,body,status,updatedAt) VALUES(?,?,?,?,?,?,?,?)",
    )
      .bind(
        input.id,
        ownerId,
        c.id,
        input.to,
        input.subject,
        input.body,
        status,
        now,
      )
      .run();
  if (input.action === "save") return { ok: true, delivery: "draft" };
  // No automatic retry after a claim: SMTP does not deduplicate by Message-ID.
  let result: { status: string };
  try {
    result = await (transport || mailboxTransport(env, c.address)).send(
      await account(c, env),
      {
        id: input.id,
        recipient: input.to,
        subject: input.subject,
        body: input.body,
      },
    );
  } catch {
    result = { status: "uncertain" };
  }
  await env.DB.prepare(
    "UPDATE MailboxDraft SET status=?,updatedAt=? WHERE id=? AND ownerId=? AND connectionId=? AND status='sending'",
  )
    .bind(result.status, Date.now(), input.id, ownerId, c.id)
    .run();
  return { ok: true, delivery: result.status };
}
