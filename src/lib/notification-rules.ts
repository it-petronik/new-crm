import { isCashEntry } from "./cashbook";
import { canApprove, canRead, canWrite, type Actor, type Kind, type RecordItem } from "./domain";
import type { NotificationCategory, NotificationPriority } from "./notification-types";

/**
 * Which business events notify whom. Pure functions: given what changed and
 * who exists, they return notification drafts, so the rules can be read and
 * tested in one place and the API routes only persist and deliver.
 *
 * Deliberately restrained: ordinary edits notify nobody. A notification is
 * created only when there is a clear recipient who has something to do or
 * would clearly want to know — and never for the person's own action.
 *
 * Every draft is later filtered by `authorised` (the recipient must be able
 * to read the record right now), so a rule can never leak a record to
 * someone outside their scope. Bodies carry a record's title and product,
 * never amounts or other financial detail.
 */

export type Person = Actor & { active: boolean };

export type NotificationDraft = {
  recipientId: string;
  actorId: string | null;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  conversationId?: string | null;
  messageId?: string | null;
  priority: NotificationPriority;
  dedupeKey: string;
};

const NOUN: Record<Kind, string> = {
  leads: "lead",
  quotations: "quotation",
  orders: "order",
  logistics: "shipment",
  accounts: "invoice",
  customers: "customer",
  suppliers: "supplier",
  products: "product",
  hr: "employee record",
  marketing: "campaign",
  it: "ticket",
  leave: "leave request",
};
const noun = (r: RecordItem) => (isCashEntry(r) ? "cashbook entry" : NOUN[r.kind]);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "ABC Trading · Base Oil SN500" — what the record is, never what it is worth. */
export const describe = (r: RecordItem) => [r.title, r.product].filter((s) => s?.trim()).join(" · ");

/** Ticket or lead priority from its attributes, restrained: most are normal. */
function recordPriority(r: RecordItem): NotificationPriority {
  const p = (r.attributes?.priority || "").toLowerCase();
  if (r.kind === "it" && ["urgent", "critical"].includes(p)) return "urgent";
  if (["high", "urgent", "critical"].includes(p)) return "important";
  return "normal";
}

const base = (r: RecordItem, actor: Actor | null) => ({
  actorId: actor?.id ?? null,
  entityType: r.kind,
  entityId: r.id,
});

const approvers = (people: Person[], r: RecordItem) =>
  people.filter((p) => p.active && canApprove(p, r));

/** People whose role works this kind of record and who may act on it. */
const team = (people: Person[], r: RecordItem, role: (p: Person) => boolean) =>
  people.filter((p) => p.active && role(p) && canWrite(p, r));
const logisticsTeam = (people: Person[], r: RecordItem) => team(people, r, (p) => p.role.startsWith("Logistics"));
const accountsTeam = (people: Person[], r: RecordItem) =>
  team(people, r, (p) => p.role === "Accounts Manager" || p.role === "Accountant");
const itTeam = (people: Person[], r: RecordItem) => team(people, r, (p) => p.role === "IT Administrator");

/**
 * Who may be given ownership of a record: an active person who could read it
 * once it is theirs (company, branch and module access all apply).
 */
export function mayOwn(person: Person, r: RecordItem) {
  return person.active && canRead(person, { ...r, ownerId: person.id });
}

/**
 * Drafts for one record change made through the records API.
 * `before` is absent for a creation; `created` are records the change
 * produced (an accepted quotation's order, shipment and invoice).
 */
