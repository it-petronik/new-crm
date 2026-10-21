import { businessToday } from "./gst";
import { companyName } from "./company-name";
import { labels, type Module } from "./domain";
import type { RecordItem } from "./domain";
import { detailFields, recordProfiles } from "./record-profiles";

export type ExportCell = string | number | boolean | Date | null | undefined;
export type TableExport = {
  title: string;
  headers: string[];
  rows: ExportCell[][];
  exportedBy: string;
  company?: string;
  at?: Date;
};
const xml = (v: unknown) =>
  String(v ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const slug = (v: string) =>
  v
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90) || "Export";
export const tableExportFilename = (
  title: string,
  who: string,
  at = new Date(),
) => `Enercore_${slug(title)}_${businessToday(at)}_${slug(who)}.xlsx`;
const column = (n: number): string =>
  n < 26
    ? String.fromCharCode(65 + n)
    : column(Math.floor(n / 26) - 1) + String.fromCharCode(65 + (n % 26));

/** Worker/browser-native OOXML packaging. No Excel runtime or network is involved. */
function packageXlsx(files: Record<string, string>) {
  const enc = new TextEncoder(),
    parts: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const n = enc.encode(name),
      b = enc.encode(value);
    let crc = 0xffffffff;
    for (const v of b) {
      crc ^= v;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const h = new Uint8Array(30 + n.length),
      v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, b.length, true);
    v.setUint32(22, b.length, true);
    v.setUint16(26, n.length, true);
    h.set(n, 30);
    parts.push(h, b);
    const c = new Uint8Array(46 + n.length),
      cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, b.length, true);
    cv.setUint32(24, b.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    c.set(n, 46);
    central.push(c);
    offset += h.length + b.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0),
    end = new Uint8Array(22),
    v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, central.length, true);
  v.setUint16(10, central.length, true);
  v.setUint32(12, size, true);
  v.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const p of [...parts, ...central, end]) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Values are typed; untrusted strings are inline strings, never formulas. */
