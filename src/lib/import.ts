import { recordProfiles, type FieldSpec } from "./record-profiles";
import { stages, type Kind, type RecordItem, type Actor } from "./domain";
import { parseCsv, readHeaders, CsvError, CSV_LIMITS } from "./csv";
import { toCsv } from "./export";

/**
 * CSV import.
 *
 * Every row is turned into exactly the payload the create form would send and
 * posted to `POST /api/records`, so authorisation, company and branch scope,
 * business rules, audit and idempotency are the existing ones. There is no
 * second write path: nothing here talks to D1.
 */

/**
 * Modules that accept import.
 *
 * Only kinds whose records are genuinely creatable stand-alone. Orders,
 * logistics and non-cash accounts are refused by the API itself — they must
 * originate from an accepted quotation — and quotations carry priced line
 * items that a flat row cannot express. Importing those would need a second,
 * weaker creation path, which is exactly what this must not build.
 */
export const IMPORTABLE_KINDS = ["leads", "customers", "suppliers", "products"] as const;
export type ImportableKind = (typeof IMPORTABLE_KINDS)[number];

export const isImportable = (kind: string): kind is ImportableKind =>
  (IMPORTABLE_KINDS as readonly string[]).includes(kind);

/** Records are sent one per request; the API creates one record per call. */
export const IMPORT_CHUNK = 5;

export type ImportColumn = FieldSpec & { key: string };

/**
 * Columns for a module, keyed by machine name rather than display label.
 *
 * Labels are user-facing and have been reworded before; a file keyed on them
 * would break silently. `title` is always first because every record needs a
 * name, and it is the one field the profiles express only as `nameLabel`.
 */
export function importColumns(kind: ImportableKind): ImportColumn[] {
  const profile = recordProfiles[kind];
  const name: ImportColumn = {
    key: "title",
    name: "title",
    label: profile.nameLabel,
    required: true,
  };
  return [
    name,
    ...profile.fields.map((field) => ({ ...field, key: field.name })),
  ];
}

export type RowIssue = { row: number; field: string; reason: string };
export type PreparedRow = {
  row: number;
  payload: Record<string, unknown>;
  naturalKey: string;
};
export type ImportPlan = {
  kind: ImportableKind;
  columns: ImportColumn[];
  unknownColumns: string[];
  total: number;
  valid: PreparedRow[];
  errors: RowIssue[];
  duplicatesInFile: RowIssue[];
  duplicatesExisting: RowIssue[];
};

/**
 * A value that identifies the same business entity across imports — an email
 * for a person, a code for a product. Used only to warn; nothing is merged or
 * overwritten on the strength of it.
 */
