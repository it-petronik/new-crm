import {
  canRead,
  canWrite,
  type Actor,
  type RecordItem,
  type Workspace,
} from "./domain";
import { deletionReason, mutateRecord } from "./record-mutations";

/** Page checkboxes never silently select records on another page. */
export function togglePageSelection(
  selected: string[],
  visible: string[],
  checked: boolean,
) {
  const ids = new Set(selected);
  for (const id of visible) checked ? ids.add(id) : ids.delete(id);
  return [...ids];
}

export function recordDeleteProblem(
  actor: Actor,
  record: RecordItem,
  all: RecordItem[],
) {
  if (record.deletedAt || !canRead(actor, record) || !canWrite(actor, record))
    return "You do not have permission to delete this record.";
  return deletionReason(record, all);
}

export type BulkDeleteResult = {
  deleted: string[];
  failed: { id: string; title: string; reason: string }[];
  refreshFailed?: boolean;
};

/** Preview uses exactly the existing soft-delete and per-record audit rules. */
export function deletePreviewSelection(
  workspace: Workspace,
  actor: Actor,
  selected: RecordItem[],
) {
  let next = workspace;
  const result: BulkDeleteResult = { deleted: [], failed: [] };
  for (const record of selected) {
    try {
      next = mutateRecord(next, actor, record.id, record.updatedAt);
      result.deleted.push(record.id);
    } catch (e) {
      result.failed.push({
        id: record.id,
        title: record.title,
        reason:
          e instanceof Error ? e.message : "Unable to delete this record.",
      });
    }
  }
  return { workspace: next, result };
}