export function tableWorkbook(data: TableExport) {
  const at = data.at || new Date(),
    count = Math.max(1, data.headers.length),
    last = column(count - 1),
    lastRow = 5 + data.rows.length;
  const cell = (value: ExportCell, c: number, r: number, style: number) => {
    const ref = `${column(c)}${r}`;
    if (value instanceof Date && !Number.isNaN(value.getTime()))
      return `<c r="${ref}" s="${style % 2 ? 7 : 6}"><v>${value.getTime() / 86400000 + 25569}</v></c>`;
    if (typeof value === "number" && Number.isFinite(value)) {
      const integer =
        Number.isInteger(value) &&
        !/amount|price|salary|bonus|deduction|pay|cost/i.test(
          data.headers[c] || "",
        );
      return `<c r="${ref}" s="${integer ? (style % 2 ? 11 : 10) : style % 2 ? 5 : 4}"><v>${value}</v></c>`;
    }
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value ?? "").slice(0, 32767))}</t></is></c>`;
  };
  const rows = [
    `<row r="2" ht="28" customHeight="1">${cell(`ENERCORE  /  ${data.title}`, 0, 2, 8)}</row>`,
    `<row r="3" ht="${count<5?40:24}" customHeight="1">${cell(`Exported by ${data.exportedBy}  •  ${businessToday(at)} (GST)  •  ${data.rows.length} ${data.rows.length===1?"row":"rows"}${data.company ? `  •  ${data.company}` : ""}`, 0, 3, 9)}</row>`,
    `<row r="5" ht="32" customHeight="1">${data.headers.map((h, c) => cell(h, c, 5, 1)).join("")}</row>`,
    ...data.rows.map(
      (row, i) =>
        `<row r="${i + 6}" ht="${Math.min(72, Math.max(26, ...row.map((v) => Math.ceil(String(v ?? "").length / 34) * 14 + 8)))}" customHeight="1">${Array.from({ length: count }, (_, c) => cell(row[c], c, i + 6, i % 2 ? 3 : 2)).join("")}</row>`,
    ),
  ].join("");
  const pre = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const color =
    data.company === "Afrilube"
      ? "B42A32"
      : data.company === "Petronex"
        ? "087779"
        : data.company === "Istanergy"
          ? "942C38"
          : "174762";
  const styles = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd mmm yyyy"/></numFmts><fonts count="4"><font><sz val="11"/><color rgb="FF203544"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="16"/><color rgb="FF${color}"/><name val="Arial"/></font><font><sz val="10"/><color rgb="FF607383"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F6F8"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FFDEE8ED"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="10"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>${[2, 3, 4, 5, 6, 7].map((i) => `<xf numFmtId="${i >= 6 ? 165 : i >= 4 ? 164 : 0}" fontId="0" fillId="${i % 2 ? 3 : 0}" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="${i >= 4 ? "right" : "left"}" vertical="center" wrapText="1"/></xf>`).join("")}<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0"/><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const name = data.title.replace(/[\\/*?:\[\]]/g, " ").slice(0, 31) || "Table";
  return packageXlsx({
    "[Content_Types].xml":
      pre +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    "_rels/.rels":
      pre +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    "docProps/core.xml":
      pre +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(data.title)}</dc:title><dc:creator>${xml(data.exportedBy)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${at.toISOString()}</dcterms:created></cp:coreProperties>`,
    "xl/workbook.xml":
      pre +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      pre +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "xl/styles.xml": pre + styles,
    "xl/worksheets/sheet1.xml":
      pre +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><tabColor rgb="FF${color}"/><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}${lastRow}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="26"/><cols>${data.headers.map((h, c) => `<col min="${c + 1}" max="${c + 1}" width="${Math.min(48, Math.max(18, h.length + 3, ...data.rows.slice(0, 100).map((r) => (r[c] instanceof Date ? 18 : Math.min(38, String(r[c] ?? "").length + 2)))))}" customWidth="1"/>`).join("")}</cols><sheetData>${rows}</sheetData><autoFilter ref="A5:${last}${lastRow}"/>${count > 1 ? `<mergeCells count="2"><mergeCell ref="A2:${column(Math.min(7,count-1))}2"/><mergeCell ref="A3:${column(Math.min(7,count-1))}3"/></mergeCells>` : ""}<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`,
  });
}

/** Flat displayed values only; never serialize sessions, permissions or hidden payload objects. */
export function listExportData(rows: object[], fallback = "Table") {
  const firstRecord = rows[0] as RecordItem | undefined;
  if (
    firstRecord &&
    recordProfiles[firstRecord.kind] &&
    typeof firstRecord.title === "string" &&
    typeof firstRecord.branch === "string"
  ) {
    const records = rows as RecordItem[],
      fields = [
        ...new Set(
          records.flatMap((r) => detailFields(r).map(([label]) => label)),
        ),
      ];
    const hasQuantity = records.some((r) =>
      recordProfiles[r.kind].fields.some((f) => f.name === "quantity"),
    );
    const hasMoney = records.some((r) =>
      recordProfiles[r.kind].fields.some((f) => f.name === "amount"),
    );
    const companies = [...new Set(records.map((r) => r.company))];
    return {
      title: labels[firstRecord.kind as Module] || fallback,
      headers: [
        "Reference",
        "Name",
        "Company",
        "Branch",
        "Status",
        ...fields,
        ...(hasQuantity ? ["Unit"] : []),
        ...(hasMoney ? ["Currency"] : []),
        "Created",
        "Updated",
      ],
      rows: records.map((r) => {
        const values = new Map(detailFields(r)),
          specs = recordProfiles[r.kind].fields;
        return [
          r.id,
          r.title,
          companyName(r.company),
          r.branch,
          r.status,
          ...fields.map((label) => {
            const spec = specs.find((f) => f.label === label);
            if (spec?.name === "amount") return r.amount;
            if (spec?.name === "quantity") return r.quantity;
            const value = values.get(label) || "";
            return spec?.type === "date" && /^\d{4}-\d\d-\d\d/.test(value)
              ? new Date(value)
              : value;
          }),
          ...(hasQuantity ? [r.unit] : []),
          ...(hasMoney ? [r.currency] : []),
          new Date(r.createdAt),
          new Date(r.updatedAt),
        ];
      }),
      company:
        companies.length === 1
          ? companyName(companies[0])
          : "Multiple permitted companies",
    };
  }
  const hidden =
    /^(id|password|passwordHash|token|secret|permissions|moduleAccess|expectedUpdatedAt|version|.*Id|.*Ids)$/i;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter(
    (k) =>
      !hidden.test(k) &&
      rows.some((r) => {
        const v = (r as Record<string, unknown>)[k];
        return (
          v !== null &&
          v !== undefined &&
          (typeof v !== "object" ||
            v instanceof Date ||
            (Array.isArray(v) && v.every((x) => typeof x === "string")))
        );
      }),
  );
  const header = (k: string) =>
    k === "title" || k === "name"
      ? "Name"
      : k
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/^./, (s) => s.toUpperCase());
  const first = rows[0] as { kind?: string; company?: string } | undefined;
  const companies = [
    ...new Set(
      rows.map((r) => (r as { company?: string }).company).filter(Boolean),
    ),
  ];
  return {
    title:
      first?.kind && labels[first.kind as Module]
        ? labels[first.kind as Module]
        : fallback.replace(/^./, (s) => s.toUpperCase()),
    headers: keys.map(header),
    rows: rows.map((row) =>
      keys.map((k) => {
        const v = (row as Record<string, unknown>)[k];
        if (k === "company" && typeof v === "string") return companyName(v);
        if (
          typeof v === "string" &&
          /^(createdAt|updatedAt|due|date|at|firstJoined|lastLeft)$/.test(k) &&
          /^\d{4}-\d\d-\d\d/.test(v)
        )
          return new Date(v);
        if (Array.isArray(v)) return v.join(", ");
        return v as ExportCell;
      }),
    ),
    company:
      companies.length === 1
        ? companyName(companies[0]!)
        : "Multiple permitted companies",
  };
}
export function downloadTable(data: TableExport) {
  const bytes = tableWorkbook(data),
    url = URL.createObjectURL(
      new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
  const link = document.createElement("a");
  link.href = url;
  link.download = tableExportFilename(data.title, data.exportedBy, data.at);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