export function recordChangeDrafts(input: {
  before?: RecordItem;
  after: RecordItem;
  actor: Actor;
  version: number;
  people: Person[];
  created?: RecordItem[];
}): NotificationDraft[] {
  const { before, after: r, actor, version, people, created = [] } = input;
  const drafts: NotificationDraft[] = [];
  const add = (recipients: (Person | string | undefined)[], draft: Omit<NotificationDraft, "recipientId" | "dedupeKey">, key: (id: string) => string) => {
    for (const recipient of recipients) {
      const id = typeof recipient === "string" ? recipient : recipient?.id;
      if (id) drafts.push({ ...draft, recipientId: id, dedupeKey: key(id) });
    }
  };
  const what = describe(r);

  /* ------------------------------------------------------------ created */
  if (!before) {
    if (r.kind === "leave" && r.status === "Pending Approval")
      add(approvers(people, r), {
        ...base(r, actor), type: "approval.requested", category: "approval", priority: "important",
        title: "Leave approval required", body: `${actor.name} · ${what}`,
      }, () => `approval:${r.id}:${version}`);
    if (r.kind === "it")
      add(itTeam(people, r), {
        ...base(r, actor), type: "ticket.created", category: "assignment", priority: recordPriority(r),
        title: recordPriority(r) === "urgent" ? "Urgent support ticket" : "New support ticket",
        body: `${actor.name} · ${what}`,
      }, () => `ticket:${r.id}`);
    return drafts;
  }

  /* --------------------------------------------------------- assignment */
  if (before.ownerId !== r.ownerId) {
    const priority = recordPriority(r);
    add([r.ownerId], {
      ...base(r, actor), type: "record.assigned", category: "assignment", priority,
      title: priority !== "normal" && r.kind === "leads" ? "High-priority lead assigned to you" : `New ${noun(r)} assigned to you`,
      body: `${what} · Assigned by ${actor.name}`,
    }, (id) => `assigned:${r.id}:${id}:${version}`);
    add([before.ownerId], {
      ...base(r, actor), type: "record.reassigned", category: "assignment", priority: "normal",
      title: `${capital(noun(r))} reassigned`, body: `${what} · Now with ${r.owner}`,
    }, (id) => `unassigned:${r.id}:${id}:${version}`);
  }

  /* -------------------------------------------------------- status change */
  if (before.status !== r.status) {
    const s = r.status;
    const key = (id: string) => `status:${r.id}:${s}:${id}:${version}`;
    const toOwner = (title: string, type: string, category: NotificationCategory = "update", priority: NotificationPriority = "normal") =>
      add([r.ownerId], { ...base(r, actor), type, category, priority, title, body: `${what} · by ${actor.name}` }, key);

    if (r.kind === "quotations") {
      if (s === "Pending Approval")
        add(approvers(people, r), {
          ...base(r, actor), type: "approval.requested", category: "approval", priority: "important",
          title: "Quotation approval required", body: `${actor.name} · ${what}`,
        }, () => `approval:${r.id}:${version}`);
      if (before.status === "Pending Approval" && (s === "Approved" || s === "Rejected"))
        toOwner(s === "Approved" ? "Your quotation was approved" : "Your quotation was rejected", `approval.${s.toLowerCase()}`, "approval", s === "Rejected" ? "important" : "normal");
      if (s === "Accepted") {
        for (const c of created) {
          if (c.kind === "logistics")
            add(logisticsTeam(people, c), {
              ...base(c, actor), type: "shipment.to_plan", category: "assignment", priority: "important",
              title: "New shipment to plan", body: describe(c),
            }, (id) => `created:${c.id}:${id}`);
          if (c.kind === "accounts")
            add(accountsTeam(people, c), {
              ...base(c, actor), type: "invoice.to_issue", category: "assignment", priority: "normal",
              title: "Invoice ready to issue", body: describe(c),
            }, (id) => `created:${c.id}:${id}`);
          if (c.kind === "orders")
            add([c.ownerId], {
              ...base(c, actor), type: "order.created", category: "update", priority: "normal",
              title: "Quotation accepted — order created", body: describe(c),
            }, (id) => `created:${c.id}:${id}`);
        }
      }
    }
    if (r.kind === "leave" && before.status === "Pending Approval" && (s === "Approved" || s === "Rejected"))
      toOwner(s === "Approved" ? "Your leave request was approved" : "Your leave request was rejected", `approval.${s.toLowerCase()}`, "approval");
    if (r.kind === "leads" && ["Negotiation", "Won", "Lost", "On Hold"].includes(s))
      toOwner(`Lead marked ${s}`, "lead.status");
    if (r.kind === "orders")
      toOwner(`Order ${s.toLowerCase()}`, "order.status", "update", s === "Cancelled" ? "important" : "normal");
    if (r.kind === "logistics") {
      if (s === "Delayed")
        add([r.ownerId, ...logisticsTeam(people, r)], {
          ...base(r, actor), type: "shipment.delayed", category: "update", priority: "important",
          title: "Shipment delayed", body: `${what} · by ${actor.name}`,
        }, key);
      else if (s === "Documents Pending")
        add(logisticsTeam(people, r), {
          ...base(r, actor), type: "shipment.documents", category: "update", priority: "normal",
          title: "Shipment documents required", body: what,
        }, key);
      else toOwner(`Shipment ${s.toLowerCase()}`, "shipment.status");
    }
    if (r.kind === "accounts" && !isCashEntry(r)) {
      if (s === "Overdue")
        add([r.ownerId, ...accountsTeam(people, r)], {
          ...base(r, actor), type: "payment.overdue", category: "update", priority: "important",
          title: "Payment overdue", body: what,
        }, key);
      else if (s === "Paid") toOwner("Invoice paid", "invoice.paid");
      else if (s === "Sent") toOwner("Invoice sent to the customer", "invoice.sent");
    }
    if (r.kind === "it") toOwner(`Your ticket is ${s.toLowerCase()}`, "ticket.status");
  }

  /* ---------------------------------------------- follow-up set by another */
  if (before.due !== r.due && ["leads", "quotations", "customers"].includes(r.kind) && before.status === r.status)
    add([r.ownerId], {
      ...base(r, actor), type: "followup.assigned", category: "reminder", priority: "normal",
      title: "Follow-up scheduled for you", body: `${what} · due ${r.due}`,
    }, (id) => `followup-set:${r.id}:${r.due}:${id}:${version}`);

  /* ------------------------------------------------ payment by someone else */
  if ((before.payments?.length ?? 0) < (r.payments?.length ?? 0) && r.status !== "Paid")
    add([r.ownerId], {
      ...base(r, actor), type: "payment.recorded", category: "update", priority: "normal",
      title: "Payment recorded", body: `${what} · by ${actor.name}`,
    }, (id) => `payment:${r.id}:${r.payments?.length}:${id}`);

  return drafts;
}

