/**
 * CSV parsing for untrusted uploaded files.
 *
 * Written by hand rather than pulled in as a dependency because the rules that
 * matter here are the ones a CRM import needs to be strict about — duplicate
 * headers, unbounded cells, stray control characters — and a general parser
 * would accept them silently.
 */

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

/** Bounds, chosen so one import stays well inside the Workers request budget. */
export const CSV_LIMITS = {
  bytes: 1_000_000, // 1 MB
  rows: 500,
  columns: 60,
  cell: 5_000,
} as const;

/**
 * Splits CSV text into rows of raw strings.
 *
 * Handles a UTF-8 BOM, quoted fields containing commas, newlines and doubled
 * quotes, and both CRLF and LF endings. An unterminated quote is an error
 * rather than a best guess, because silently absorbing the rest of the file
 * would turn a malformed upload into one enormous field.
 */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) throw new CsvError("The file is empty.");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    if (field.length > CSV_LIMITS.cell)
      throw new CsvError(`A value is longer than ${CSV_LIMITS.cell} characters.`);
    // Control characters other than tab cannot appear in a legitimate export
    // and are a common way to smuggle content past a reviewer's eye.
    row.push(field.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""));
    field = "";
  };
  const endRow = () => {
    endField();
    // A trailing newline produces one empty field; that is not a row.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    if (rows.length > CSV_LIMITS.rows + 1)
      throw new CsvError(`More than ${CSV_LIMITS.rows} rows. Split the file and import in parts.`);
  };

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') {
      if (field.trim() !== "")
        throw new CsvError("A quoted value must start at the beginning of the field.");
      quoted = true; field = ""; i += 1; continue;
    }
    if (ch === ",") { endField(); i += 1; continue; }
    if (ch === "\r") { if (text[i + 1] === "\n") i += 1; endRow(); i += 1; continue; }
    if (ch === "\n") { endRow(); i += 1; continue; }
    field += ch; i += 1;
  }
  if (quoted) throw new CsvError("A quoted value is never closed.");
  endRow();

  if (!rows.length) throw new CsvError("The file has no rows.");
  return rows;
}

/**
 * Parses and validates the header row.
 *
 * Duplicate headers are rejected rather than resolved, because either choice —
 * first wins or last wins — silently discards data the uploader believes was
 * imported.
 */
export function readHeaders(rows: string[][]) {
  const headers = rows[0].map((h) => h.trim());
  if (headers.length > CSV_LIMITS.columns)
    throw new CsvError(`More than ${CSV_LIMITS.columns} columns.`);
  if (headers.every((h) => !h)) throw new CsvError("The first row must be column headers.");
  const seen = new Set<string>();
  for (const header of headers) {
    const key = header.toLowerCase();
    if (!key) continue;
    if (seen.has(key)) throw new CsvError(`Duplicate column "${header}".`);
    seen.add(key);
  }
  return headers;
}
