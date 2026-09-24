"use client";
import { useRef, useState } from "react";
import { Upload, FileDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button, Dialog, DialogActions } from "@/components/ui/controls";
import {
  planImport, templateCsv, failureCsv, importColumns, CsvError, CSV_LIMITS,
  IMPORT_CHUNK, type ImportableKind, type ImportPlan, type RowIssue,
} from "@/lib/import";
import { downloadCsv, exportFilename } from "@/lib/export";
import type { Actor, RecordItem } from "@/lib/domain";

type Result = { imported: number; duplicates: number; failed: RowIssue[] };

/**
 * CSV import: choose, preview, confirm, then write.
 *
 * Nothing is sent until the user presses the confirm button. Rows are posted
 * to the ordinary create endpoint one at a time, in small concurrent groups,
 * so every record goes through the same authorisation, validation and audit as
 * one typed by hand.
 */
export default function ImportDialog({
  kind, company, branch, actor, existing, onClose, onDone,
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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function choose(file: File) {
    setError(""); setPlan(null); setResult(null);
    if (file.size > CSV_LIMITS.bytes) {
      setError(`That file is larger than ${Math.round(CSV_LIMITS.bytes / 1000)} KB. Split it and import in parts.`);
      return;
    }
    setFilename(file.name);
    try {
      // Parsed in the browser; the file itself is never uploaded or stored.
      setPlan(planImport(kind, await file.text(), { company, branch, actor }, existing));
    } catch (e) {
      setError(e instanceof CsvError ? e.message : "That file could not be read as CSV.");
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
              failed.push({ row: row.row, field: "server", reason: String(body.error || response.status) });
            else if (body.duplicate) duplicates += 1;
            else imported += 1;
          } catch {
            failed.push({ row: row.row, field: "network", reason: "the request did not complete" });
          }
        }),
      );
      setProgress({ done: Math.min(i + IMPORT_CHUNK, rows.length), total: rows.length });
    }

    setProgress(null);
    setResult({ imported, duplicates, failed });
    await onDone();
  }

  const skipped = plan ? plan.duplicatesInFile.length + plan.duplicatesExisting.length : 0;
  const titleOf = (row: number) =>
    String(plan?.valid.find((v) => v.row === row)?.payload.title ?? "");

  return (
    <Dialog onClose={onClose} title={`Import ${kind} from CSV`}>
      {!plan && !result && (
        <div className="import-start">
          <p>
            Choose a CSV file. It is read in your browser and nothing is saved
            until you confirm. Up to {CSV_LIMITS.rows} rows per file.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void choose(f); }}
          />
          <DialogActions>
            <Button className="secondary" onClick={() => downloadCsv(exportFilename(company, `${kind}-template`), templateCsv(kind))}>
              <FileDown size={16} /> Download template
            </Button>
          </DialogActions>
          <p className="muted small">
            Columns: {importColumns(kind).map((c) => c.key).join(", ")}
          </p>
        </div>
      )}

      {error && <div className="error" role="alert">{error}</div>}

      {plan && !result && (
        <div className="import-preview">
          <dl className="import-summary">
            <div><dt>File</dt><dd>{filename}</dd></div>
            <div><dt>Module</dt><dd>{kind}</dd></div>
            <div><dt>Rows</dt><dd>{plan.total}</dd></div>
            <div><dt>Ready</dt><dd>{plan.valid.length}</dd></div>
            <div><dt>Errors</dt><dd>{plan.errors.length}</dd></div>
            <div><dt>Duplicates</dt><dd>{skipped}</dd></div>
          </dl>

          {plan.unknownColumns.length > 0 && (
            <p className="muted small" role="status">
              <AlertTriangle size={14} /> Ignored column
              {plan.unknownColumns.length > 1 ? "s" : ""}: {plan.unknownColumns.join(", ")}
            </p>
          )}

          {plan.valid.length > 0 && (
            <table className="import-table">
              <thead><tr><th>Row</th><th>Name</th><th>Contact</th><th>Product</th></tr></thead>
              <tbody>
                {plan.valid.slice(0, 5).map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{String(r.payload.title)}</td>
                    <td>{String(r.payload.contact ?? "")}</td>
                    <td>{String(r.payload.product ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {(plan.errors.length > 0 || skipped > 0) && (
            <ul className="import-issues">
              {[...plan.errors, ...plan.duplicatesInFile, ...plan.duplicatesExisting]
                .slice(0, 10)
                .map((i, n) => (
                  <li key={`${i.row}-${i.field}-${n}`}>
                    {i.row ? `Row ${i.row}` : "Header"} — {i.field} — {i.reason}
                  </li>
                ))}
            </ul>
          )}

          <DialogActions>
            <Button className="secondary" onClick={onClose}>Cancel</Button>
            <Button
              className="primary"
              disabled={!plan.valid.length || !!progress}
              onClick={() => void run()}
            >
              <Upload size={16} />
              {progress
                ? `Importing ${progress.done} / ${progress.total}`
                : `Import ${plan.valid.length} records`}
            </Button>
          </DialogActions>
          {!plan.valid.length && (
            <p className="muted small">No row can be imported. Fix the file and try again.</p>
          )}
        </div>
      )}

      {result && (
        <div className="import-result">
          <h3><CheckCircle2 size={18} /> Import complete</h3>
          <dl className="import-summary">
            <div><dt>Total</dt><dd>{plan?.total ?? 0}</dd></div>
            <div><dt>Imported</dt><dd>{result.imported}</dd></div>
            <div><dt>Duplicates</dt><dd>{result.duplicates + skipped}</dd></div>
            <div><dt>Skipped</dt><dd>{plan?.errors.length ?? 0}</dd></div>
            <div><dt>Failed</dt><dd>{result.failed.length}</dd></div>
          </dl>
          <DialogActions>
            {(result.failed.length > 0 || (plan?.errors.length ?? 0) > 0) && (
              <Button
                className="secondary"
                onClick={() =>
                  downloadCsv(
                    exportFilename(company, `${kind}-import-failures`),
                    failureCsv(
                      [...result.failed, ...(plan?.errors ?? []), ...(plan?.duplicatesInFile ?? []), ...(plan?.duplicatesExisting ?? [])],
                      new Map(plan?.valid.map((v) => [v.row, titleOf(v.row)])),
                    ),
                  )
                }
              >
                <FileDown size={16} /> Download failures
              </Button>
            )}
            <Button className="primary" onClick={onClose}>Done</Button>
          </DialogActions>
        </div>
      )}
    </Dialog>
  );
}
