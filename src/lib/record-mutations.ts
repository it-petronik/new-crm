import { canWrite, totalCents, type Actor, type RecordItem, type Workspace } from "./domain";
import { quotationError } from "./quotation";
import { salaryAttributes } from "./salary";
import { isCashEntry, cashEntryError } from "./cashbook";

export function commercialLocked(r: RecordItem) {
  if (isCashEntry(r)) return false;
  return ["orders", "logistics", "accounts"].includes(r.kind) ||
    (r.kind === "quotations" && ["Approved", "Accepted"].includes(r.status));
}
export const correctionFields = ["contact", "email", "phone", "destination", "due", "attributes.country"];
export function deletionReason(r: RecordItem, records: RecordItem[]): string {
  if (isCashEntry(r)) return "Cashbook entries are retained for audit. Use Cancelled status to reverse their effect on totals.";
  if (commercialLocked(r) || r.payments?.length) return "Financial and approved commercial records must be cancelled through their workflow, not deleted.";
  if (r.parentId || records.some(child => child.parentId === r.id)) return "This record is linked to other records and cannot be deleted.";
  return "";
}
export function mutateRecord(workspace: Workspace, actor: Actor, id: string, expectedUpdatedAt: string, values?: Partial<RecordItem>): Workspace {
  const r = workspace.records.find(record => record.id === id);
  if (!r || r.deletedAt || !canWrite(actor, r)) throw new Error("You do not have permission to change this record.");
  if (r.updatedAt !== expectedUpdatedAt) throw new Error("This record changed. Close the editor, refresh and try again.");
  const now = new Date().toISOString();
  let next: RecordItem;
  if (!values) {
    const reason = deletionReason(r, workspace.records);
    if (reason) throw new Error(reason);
    next = { ...r, deletedAt: now, updatedAt: now };
  } else {
    for (const key of ["kind", "company", "branch", "parentId"] as const) {
      if (values[key] !== undefined && values[key] !== r[key]) throw new Error("Record type, company and links cannot be changed while editing.");
    }
    // Allowlisted business fields only: never overwrite ownership, audit,
    // payment history, status, identifiers or deletion metadata from the client.
    const keys = commercialLocked(r)
      ? ["contact", "email", "phone", "destination", "due", "detail"] as const
      : ["title", "contact", "product", "quantity", "unit", "amount", "currency", "due", "detail", "source", "email", "phone", "destination", "lines"] as const;
    const edits = Object.fromEntries(keys.filter(key => values[key] !== undefined).map(key => [key, values[key]]));
    const attrs = commercialLocked(r)
      ? (values.attributes?.country !== undefined ? { country: values.attributes.country } : {})
      : values.attributes;
    next = { ...r, ...edits, attributes: { ...r.attributes, ...attrs }, updatedAt: now };
    if(next.kind === "hr") next.attributes = salaryAttributes(next.attributes);
    if (isCashEntry(r)) {
      const error = cashEntryError(next);
      if (error) throw new Error(error);
    } else if (isCashEntry(next)) throw new Error("An invoice cannot be converted into a cashbook entry.");
    if (!commercialLocked(r) && next.kind === "quotations") {
      const error = quotationError(next.lines || [], next.attributes?.issuedDate || next.createdAt.slice(0, 10), next.due);
      if (error) throw new Error(error);
      next.amount = totalCents(next.lines || []) / 100;
      if (next.status === "Pending Approval") next.status = "Draft";
    }
  }
  return { records: workspace.records.map(record => record.id === id ? next : record), audit: [{ id: crypto.randomUUID(), actor: actor.name, recordId: id, company: r.company, action: values ? `Edited ${r.kind}` : `Deleted ${r.kind} (retained for audit)`, at: now }, ...workspace.audit] };
}
