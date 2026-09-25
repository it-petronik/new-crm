import { isCashEntry } from "./cashbook";
import {
  canWrite,
  canApprove,
  stages,
  outstanding,
  type Actor,
  type RecordItem,
  type Workspace,
} from "./domain";
export function transition(
  workspace: Workspace,
  actor: Actor,
  id: string,
  status: string,
): Workspace {
  const record = workspace.records.find((r) => r.id === id);
  if (!record || !canWrite(actor, record))
    throw new Error("You do not have permission to change this record.");
  if (!(isCashEntry(record) ? ["Recorded", "Cancelled"] : stages[record.kind]).includes(status)) throw new Error("Invalid status.");
  if (record.status === status) return workspace;
  if (record.kind === "accounts" && ["Paid", "Partially Paid"].includes(status))
    throw new Error("Record a payment to update the invoice balance.");
  if (
    record.kind === "accounts" &&
    record.payments?.length &&
    ["Draft", "Cancelled"].includes(status)
  )
    throw new Error("An invoice with payments needs an accounting adjustment.");
  if (record.kind === "leave" && record.status !== "Pending Approval")
    throw new Error("This leave decision has already been recorded.");
  if (
    record.kind === "quotations" &&
    ["Accepted", "Rejected", "Expired"].includes(record.status)
  )
    throw new Error(
      "Create a new quotation revision. This quotation is closed.",
    );
  if (
    record.kind === "quotations" &&
    ["Approved", "Rejected"].includes(status) &&
    (record.status !== "Pending Approval" || !canApprove(actor, record))
  )
    throw new Error(
      "A different authorised manager must review this quotation.",
    );
  if (
    record.kind === "leave" &&
    ["Approved", "Rejected"].includes(status) &&
    (record.status !== "Pending Approval" || !canApprove(actor, record))
  )
    throw new Error(
      "A different authorised approver must review this leave request.",
    );
  if (
    record.kind === "quotations" &&
    status === "Accepted" &&
    !["Approved", "Sent"].includes(record.status)
  )
    throw new Error("Approve the quotation before accepting it.");
  if (
    record.kind === "quotations" &&
    status === "Sent" &&
    record.status !== "Approved"
  )
    throw new Error("Approve the quotation before marking it sent.");
  if (
    record.kind === "quotations" &&
    ["Approved", "Sent", "Accepted"].includes(record.status) &&
    ["Draft", "Pending Approval"].includes(status)
  )
    throw new Error("Create a new quotation revision instead.");
  const now = new Date().toISOString();
  let records = workspace.records.map((r) =>
    r.id === id ? { ...r, status, updatedAt: now } : r,
  );
  if (record.kind === "quotations" && status === "Accepted") {
    const orderId = `${id}-SO`;
    if (!records.some((r) => r.id === orderId))
      records = [
        ...records,
        ...(["orders", "logistics", "accounts"] as const).map((kind, i) => ({
          ...record,
          id: i === 0 ? orderId : `${id}-${i === 1 ? "SHP" : "INV"}`,
          kind,
          status:
            i === 0 ? "Confirmed" : i === 1 ? "Pending Planning" : "Draft",
          parentId: i === 0 ? id : orderId,
          createdAt: now,
          updatedAt: now,
        })),
      ];
  }
  return {
    records,
    audit: [
      {
        id: crypto.randomUUID(),
        actor: actor.name,
        action: `${record.kind}: ${record.status} → ${status}`,
        recordId: id,
        company: record.company,
        at: now,
      },
      ...workspace.audit,
    ],
  };
}
export function addNote(
  workspace: Workspace,
  actor: Actor,
  id: string,
  text: string,
  due?: string,
): Workspace {
  const record = workspace.records.find((r) => r.id === id);
  if (!record || !canWrite(actor, record)) throw new Error("Access denied.");
  if (!text.trim() || text.length > 5000)
    throw new Error("Enter a note of 1–5000 characters.");
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due))
    throw new Error("Invalid follow-up date.");
  const at = new Date().toISOString();
  const note = {
    id: crypto.randomUUID(),
    text: text.trim(),
    at,
    actor: actor.name,
  };
  return {
    records: workspace.records.map((r) =>
      r.id === id
        ? {
            ...r,
            notes: [...(r.notes || []), note],
            ...(due ? { due } : {}),
            updatedAt: at,
          }
        : r,
    ),
    audit: [
      {
        id: crypto.randomUUID(),
        actor: actor.name,
        action: due ? "Logged activity and scheduled follow-up" : "Added note",
        recordId: id,
        company: record.company,
        at,
      },
      ...workspace.audit,
    ],
  };
}
export function recordPayment(
  workspace: Workspace,
  actor: Actor,
  id: string,
  amountCents: number,
  reference: string,
): Workspace {
  const record = workspace.records.find((r) => r.id === id);
  if (!record || !canWrite(actor, record) || record.kind !== "accounts")
    throw new Error("Access denied.");
  if (["Draft", "Cancelled", "Paid"].includes(record.status))
    throw new Error("Only issued, unpaid invoices can receive payments.");
  if (
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0 ||
    amountCents > Math.round(outstanding(record) * 100)
  )
    throw new Error("Payment must be positive and cannot exceed the balance.");
  if (!reference.trim() || reference.length > 160)
    throw new Error("Enter a payment reference.");
  if (record.payments?.some((p) => p.reference === reference.trim()))
    throw new Error("This payment reference has already been recorded.");
  const at = new Date().toISOString();
  const payment = {
    id: crypto.randomUUID(),
    amountCents,
    reference: reference.trim(),
    actor: actor.name,
    at,
  };
  const status =
    amountCents === Math.round(outstanding(record) * 100)
      ? "Paid"
      : "Partially Paid";
  return {
    records: workspace.records.map((r) =>
      r.id === id
        ? {
            ...r,
            payments: [...(r.payments || []), payment],
            status,
            updatedAt: at,
          }
        : r,
    ),
    audit: [
      {
        id: crypto.randomUUID(),
        actor: actor.name,
        action: `Recorded payment ${reference.trim()}`,
        recordId: id,
        company: record.company,
        at,
      },
      ...workspace.audit,
    ],
  };
}