export function naturalKey(kind: ImportableKind, values: Record<string, unknown>): string {
  const get = (k: string) => String(values[k] ?? "").trim().toLowerCase();
  if (kind === "products") return get("attributes.sku");
  if (kind === "suppliers") return get("attributes.supplierCode") || get("email");
  return get("email");
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates one cell against its field spec. Returns a reason, or "". */
function fieldError(column: ImportColumn, raw: string): string {
  const value = raw.trim();
  if (!value) return column.required ? "required" : "";
  if (column.options && !column.options.includes(value))
    return `"${value}" is not one of: ${column.options.join(", ")}`;
  if (column.type === "number") {
    if (!/^-?\d+(\.\d+)?$/.test(value)) return `"${value}" is not a number`;
    const n = Number(value);
    if (!Number.isFinite(n)) return `"${value}" is not a number`;
    if (column.min != null && n < column.min) return `must be at least ${column.min}`;
  }
  if (column.type === "date" && !ISO_DATE.test(value))
    return `"${value}" is not a date in YYYY-MM-DD form`;
  if (column.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    return `"${value}" is not a valid email address`;
  if (column.key === "title" && value.length < 2) return "must be at least 2 characters";
  if (value.length > 160 && !["detail", "notes"].includes(column.key))
    return "is longer than 160 characters";
  return "";
}

/** Field names that must never be taken from a file. */
const FORBIDDEN = new Set([
  "__proto__", "constructor", "prototype",
  "id", "ownerId", "owner", "status", "createdAt", "updatedAt",
  "deletedAt", "company", "branch", "kind", "requestId", "parentId", "lines",
]);

/**
 * Turns a parsed file into a plan the user can review.
 *
 * Nothing is written here. Company and branch are taken from the workspace the
 * user is importing into, never from the file, and ownership is assigned by
 * the server — a row cannot nominate a different company, branch or owner.
 */
export function planImport(
  kind: ImportableKind,
  text: string,
  context: { company: string; branch: string; actor: Actor },
  existing: RecordItem[] = [],
): ImportPlan {
  const rows = parseCsv(text);
  const headers = readHeaders(rows);
  const columns = importColumns(kind);
  const byKey = new Map(columns.map((c) => [c.key.toLowerCase(), c]));

  // Unknown columns are reported and ignored, never mapped onto a field. The
  // allowlist is the profile; a file cannot reach anything else.
  const unknownColumns = headers.filter(
    (h) => h && (!byKey.has(h.toLowerCase()) || FORBIDDEN.has(h)),
  );

  const missingRequired = columns
    .filter((c) => c.required && !headers.some((h) => h.toLowerCase() === c.key.toLowerCase()))
    .map((c) => c.key);

  const errors: RowIssue[] = [];
  const duplicatesInFile: RowIssue[] = [];
  const duplicatesExisting: RowIssue[] = [];
  const valid: PreparedRow[] = [];

  for (const key of missingRequired)
    errors.push({ row: 0, field: key, reason: "required column is missing from the file" });

  const existingKeys = new Set(
    existing
      .filter((r) => r.kind === kind)
      .map((r) => naturalKey(kind, { email: r.email, "attributes.sku": r.attributes?.sku, "attributes.supplierCode": r.attributes?.supplierCode }))
      .filter(Boolean),
  );
  const seenInFile = new Set<string>();

  const body = rows.slice(1);
  for (let index = 0; index < body.length; index++) {
    // Row numbers match what a spreadsheet shows: header is row 1.
    const rowNumber = index + 2;
    const cells = body[index];
    if (cells.every((c) => !c.trim())) continue; // blank line

    const values: Record<string, string> = {};
    let rowFailed = missingRequired.length > 0;

    headers.forEach((header, column) => {
      const spec = byKey.get(header.toLowerCase());
      if (!spec || FORBIDDEN.has(header)) return;
      const raw = cells[column] ?? "";
      const reason = fieldError(spec, raw);
      if (reason) {
        errors.push({ row: rowNumber, field: spec.key, reason });
        rowFailed = true;
      } else {
        values[spec.key] = raw.trim();
      }
    });

    if (rowFailed) continue;

    const key = naturalKey(kind, values);
    if (key && seenInFile.has(key)) {
      duplicatesInFile.push({ row: rowNumber, field: "duplicate", reason: `"${key}" appears earlier in this file` });
      continue;
    }
    if (key && existingKeys.has(key)) {
      duplicatesExisting.push({ row: rowNumber, field: "duplicate", reason: `"${key}" already exists in this workspace` });
      continue;
    }
    if (key) seenInFile.add(key);

    valid.push({ row: rowNumber, naturalKey: key, payload: toPayload(kind, values, context) });
  }

  return {
    kind, columns, unknownColumns,
    total: body.filter((r) => r.some((c) => c.trim())).length,
    valid, errors, duplicatesInFile, duplicatesExisting,
  };
}

/** Builds exactly the body the create form posts, with safe defaults. */
function toPayload(
  kind: ImportableKind,
  values: Record<string, string>,
  context: { company: string; branch: string },
): Record<string, unknown> {
  const profile = recordProfiles[kind];
  const attributes: Record<string, string> = {};
  const flat: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith("attributes.")) attributes[key.slice(11)] = value;
    else flat[key] = value;
  }
  for (const column of importColumns(kind))
    if (column.type === "number" && flat[column.key] != null)
      flat[column.key] = Number(flat[column.key]);

  return {
    kind,
    // Never from the file: the workspace decides scope, the server decides owner.
    company: context.company,
    branch: context.branch,
    title: String(flat.title ?? ""),
    contact: String(flat.contact ?? ""),
    product: String(flat.product ?? ""),
    quantity: Number(flat.quantity ?? 0),
    unit: String(flat.unit ?? profile.unit ?? "MT"),
    amount: Number(flat.amount ?? 0),
    currency: String(flat.currency ?? "USD"),
    due: String(flat.due ?? new Date().toISOString().slice(0, 10)),
    detail: String(flat.detail ?? ""),
    source: String(flat.source ?? "CSV import"),
    ...(flat.email ? { email: String(flat.email) } : {}),
    ...(flat.phone ? { phone: String(flat.phone) } : {}),
    ...(flat.destination ? { destination: String(flat.destination) } : {}),
    ...(Object.keys(attributes).length ? { attributes } : {}),
  };
}

/** A blank file with the right headers and one obviously fictional row. */
export function templateCsv(kind: ImportableKind): string {
  const columns = importColumns(kind);
  const sample = columns.map((c) => {
    if (c.options) return c.options[0];
    if (c.type === "number") return "0";
    if (c.type === "date") return new Date().toISOString().slice(0, 10);
    if (c.type === "email") return "sample.contact@example.invalid";
    if (c.key === "title") return "EXAMPLE ROW — delete before importing";
    return "";
  });
  return toCsv([columns.map((c) => c.key), sample]);
}

/** Failure report the user can fix and re-import. Carries no internal fields. */
export function failureCsv(issues: RowIssue[], rowTitles: Map<number, string> = new Map()) {
  return toCsv([
    ["Row", "Name", "Field", "Reason"],
    ...issues.map((i) => [i.row || "header", rowTitles.get(i.row) ?? "", i.field, i.reason]),
  ]);
}

export { CsvError, CSV_LIMITS, stages };
