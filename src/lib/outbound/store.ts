import type { D1Database } from "@cloudflare/workers-types";
import { canRead, type Actor, type RecordItem } from "../domain";
import {
  canCommunicate,
  canManageTemplates,
  command,
  OutboundError,
  recipient,
  type History,
  type Message,
  type Template,
} from "./model";
import { connections, prepareSubmission, type OutboundEnv } from "./transport";

const hidden = () =>
  new OutboundError(404, "This communication isn't available to you.");
async function linked(db: D1Database, actor: Actor, id: string, write = false) {
  const row = await db
    .prepare("SELECT payload FROM BusinessRecord WHERE id=?")
    .bind(id)
    .first<{ payload: string }>();
  const record = row && (JSON.parse(row.payload) as RecordItem | null);
  if (
    !record ||
    record.deletedAt ||
    !canRead(actor, record) ||
    (write && !canCommunicate(actor, record))
  )
    throw hidden();
  return record;
}
async function owned(db: D1Database, actor: Actor, id: string, write = false) {
  const m = await db
    .prepare("SELECT * FROM OutboundMessage WHERE id=? AND ownerId=?")
    .bind(id, actor.id)
    .first<Message>();
  if (!m) throw hidden();
  const record = await linked(db, actor, m.recordId, write);
  if (record.company !== m.company || record.branch !== m.branch)
    throw hidden();
  return { m, record };
}
const event = (db: D1Database, messageId: string, action: string, at: number) =>
  db
    .prepare(
      "INSERT INTO OutboundEvent(id,messageId,action,at) VALUES(?,?,?,?)",
    )
    .bind(crypto.randomUUID(), messageId, action, at);