/** Kinds whose owner means "the person responsible", and so can be assigned. */
export const ASSIGNABLE_KINDS = ["leads", "quotations", "orders", "logistics", "accounts", "marketing", "it"] as const;
const LEADS_BY_ROLE: Partial<Record<Actor["role"], readonly string[]>> = {
  "Sales Manager": ["leads", "quotations"],
  "Logistics Manager": ["logistics"],
  "Accounts Manager": ["accounts"],
  "Marketing Manager": ["marketing", "leads"],
  "IT Administrator": ["it"],
};

/**
 * Who may hand a record to someone else: a manager who may already change
 * it — group leadership for anything assignable, a department manager for
 * their own department's records. Executives cannot reassign.
 */
export function canAssign(actor: Actor, record: RecordItem) {
  if (!(ASSIGNABLE_KINDS as readonly string[]).includes(record.kind) || isCashEntry(record)) return false;
  if (!canWrite(actor, record)) return false;
  if (["MD", "Group Manager", "Branch Manager"].includes(actor.role)) return true;
  return !!LEADS_BY_ROLE[actor.role]?.includes(record.kind);
}

/**
 * Makes `assignee` the record's owner. The caller has already checked the
 * assignee is active and could read the record once it is theirs.
 */
export function assign(
  workspace: Workspace,
  actor: Actor,
  id: string,
  assignee: { id: string; name: string },
): Workspace {
  const record = workspace.records.find((r) => r.id === id);
  if (!record || !canAssign(actor, record))
    throw new Error("You do not have permission to assign this record.");
  if (record.ownerId === assignee.id) return workspace;
  const now = new Date().toISOString();
  return {
    records: workspace.records.map((r) =>
      r.id === id ? { ...r, ownerId: assignee.id, owner: assignee.name, updatedAt: now } : r,
    ),
    audit: [
      {
        id: crypto.randomUUID(),
        actor: actor.name,
        action: `Assigned to ${assignee.name} (was ${record.owner})`,
        recordId: id,
        company: record.company,
        at: now,
      },
      ...workspace.audit,
    ],
  };
}
