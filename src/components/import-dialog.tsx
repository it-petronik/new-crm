"use client";
import { CrmTable } from "@/components/ui/crm-table";
import { useRef, useState } from "react";
import { Upload, FileDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button, Dialog, DialogActions } from "@/components/ui/controls";
import {
  planImport,
  templateCsv,
  failureCsv,
  importColumns,
  CsvError,
  CSV_LIMITS,
  IMPORT_CHUNK,
  type ImportableKind,
  type ImportPlan,
  type RowIssue,
} from "@/lib/import";
import { downloadCsv, exportFilename } from "@/lib/export";
import type { Actor, RecordItem } from "@/lib/domain";
import {
  ListFilters,
  Pagination,
  SortHeader,
  usePagination,
} from "./pagination";

type Result = { imported: number; duplicates: number; failed: RowIssue[] };

function ImportPreviewRows({ rows }: { rows: ImportPlan["valid"] }) {
  const list = usePagination(
    rows.map((r) => ({
      id: String(r.row),
      row: r.row,
      name: String(r.payload.title),
      contact: String(r.payload.contact || ""),
      product: String(r.payload.product || ""),
    })),
  );
  return (
    <div>
      <p className="muted small">
        Preview filters only · Import includes all {rows.length} ready rows.
      </p>
      <ListFilters {...list} label="import rows" sortable={false} />
      <div className="table-scroll">
        <CrmTable className="import-table">
          <thead>
            <tr>
              {(
                [
                  ["row", "Row"],
                  ["name", "Name"],
                  ["contact", "Contact"],
                  ["product", "Product"],
                ] as const
              ).map(([key, label]) => (
                <SortHeader
                  key={key}
                  sortKey={key}
                  query={list.query}
                  setQuery={list.setQuery}
                >
                  {label}
                </SortHeader>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.items.map((row) => (
              <tr key={row.id}>
                <td>{row.row}</td>
                <td>{row.name}</td>
                <td>{row.contact}</td>
                <td>{row.product}</td>
              </tr>
            ))}
          </tbody>
        </CrmTable>
      </div>
      <Pagination {...list} />
    </div>
  );
}

/**
 * CSV import: choose, preview, confirm, then write.
 *
 * Nothing is sent until the user presses the confirm button. Rows are posted
 * to the ordinary create endpoint one at a time, in small concurrent groups,
 * so every record goes through the same authorisation, validation and audit as
 * one typed by hand.
 */
export default function ImportDialog({
  kind,
  company,
  branch,
  actor,
  existing,
  onClose,
  onDone,
}: {
  kind: ImportableKind;
  company: string;
  branch: string;
  actor: Actor;
  existing: RecordItem[];
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function choose(file: File) {
    setError("");
    setPlan(null);
    setResult(null);
    setFilename(file.name);
    if (file.size > CSV_LIMITS.bytes) {
      setError(
        `That file is larger than ${Math.round(CSV_LIMITS.bytes / 1000)} KB. Split it and import in parts.`,
      );
      return;
    }
    try {
      // Parsed in the browser; the file itself is never uploaded or stored.
      setPlan(
        planImport(
          kind,
          await file.text(),
          { company, branch, actor },
          existing,
        ),
      );
    } catch (e) {
      setError(
        e instanceof CsvError
          ? e.message
          : "That file could not be read as CSV.",
      );
    }
  }

  async function run() {
    if (!plan) return;
    // One batch id per confirmed import. Combined with the row number it gives
    // each row a stable key, so re-running this import cannot duplicate a row
    // that already landed.
    const batch = `imp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const rows = plan.valid;
    const failed: RowIssue[] = [];
    let imported = 0;
    let duplicates = 0;
    setProgress({ done: 0, total: rows.length });

    for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
      const group = rows.slice(i, i + IMPORT_CHUNK);
      await Promise.all(
        group.map(async (row) => {
          try {
            const response = await fetch("/api/records", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...row.payload,
                requestId: `${batch}:${row.row}`,
                importBatch: batch,
              }),
            });
            const body = await response.json();
            if (!response.ok)
              failed.push({
                row: row.row,
                field: "server",
                reason: String(body.error || response.status),
              });
            else if (body.duplicate) duplicates += 1;
            else imported += 1;
          } catch {
            failed.push({
              row: row.row,
              field: "network",
              reason: "the request did not complete",
            });
          }
        }),
      );
      setProgress({
        done: Math.min(i + IMPORT_CHUNK, rows.length),
        total: rows.length,
      });
    }

    setProgress(null);
    setResult({ imported, duplicates, failed });
    // Refreshing the list afterwards is best effort: the result above is
    // already shown, and a failed refresh must not surface as an error.
    try {
      await onDone();
    } catch {}
  }

  const skipped = plan
    ? plan.duplicatesInFile.length + plan.duplicatesExisting.length
    : 0;
  const titleOf = (row: number) =>
    String(plan?.valid.find((v) => v.row === row)?.payload.title ?? "");

  return (
    <Dialog
      onClose={onClose}
      title={`Import ${kind} from CSV`}
      className="import-dialog simple-entry-dialog"
    >
      {!plan && !result && (
        <div className="import-start">
          <div className="import-intro">
            <div>
              <h3>Upload, review, then import</h3>
              <p>
                Nothing is saved until you confirm. CSV only · up to{" "}
                {CSV_LIMITS.rows} rows.
              </p>
            </div>
            <Button
              variant="secondary"
              size="small"
              onClick={() =>
                downloadCsv(
                  exportFilename(company, `${kind}-template`),
                  templateCsv(kind),
                )
              }
            >
              <FileDown size={15} aria-hidden="true" />
              Download template
            </Button>
          </div>
          <div className="import-file-picker">
            <span className="import-file-icon">
              <Upload size={22} aria-hidden="true" />
            </span>
            <div>
              <strong>{filename || "Choose a CSV file"}</strong>
              <p>Use our template to keep column names correct.</p>
              <span>
                Maximum {Math.round(CSV_LIMITS.bytes / 1000)} KB · Read locally
                in your browser
              </span>
            </div>
            <input
              className="sr-only"
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV file"
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void choose(f);
                e.target.value = "";
              }}
            />
            <Button variant="primary" onClick={() => fileRef.current?.click()}>
              <Upload size={15} aria-hidden="true" />
              {filename ? "Choose another file" : "Choose file"}
            </Button>
          </div>
          <details className="import-columns">
            <summary>View supported columns</summary>
            <dl className="import-column-list">
              {importColumns(kind).map((c) => (
                <div key={c.key}>
                  <dt>
                    {c.label}
                    {c.required ? " *" : ""}
                  </dt>
                  <dd>
                    <code>{c.key}</code>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="muted small">
              * Required. Keep template headings unchanged.
            </p>
          </details>
        </div>
      )}

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {plan && !result && (
        <div className="import-preview">
          <dl className="import-summary">
            <div>
              <dt>File</dt>
              <dd>{filename}</dd>
            </div>
            <div>
              <dt>Module</dt>
              <dd>{kind}</dd>
            </div>
            <div>
              <dt>Rows</dt>
              <dd>{plan.total}</dd>
            </div>
            <div>
              <dt>Ready</dt>
              <dd>{plan.valid.length}</dd>
            </div>
            <div>
              <dt>Errors</dt>
              <dd>{plan.errors.length}</dd>
            </div>
            <div>
              <dt>Duplicates</dt>
              <dd>{skipped}</dd>
            </div>
          </dl>

          {plan.unknownColumns.length > 0 && (
            <p className="muted small" role="status">
              <AlertTriangle size={14} /> Ignored column
              {plan.unknownColumns.length > 1 ? "s" : ""}:{" "}
              {plan.unknownColumns.join(", ")}
            </p>
          )}

          {plan.relationshipWarnings.length > 0 && (
            <ul className="import-issues">
              {plan.relationshipWarnings.map((w) => (
                <li key={w.row}>
                  Row {w.row} — {w.reason}
                </li>
              ))}
            </ul>
          )}
          {plan.valid.length > 0 && <ImportPreviewRows rows={plan.valid} />}

          {(plan.errors.length > 0 || skipped > 0) && (
            <ul className="import-issues">
              {[
                ...plan.errors,
                ...plan.duplicatesInFile,
                ...plan.duplicatesExisting,
              ]
                .slice(0, 10)
                .map((i, n) => (
                  <li key={`${i.row}-${i.field}-${n}`}>
                    {i.row ? `Row ${i.row}` : "Header"} — {i.field} — {i.reason}
                  </li>
                ))}
            </ul>
          )}

          <DialogActions
            onCancel={onClose}
            primary={{
              label: `Import ${plan.valid.length} records`,
              pendingLabel: progress
                ? `Importing ${progress.done} / ${progress.total}`
                : "Importing…",
              icon: <Upload size={16} aria-hidden="true" />,
              pending: !!progress,
              disabled: !plan.valid.length,
              onClick: run,
            }}
          />
          {!plan.valid.length && (
            <p className="muted small">
              No row can be imported. Fix the file and try again.
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="import-result">
          <h3>
            <CheckCircle2 size={18} /> Import complete
          </h3>
          <dl className="import-summary">
            <div>
              <dt>Total</dt>
              <dd>{plan?.total ?? 0}</dd>
            </div>
            <div>
              <dt>Imported</dt>
              <dd>{result.imported}</dd>
            </div>
            <div>
              <dt>Duplicates</dt>
              <dd>{result.duplicates + skipped}</dd>
            </div>
            <div>
              <dt>Skipped</dt>
              <dd>{plan?.errors.length ?? 0}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{result.failed.length}</dd>
            </div>
          </dl>
          <DialogActions
            cancel={false}
            primary={{ label: "Done", onClick: onClose }}
            start={
              (result.failed.length > 0 || (plan?.errors.length ?? 0) > 0) && (
                <Button
                  className="secondary"
                  onClick={() =>
                    downloadCsv(
                      exportFilename(company, `${kind}-import-failures`),
                      failureCsv(
                        [
                          ...result.failed,
                          ...(plan?.errors ?? []),
                          ...(plan?.duplicatesInFile ?? []),
                          ...(plan?.duplicatesExisting ?? []),
                        ],
                        new Map(
                          plan?.valid.map((v) => [v.row, titleOf(v.row)]),
                        ),
                      ),
                    )
                  }
                >
                  <FileDown size={16} /> Download failures
                </Button>
              )
            }
          />
        </div>
      )}
    </Dialog>
  );
}