/**
 * Time-based reminders, produced by the scheduled job from current records.
 * Each carries an occurrence key that includes the date it is about, so a
 * rerun the same day (or a retried run) adds nothing, while moving a
 * follow-up to a new date earns a fresh reminder.
 */
export function reminderDrafts(records: RecordItem[], people: Person[], today: string, soon: string): NotificationDraft[] {
  const drafts: NotificationDraft[] = [];
  const push = (recipients: (Person | string)[], r: RecordItem, d: Omit<NotificationDraft, "recipientId" | "dedupeKey" | "actorId" | "entityType" | "entityId">, key: string) => {
    for (const recipient of new Set(recipients.map((p) => (typeof p === "string" ? p : p.id))))
      drafts.push({ ...d, actorId: null, entityType: r.kind, entityId: r.id, recipientId: recipient, dedupeKey: `${key}:${recipient}` });
  };
  for (const r of records) {
    if (r.deletedAt || !r.due) continue;
    const what = describe(r);
    if (r.kind === "leads" && !["Won", "Lost", "On Hold"].includes(r.status)) {
      if (r.due === today)
        push([r.ownerId], r, { type: "followup.due", category: "reminder", priority: "normal", title: "Follow-up due today", body: what }, `followup-due:${r.id}:${r.due}`);
      else if (r.due < today)
        push([r.ownerId], r, { type: "followup.overdue", category: "reminder", priority: "important", title: "Follow-up overdue", body: `${what} · was due ${r.due}` }, `followup-overdue:${r.id}:${r.due}`);
    }
    if (r.kind === "quotations" && ["Approved", "Sent"].includes(r.status) && r.due >= today && r.due <= soon)
      push([r.ownerId], r, { type: "quotation.expiring", category: "reminder", priority: "normal", title: r.due === today ? "Quotation expires today" : "Quotation expiring soon", body: `${what} · valid until ${r.due}` }, `quote-expiring:${r.id}:${r.due}`);
    if (r.kind === "accounts" && !isCashEntry(r) && ["Sent", "Partially Paid"].includes(r.status) && r.due < today)
      push([r.ownerId, ...accountsTeam(people, r)], r, { type: "payment.overdue", category: "reminder", priority: "important", title: "Payment overdue", body: `${what} · was due ${r.due}` }, `payment-overdue:${r.id}:${r.due}`);
    if (r.kind === "logistics" && !["Delivered", "Cancelled"].includes(r.status) && r.due < today)
      push([r.ownerId, ...logisticsTeam(people, r)], r, { type: "shipment.delayed", category: "reminder", priority: "important", title: "Shipment past its date", body: `${what} · was due ${r.due}` }, `shipment-late:${r.id}:${r.due}`);
    if (r.kind === "it" && ["Open", "In Progress"].includes(r.status) && r.due < today)
      push(itTeam(people, r), r, { type: "ticket.overdue", category: "reminder", priority: "normal", title: "Support ticket overdue", body: `${what} · was due ${r.due}` }, `ticket-late:${r.id}:${r.due}`);
  }
  return drafts;
}

/**
 * The final gate every record draft passes: an active recipient who is not
 * the person acting, and who may read the record right now. Duplicate
 * drafts for one recipient collapse to the first.
 */
export function authorised(drafts: NotificationDraft[], people: Person[], records: Map<string, RecordItem>) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const seen = new Set<string>();
  return drafts.filter((d) => {
    const person = byId.get(d.recipientId);
    const record = records.get(d.entityId);
    if (!person?.active || d.recipientId === d.actorId || !record || !canRead(person, record)) return false;
    const key = `${d.recipientId}:${d.entityId}:${d.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
