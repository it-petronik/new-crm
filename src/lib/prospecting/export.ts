import { describeCriteria } from "./filters";
import type { DatasetItem } from "./operations-model";
export const exportHeaders = [
  "Type",
  "Company",
  "Domain",
  "Country",
  "Industry",
  "Person",
  "Title",
  "Seniority",
  "Business email",
  "Email status",
  "Business phone",
  "Phone type",
  "Company switchboard",
  "Profile URL",
  "Source",
  "Enrichment status",
  "Enriched at",
  "CRM match",
  "Description",
];
export const exportRow = (r: DatasetItem): (string | number | Date)[] => {
  const p = r.prospect;
  return [
    p.kind,
    p.companyName || (p.kind === "company" ? p.name : ""),
    p.domain,
    p.country,
    p.industry,
    p.kind === "person" ? p.name : "",
    p.title,
    p.seniority || "",
    p.email,
    p.emailStatus || "",
    p.phone,
    p.phoneType || "",
    p.companyPhone || "",
    p.profileUrl || "",
    "Apollo",
    p.enrichmentStatus || "Not enriched",
    p.enrichedAt ? new Date(p.enrichedAt) : "",
    r.match,
    p.description,
  ];
};
// Spreadsheet formula prefixes may follow whitespace, control characters or BOMs.
export function safeCell(v: string) {
  return /^[\s\u0000-\u001f\u007f\ufeff]*[=+@-]/u.test(v) || /^[\t\r\n]/.test(v)
    ? "'" + v
    : v;
}
export function csv(rows: DatasetItem[]) {
  return (
    "\ufeff" +
    [exportHeaders, ...rows.map(exportRow)]
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              safeCell(v instanceof Date ? v.toISOString() : String(v)).replace(
                /"/g,
                '""',
              ) +
              '"',
          )
          .join(","),
      )
      .join("\r\n")
  );
}
const xml = (v: unknown) =>
  String(v)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const enc = new TextEncoder();
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
/** Minimal standards-compliant, uncompressed ZIP: Worker-native, no Node or eval dependency. */
function zip(files: Record<string, string>) {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const n = enc.encode(name),
      b = enc.encode(value),
      crc = crc32(b),
      h = new Uint8Array(30 + n.length),
      v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, b.length, true);
    v.setUint32(22, b.length, true);
    v.setUint16(26, n.length, true);
    h.set(n, 30);
    chunks.push(h, b);
    const ch = new Uint8Array(46 + n.length),
      cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, b.length, true);
    cv.setUint32(24, b.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    ch.set(n, 46);
    central.push(ch);
    offset += h.length + b.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0),
    end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, central.length, true);
  e.setUint16(10, central.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let i = 0;
  for (const b of [...chunks, ...central, end]) {
    out.set(b, i);
    i += b.length;
  }
  return out;
}
function column(n: number) {
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}
export type Report = ReturnType<typeof report>;
export function report(
  rows: DatasetItem[],
  creditRows: {
    operation: string;
    estimatedCredits: number;
    actualCredits: number | null;
    status: string;
  }[] = [],
) {
  const costRows = creditRows.filter(
    (r) => r.operation !== "person_phone_result",
  );
  const phoneObservations = creditRows
    .filter((r) => r.operation === "person_phone_result")
    .map((r) => r.actualCredits);
  const tally = (field: "country" | "industry" | "title") =>
    Object.entries(
      rows.reduce<Record<string, number>>((a, r) => {
        const k = r.prospect[field] || "Not supplied";
        a[k] = (a[k] || 0) + 1;
        return a;
      }, {}),
    ).sort((a, b) => b[1] - a[1]);
  return {
    generatedAt: new Date().toISOString(),
    count: rows.length,
    companies: rows.filter((r) => r.prospect.kind === "company").length,
    people: rows.filter((r) => r.prospect.kind === "person").length,
    representedCompanies: new Set(
      rows
        .map(
          (r) =>
            r.prospect.companyId || r.prospect.domain || r.prospect.companyName,
        )
        .filter(Boolean),
    ).size,
    existing: rows.filter((r) => r.match.startsWith("Existing")).length,
    possible: rows.filter((r) => r.match === "Possible Customer match").length,
    noCheckedMatch: rows.filter(
      (r) => r.match === "No match in checked records",
    ).length,
    enriched: rows.filter((r) => !!r.prospect.enrichedAt).length,
    countries: tally("country"),
    industries: tally("industry"),
    roles: tally("title"),
    criteria: [...new Set(rows.map((r) => JSON.stringify(r.criteria)))].map(
      (s) => JSON.parse(s),
    ),
    usage: creditRows,
    estimatedCredits: costRows.reduce((n, r) => n + r.estimatedCredits, 0),
    observedCredits: costRows.reduce((n, r) => n + (r.actualCredits ?? 0), 0),
    phoneObservations,
    unknownCreditOperations: costRows.filter((r) => r.actualCredits === null)
      .length,
    note: "Counts describe this authorized staged selection, not every Apollo result or the entire CRM. Matching checks up to 1,000 authorized Customers and 5,000 scoped Contacts. External descriptions are provider claims; no AI generated these figures.",
  };
}
export function xlsx(rows: DatasetItem[], summary: Report) {
  const sheets = [
    { name: "Prospects", rows: [exportHeaders, ...rows.map(exportRow)] },
    {
      name: "Companies",
      rows: [
        exportHeaders,
        ...rows.filter((r) => r.prospect.kind === "company").map(exportRow),
      ],
    },
    {
      name: "People",
      rows: [
        exportHeaders,
        ...rows.filter((r) => r.prospect.kind === "person").map(exportRow),
      ],
    },
    {
      name: "Summary",
      rows: [
        ["Measure", "Value"],
        ["Generated at", new Date(summary.generatedAt)],
        ["Selected prospects", summary.count],
        ["Company results", summary.companies],
        ["People results", summary.people],
        ["Represented companies", summary.representedCompanies],
        ["Existing CRM matches", summary.existing],
        ["Possible matches", summary.possible],
        ["No match in checked records", summary.noCheckedMatch],
        ["Enrichment attempted", summary.enriched],
        ["Estimated credits in related operations", summary.estimatedCredits],
        ["Observed credits reported by Apollo", summary.observedCredits],
        [
          "Operations with unknown actual charge",
          summary.unknownCreditOperations,
        ],
        ["Related provider operations", summary.usage.length],
        [
          "Phone-result credit observations (not added to total)",
          summary.phoneObservations
            .map((n) => (n === null ? "Unknown" : String(n)))
            .join(", ") || "None",
        ],
        ["Coverage", summary.note],
        ["Search criteria", summary.criteria.map(describeCriteria).join("\n")],
        ...[
          ...summary.countries.map(([k, v]) => [`Country: ${k}`, v]),
          ...summary.roles.map(([k, v]) => [`Role: ${k}`, v]),
          ...summary.industries.map(([k, v]) => [`Industry: ${k}`, v]),
        ],
      ] as (string | number | Date)[][],
    },
  ];
  const pre = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files: Record<string, string> = {};
  files["[Content_Types].xml"] =
    pre +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
  files["_rels/.rels"] =
    pre +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  files["xl/workbook.xml"] =
    pre +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
  files["xl/_rels/workbook.xml.rels"] =
    pre +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  files["xl/styles.xml"] =
    pre +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF123E50"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  sheets.forEach((s, i) => {
    const last = `${column(s.rows[0].length - 1)}${s.rows.length}`;
    files[`xl/worksheets/sheet${i + 1}.xml`] =
      pre +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="32"/><cols>${s.rows[0].map((_, c) => `<col min="${c + 1}" max="${c + 1}" width="${i === 3 ? (c === 0 ? 42 : 72) : c === 18 ? 70 : [1, 5, 6, 8, 13].includes(c) ? 34 : 23}" customWidth="1"/>`).join("")}</cols><sheetData>${s.rows
        .map(
          (r, n) =>
            `<row r="${n + 1}"${` ht="${n === 0 ? 36 : Math.min(120, Math.max(32, ...r.map((v, c) => Math.ceil(String(v instanceof Date ? "date" : v).length / (i === 3 ? (c === 0 ? 40 : 70) : c === 18 ? 68 : [1, 5, 6, 8, 13].includes(c) ? 32 : 21)) * 14 + 6)))}" customHeight="1"`}>${r
              .map((v, c) => {
                const ref = `${column(c)}${n + 1}`;
                return typeof v === "number"
                  ? `<c r="${ref}" s="${n === 0 ? 1 : 0}"><v>${v}</v></c>`
                  : v instanceof Date
                    ? `<c r="${ref}" s="2"><v>${v.getTime() / 86400000 + 25569}</v></c>`
                    : `<c r="${ref}" s="${n === 0 ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(String(v).slice(0, 32767))}</t></is></c>`;
              })
              .join("")}</row>`,
        )
        .join(
          "",
        )}</sheetData><autoFilter ref="A1:${last}"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  });
  return zip(files);
}