/** Immutable event is inserted only if the optimistic update actually matched. */
async function update(
  db: D1Database,
  m: Message,
  values: {
    status: string;
    subject?: string;
    body?: string;
    scheduledAt?: number | null;
    providerId?: string | null;
    consent?: string;
  },
  action: string,
  now: number,
) {
  const batch = await db.batch([
    db
      .prepare(
        "UPDATE OutboundMessage SET status=?, subject=?, body=?, scheduledAt=?, providerId=?, consent=?, version=version+1, updatedAt=? WHERE id=? AND ownerId=? AND version=? AND status=?",
      )
      .bind(
        values.status,
        values.subject ?? m.subject,
        values.body ?? m.body,
        values.scheduledAt === undefined ? m.scheduledAt : values.scheduledAt,
        values.providerId ?? m.providerId,
        values.consent ?? m.consent,
        now,
        m.id,
        m.ownerId,
        m.version,
        m.status,
      ),
    db
      .prepare(
        "INSERT INTO OutboundEvent(id,messageId,action,at) SELECT ?,?,?,? WHERE changes()=1",
      )
      .bind(crypto.randomUUID(), m.id, action, now),
  ]);
  if (batch[0].meta.changes !== 1)
    throw new OutboundError(
      409,
      "This message changed. Refresh before continuing.",
    );
}
export async function outboundView(
  db: D1Database,
  actor: Actor,
  env: OutboundEnv,
  now = Date.now(),
) {
  const candidates = await db
    .prepare(
      "SELECT m.*, r.payload AS linkedPayload FROM OutboundMessage m JOIN BusinessRecord r ON r.id=m.recordId WHERE m.ownerId=? ORDER BY m.updatedAt DESC LIMIT 201",
    )
    .bind(actor.id)
    .all<Message & { linkedPayload: string }>();
  const messages: Message[] = [],
    history: History[] = [];
  for (const item of candidates.results.slice(0, 200)) {
    {
      const { linkedPayload, ...m } = item;
      const record = JSON.parse(linkedPayload) as RecordItem;
      if (
        record.deletedAt ||
        !canRead(actor, record) ||
        record.company !== m.company ||
        record.branch !== m.branch
      )
        continue;
      // Due is a presentation of scheduledAt; no GET side effect or external send.
      messages.push({
        ...m,
        status:
          m.status === "scheduled" && m.scheduledAt! <= now
            ? "ready"
            : m.status,
        recordTitle: record.title,
        canAct: canCommunicate(actor, record),
      });
    }
  }
  // Fetch bounded history only after the message's live record access check.
  for (let i = 0; i < messages.length; i += 80) {
    const ids = messages.slice(i, i + 80).map((m) => m.id);
    const events = await db
      .prepare(
        `SELECT * FROM OutboundEvent WHERE messageId IN (${ids.map(() => "?").join(",")}) ORDER BY at DESC LIMIT 500`,
      )
      .bind(...ids)
      .all<History>();
    history.push(...events.results);
  }
  const templates: Template[] = [];
  // Templates are shared with commercial communicators, not every employee.
  const templateCompanies = actor.companies.filter(
    (company) =>
      canManageTemplates(actor, company) ||
      [
        "MD Assistant",
        "Sales Executive",
        "Sales Manager",
        "Logistics Manager",
        "Logistics Executive",
        "Accounts Manager",
        "Accountant",
        "Group Manager",
        "Branch Manager",
        "MD",
        "IT Administrator",
        "Marketing Manager",
        "Marketing Executive",
      ].includes(actor.role),
  );
  for (const company of templateCompanies) {
    const rows = await db
      .prepare(
        "SELECT id,company,name,channel,subject,body,version,archived FROM CommunicationTemplate WHERE company=? AND archived=0 ORDER BY name LIMIT 100",
      )
      .bind(company)
      .all<Template>();
    templates.push(...rows.results);
  }
  return {
    messages,
    templates,
    history,
    connections: connections(env, actor.companies),
    manageCompanies: actor.companies.filter((c) =>
      canManageTemplates(actor, c),
    ),
    truncated: candidates.results.length > 200,
  };
}
export async function outboundCommand(
  db: D1Database,
  actor: Actor,
  raw: unknown,
  env: OutboundEnv,
  now = Date.now(),
  fetcher: typeof fetch = fetch,
) {
  const c = command.parse(raw);
  if (c.action === "template") {
    if (!canManageTemplates(actor, c.company))
      throw new OutboundError(
        403,
        "A company manager must manage shared templates.",
      );
    if (c.channel === "email" && !c.subject.trim())
      throw new OutboundError(400, "Email templates need a subject.");
    const prior = await db
      .prepare("SELECT * FROM CommunicationTemplate WHERE id=?")
      .bind(c.id)
      .first<Template & { createdBy: string }>();
    if (prior) {
      if (
        prior.createdBy !== actor.id ||
        prior.company !== c.company ||
        prior.name !== c.name ||
        prior.channel !== c.channel ||
        prior.subject !== c.subject ||
        prior.body !== c.body
      )
        throw new OutboundError(
          409,
          "Template ID already used. Create a new revision.",
        );
      return { id: prior.id, duplicate: true };
    }
    await db
      .prepare(
        "INSERT INTO CommunicationTemplate(id,company,name,channel,subject,body,createdBy,createdAt) VALUES(?,?,?,?,?,?,?,?)",
      )
      .bind(
        c.id,
        c.company,
        c.name,
        c.channel,
        c.subject,
        c.body,
        actor.id,
        now,
      )
      .run();
    return { id: c.id };
  }
  if (c.action === "archive-template") {
    const t = await db
      .prepare("SELECT * FROM CommunicationTemplate WHERE id=?")
      .bind(c.id)
      .first<Template>();
    if (!t || !canManageTemplates(actor, t.company)) throw hidden();
    const result = await db
      .prepare(
        "UPDATE CommunicationTemplate SET archived=1, version=version+1 WHERE id=? AND version=? AND archived=0",
      )
      .bind(t.id, c.version)
      .run();
    if (result.meta.changes !== 1)
      throw new OutboundError(409, "Template changed. Refresh first.");
    return { id: t.id };
  }
  if (c.action === "draft") {
    const record = await linked(db, actor, c.recordId, true),
      to = recipient(record, c.channel);
    if (c.channel === "email" && !c.subject)
      throw new OutboundError(400, "Email needs a subject.");
    if (/[{}]/.test(c.body))
      throw new OutboundError(400, "Replace template fields before saving.");
    if (c.templateId) {
      const t = await db
        .prepare(
          "SELECT * FROM CommunicationTemplate WHERE id=? AND archived=0",
        )
        .bind(c.templateId)
        .first<Template>();
      if (!t || t.company !== record.company || t.channel !== c.channel)
        throw hidden();
    }
    const prior = await db
      .prepare("SELECT * FROM OutboundMessage WHERE id=?")
      .bind(c.id)
      .first<Message>();
    if (prior) {
      await owned(db, actor, c.id, true);
      if (
        prior.ownerId !== actor.id ||
        prior.recordId !== c.recordId ||
        prior.channel !== c.channel ||
        prior.subject !== c.subject ||
        prior.body !== c.body ||
        prior.templateId !== c.templateId ||
        prior.recipient !== to
      )
        throw new OutboundError(
          409,
          "Draft ID already used. Refresh before creating another.",
        );
      return { id: c.id, duplicate: true };
    }
    await db.batch([
      db
        .prepare(
          "INSERT INTO OutboundMessage(id,ownerId,recordId,company,branch,channel,recipient,subject,body,templateId,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,'draft',?,?)",
        )
        .bind(
          c.id,
          actor.id,
          record.id,
          record.company,
          record.branch,
          c.channel,
          to,
          c.subject,
          c.body,
          c.templateId,
          now,
          now,
        ),
      event(db, c.id, "Draft saved", now),
    ]);
    return { id: c.id };
  }
  const { m, record } = await owned(db, actor, c.id, true);
  if (m.version !== c.version)
    throw new OutboundError(
      409,
      "This message changed. Refresh before continuing.",
    );
  if (!["draft", "scheduled", "ready"].includes(m.status))
    throw new OutboundError(
      409,
      "This message is locked. Never retry an uncertain submission; check the provider first.",
    );
  if (c.action === "edit") {
    if (m.channel === "email" && !c.subject)
      throw new OutboundError(400, "Email needs a subject.");
    await update(
      db,
      m,
      { status: "draft", subject: c.subject, body: c.body, scheduledAt: null },
      "Draft revised · review required",
      now,
    );
  } else if (c.action === "schedule") {
    if (c.at <= now || c.at > now + 90 * 86400000)
      throw new OutboundError(
        400,
        "Choose a review time within the next 90 days.",
      );
    await update(
      db,
      m,
      { status: "scheduled", scheduledAt: c.at },
      "Review scheduled · no automatic delivery",
      now,
    );
  } else if (c.action === "cancel") {
    await update(
      db,
      m,
      { status: "cancelled", scheduledAt: null },
      "Cancelled · not submitted",
      now,
    );
  } else if (c.action === "ready") {
    await update(
      db,
      m,
      { status: "ready", scheduledAt: null },
      "Marked ready for review",
      now,
    );
  } else if (c.action === "send") {
    if (
      m.status !== "ready" &&
      !(m.status === "scheduled" && m.scheduledAt! <= now)
    )
      throw new OutboundError(
        409,
        "Mark this draft ready and review it before sending.",
      );
    if (recipient(record, m.channel) !== m.recipient)
      throw new OutboundError(
        409,
        "The contact address changed. Cancel this draft and create a new one.",
      );
    if (m.channel === "whatsapp" && m.templateId) {
      const t = await db
        .prepare("SELECT archived FROM CommunicationTemplate WHERE id=?")
        .bind(m.templateId)
        .first<{ archived: number }>();
      if (!t || t.archived)
        throw new OutboundError(
          409,
          "This WhatsApp template was archived. Create a new draft using an active approved template.",
        );
    }
    const recent = await db
      .prepare(
        "SELECT count(*) AS n FROM OutboundMessage WHERE ownerId=? AND status IN ('sending','accepted','captured','uncertain','rejected') AND updatedAt>?",
      )
      .bind(actor.id, now - 3600000)
      .first<{ n: number }>();
    if ((recent?.n || 0) >= 20)
      throw new OutboundError(
        429,
        "Hourly safety limit reached (20 submissions). Review existing messages before sending more.",
      );
    if (/[{}]/.test(m.body) || /[\r\n]/.test(m.subject))
      throw new OutboundError(
        400,
        "Replace any unfilled fields before sending.",
      );
    const submit = prepareSubmission(env, m, record, actor, fetcher);
    // Atomic claim before network I/O. A crash leaves a locked 'sending' entry,
    // never an automatic retry (Meta cannot guarantee deduplication).
    if (m.status === "scheduled") {
      await update(
        db,
        m,
        { status: "ready", scheduledAt: null },
        "Scheduled review opened",
        now,
      );
      m.status = "ready";
      m.scheduledAt = null;
      m.version++;
    }
    await update(
      db,
      m,
      { status: "sending", consent: c.consent },
      "Recipient and permission confirmed · submission started",
      now,
    );
    m.status = "sending";
    m.consent = c.consent;
    m.version++;
    const result = await submit();
    await update(
      db,
      m,
      result,
      result.status === "accepted"
        ? "Provider accepted · delivery unconfirmed"
        : result.status === "captured"
          ? "Captured locally · not delivered"
          : result.status === "rejected"
            ? "Provider rejected · inspect before creating a replacement"
            : "Submission uncertain · check provider; do not resend",
      Date.now(),
    );
    return { id: m.id, status: result.status };
  }
  return { id: m.id };
}
