import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";
import { currentActor, checkOrigin } from "@/lib/auth";
import { isPreview } from "@/lib/db";
import { isLocalMailSandbox, mailAction } from "@/lib/mail/model";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function run(request: Request, write: boolean) {
  if (isPreview()) return json({ error: "Open the local test workspace to try email with a signed-in account." }, 409);
  if (write) {
    try { checkOrigin(request); } catch { return json({ error: "Invalid request origin." }, 403); }
  }
  const actor = await currentActor();
  if (!actor) return json({ error: "Sign in required." }, 401);
  const { env } = await getCloudflareContext({ async: true });
  const config = env as unknown as { MAIL_MODE?: string; APP_URL?: string; DB: D1Database };
  if (!isLocalMailSandbox(config.MAIL_MODE, config.APP_URL))
    return json({ mode: "disconnected", messages: [], error: write ? "No mailbox is connected. Nothing was sent." : undefined }, write ? 409 : 200);

  // Every query includes the session owner, even for an MD or administrator.
  // This local-only table is installed by the isolated review fixture, not by
  // production migration. No IMAP/SMTP network transport is invoked here.
  const db = config.DB;
  if (!write) {
    const result = await db.prepare('SELECT id, recipient AS "to", subject, body, folder, sender, updatedAt FROM MailSandbox WHERE ownerId = ? ORDER BY updatedAt DESC LIMIT 200').bind(actor.id).all();
    return json({ mode: "sandbox", mailbox: `${actor.id}@example.invalid`, messages: result.results, limit: 200 });
  }
  const raw = await request.text();
  if (raw.length > 24000) return json({ error: "Message is too long." }, 413);
  let body;
  try { body = mailAction.parse(JSON.parse(raw)); } catch { return json({ error: "Enter a valid recipient, subject and message; confirm test sending." }, 400); }
  const folder = body.action === "save" ? "drafts" : "outbox";
  const sender = `${actor.id}@example.invalid`;
  // Sent captures are immutable. A retry with the same draft ID cannot create
  // a second capture or turn a captured message back into a draft.
  await db.prepare(`INSERT INTO MailSandbox (ownerId,id,recipient,subject,body,folder,sender,updatedAt)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(ownerId,id) DO UPDATE SET recipient=excluded.recipient,
    subject=excluded.subject,body=excluded.body,folder=excluded.folder,updatedAt=excluded.updatedAt
    WHERE MailSandbox.folder='drafts'`).bind(actor.id, body.id, body.to, body.subject, body.body, folder, sender, Date.now()).run();
  return json({ ok: true, delivery: folder === "outbox" ? "captured-locally-not-delivered" : "draft" });
}
async function safe(request: Request, write: boolean) {
  try { return await run(request, write); }
  catch { return json({ error: "Email is unavailable. No delivery is confirmed." }, 503); }
}
export const GET = (request: Request) => safe(request, false);
export const POST = (request: Request) => safe(request, true);
