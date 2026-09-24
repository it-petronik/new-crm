import { detailFields } from "./record-profiles";
import type { RecordItem } from "./domain";

/**
 * CSV export of the records a user is already looking at.
 *
 * Columns come from `detailFields`, the same source the detail dialog uses, so
 * an export matches what is on screen — including money formatted with its
 * currency and quantities with their unit — rather than exposing raw stored
 * shapes. Nothing here widens access: the caller passes the rows it has
 * already scoped and filtered.
 */

/**
 * Neutralises a value that a spreadsheet would treat as a formula.
 *
 * Excel, Numbers and Sheets execute a cell beginning with = + - @ or a control
 * character, which turns exported text into code on the reader's machine. CRM
 * records include values that originate outside the company — a website
 * enquiry supplies its own contact name and message — so this is untrusted
 * text, not a theoretical concern. A leading apostrophe makes the cell literal.
 */
function neutralise(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** One RFC 4180 field: quoted when it must be, with quotes doubled inside. */
function cell(value: unknown) {
  const text = neutralise(value == null ? "" : String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows to CSV text. CRLF line endings, as the format specifies. */
export function toCsv(rows: unknown[][]) {
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

/**
 * Builds the column set for a list of records.
 *
 * Records in one list normally share a kind and therefore their labels, but
 * `accounts` mixes invoices and cash entries, which have different fields. The
 * union in first-seen order keeps every value addressable without forcing a
 * column order that suits only the first row.
 */
export function exportColumns(records: RecordItem[]) {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const record of records)
    for (const [label] of detailFields(record))
      if (!seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
  return labels;
}

/** Leading columns every list shows, which detailFields does not include. */
const LEAD_COLUMNS = ["Reference", "Status", "Company", "Branch", "Created"] as const;

export function recordsToCsv(records: RecordItem[]) {
  const labels = exportColumns(records);
  const header = [...LEAD_COLUMNS, ...labels];
  const body = records.map((record) => {
    const values = new Map(detailFields(record));
    return [
      record.id,
      record.status,
      record.company,
      record.branch,
      record.createdAt?.slice(0, 10) ?? "",
      ...labels.map((label) => values.get(label) ?? ""),
    ];
  });
  return toCsv([header, ...body]);
}

/** `petronik-leads-2026-09-25.csv` */
export function exportFilename(company: string, label: string, now = new Date()) {
  const slug = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "records";
  return `${slug(company)}-${slug(label)}-${now.toISOString().slice(0, 10)}.csv`;
}

/**
 * Hands the file to the browser. A UTF-8 BOM is included because Excel on
 * Windows otherwise reads UTF-8 as the local code page and mangles accented
 * names and currency symbols.
 */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
