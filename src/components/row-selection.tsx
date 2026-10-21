"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Trash2, X } from "lucide-react";
import { Button, Dialog, DialogActions } from "./ui/controls";
import { useTableExport } from "./table-export";
import type { BulkDeleteResult } from "@/lib/table-selection";
import { togglePageSelection } from "@/lib/table-selection";
import type { RecordItem } from "@/lib/domain";

export function useRowSelection<T extends { id: string }>(
  rows: T[],
  scope: string,
) {
  const [state, setState] = useState({ scope, ids: [] as string[] });
  const signature = JSON.stringify(rows.map((r) => r.id));
  const allowed = new Set(rows.map((r) => r.id));
  const ids =
    state.scope === scope ? state.ids.filter((id) => allowed.has(id)) : [];
  // A filter/role/company change cannot leave hidden rows selected. Sorting
  // and pagination deliberately do not change the scope key.
  useEffect(() => {
    setState((old) => {
      const available = new Set<string>(JSON.parse(signature));
      const next =
        old.scope === scope ? old.ids.filter((id) => available.has(id)) : [];
      return old.scope === scope && next.length === old.ids.length
        ? old
        : { scope, ids: next };
    });
  }, [scope, signature]);
  return {
    ids,
    selected: rows.filter((r) => ids.includes(r.id)),
    has: (id: string) => ids.includes(id),
    toggle: (id: string, checked: boolean) =>
      setState({ scope, ids: togglePageSelection(ids, [id], checked) }),
    togglePage: (page: T[], checked: boolean) =>
      setState({
        scope,
        ids: togglePageSelection(
          ids,
          page.map((r) => r.id),
          checked,
        ),
      }),
    clear: () => setState({ scope, ids: [] }),
  };
}

export function SelectionCheckbox({
  label,
  checked,
  mixed = false,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  mixed?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      className="table-selection-checkbox"
      type="checkbox"
      aria-label={label}
      aria-checked={mixed ? "mixed" : checked}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

export function SelectionHeader<T extends { id: string }>({
  selection,
  rows,
  label = "rows",
}: {
  selection: ReturnType<typeof useRowSelection<T>>;
  rows: T[];
  label?: string;
}) {
  return (
    <th className="table-select-cell">
      <SelectionCheckbox
        label={`Select all ${label} on this page`}
        checked={!!rows.length && rows.every((r) => selection.has(r.id))}
        mixed={
          rows.some((r) => selection.has(r.id)) &&
          !rows.every((r) => selection.has(r.id))
        }
        onChange={(checked) => selection.togglePage(rows, checked)}
      />
    </th>
  );
}
export function SelectionCell<T extends { id: string }>({
  selection,
  row,
  label,
}: {
  selection: ReturnType<typeof useRowSelection<T>>;
  row: T;
  label: string;
}) {
  return (
    <td className="table-select-cell">
      <SelectionCheckbox
        label={`Select ${label}`}
        checked={selection.has(row.id)}
        onChange={(checked) => selection.toggle(row.id, checked)}
      />
    </td>
  );
}

export function SelectionActions<T extends { id: string }>({
  selected,
  title,
  onClear,
  onDelete,
  deletableCount,
  onExport,
}: {
  selected: T[];
  title: string;
  onClear: () => void;
  onDelete?: () => void;
  deletableCount?: number;
  onExport?: () => void;
}) {
  const exporter = useTableExport();
  if (!selected.length) return null;
  return (
    <div
      className="table-selection-bar"
      role="region"
      aria-label="Selected row actions"
    >
      <span role="status">
        <strong>{selected.length}</strong> selected
      </span>
      {(onExport || exporter.available) && (
        <Button
          variant="secondary"
          size="small"
          onClick={onExport || (() => exporter.run(selected, title))}
        >
          <Download size={15} aria-hidden="true" />
          Export selected
        </Button>
      )}
      {onDelete && (deletableCount === undefined || deletableCount > 0) && (
        <Button variant="danger" size="small" onClick={onDelete}>
          <Trash2 size={15} aria-hidden="true" />
          Delete selected
        </Button>
      )}
      {onDelete && deletableCount === 0 && (
        <span className="muted small">
          These records are protected from deletion.
        </span>
      )}
      <Button variant="ghost" size="small" onClick={onClear}>
        <X size={14} aria-hidden="true" />
        Clear selection
      </Button>
    </div>
  );
}

export function BulkDeleteDialog({
  records,
  problem,
  onConfirm,
  onClose,
}: {
  records: RecordItem[];
  problem: (r: RecordItem) => string;
  onConfirm: (rows: RecordItem[]) => Promise<BulkDeleteResult>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkDeleteResult | null>(null);
  const eligible = records.filter((r) => !problem(r));
  const blocked = records.filter((r) => problem(r));
  const overLimit = eligible.length > 100;
  return (
    <Dialog
      title={result ? "Deletion result" : "Delete selected records?"}
      className="bulk-delete-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {result ? (
        <>
          <p role="status">
            <strong>{result.deleted.length}</strong> records removed. Audit
            history retained.
          </p>
          {!!result.failed.length && (
            <div role="alert">
              <p>
                {result.failed.length} records were not confirmed as deleted.
                Refresh the list before trying again.
              </p>
              <ul className="bulk-delete-list">
                {result.failed.map((r) => (
                  <li key={r.id}>
                    <strong>{r.title}</strong>
                    <span>{r.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.refreshFailed && (
            <p role="alert">
              The list could not refresh. Reload it to see the latest records.
            </p>
          )}
        </>
      ) : (
        <>
          <p>
            {eligible.length
              ? `${eligible.length} selected records can be removed from the workspace.`
              : "These selected records cannot be deleted."}{" "}
            Audit history is retained. Related records will not be deleted.
          </p>
          {!!eligible.length && (
            <ul className="bulk-delete-list" aria-label="Records to delete">
              {eligible.map((r) => (
                <li key={r.id}>{r.title}</li>
              ))}
            </ul>
          )}
          {!!blocked.length && (
            <div className="bulk-delete-protected">
              <h3>{blocked.length} protected · will not be deleted</h3>
              <ul className="bulk-delete-list">
                {blocked.map((r) => (
                  <li key={r.id}>
                    <strong>{r.title}</strong>
                    <span>{problem(r)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {overLimit && (
            <p role="alert">Select up to 100 deletable records at a time.</p>
          )}
        </>
      )}
      <DialogActions
        onCancel={onClose}
        pending={busy}
        cancel={result || !eligible.length ? "Close" : "Cancel"}
        primary={
          !result && !!eligible.length
            ? {
                label: `Delete ${eligible.length} records`,
                tone: "danger",
                disabled: overLimit,
                pending: busy,
                pendingLabel: "Deleting…",
                onClick: async () => {
                  setBusy(true);
                  try {
                    setResult(await onConfirm(eligible));
                  } catch {
                    setResult({
                      deleted: [],
                      failed: eligible.map((r) => ({
                        id: r.id,
                        title: r.title,
                        reason:
                          "Could not confirm deletion. Refresh before trying again.",
                      })),
                    });
                  } finally {
                    setBusy(false);
                  }
                },
              }
            : undefined
        }
      />
    </Dialog>
  );
}
