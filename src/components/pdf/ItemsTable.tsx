import type { DocumentData } from "@/types/document";

function fmt(n: number) {
  return n.toLocaleString("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Unlimited-row line-items table. `thead` uses `table-header-group` so Chromium's
 * print pagination repeats the header on every page the table spans, and every
 * `tr` is `break-inside-avoid` so a row is never split across a page boundary.
 */
export function ItemsTable({ doc, referenceFieldsOnly = false }: { doc: DocumentData; referenceFieldsOnly?: boolean }) {
  const separateItem = referenceFieldsOnly || doc.items.some(item => item.description);
  return (
    <table className="pdf-items w-full border-collapse">
      <colgroup>{(separateItem ? [6,20,12,12,12,18,20] : [6,28,14,14,18,20]).map((width,index) => <col key={index} style={{width:`${width}%`}} />)}</colgroup>
      <thead className="table-header-group">
        <tr
          className="break-inside-avoid text-[11px] text-white"
          style={{ backgroundColor: "var(--pdf-table-header)" }}
        >
          <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">
            {referenceFieldsOnly ? "SI NO" : "Sr. #"}
          </th>
          {separateItem && <th className="px-3 py-3 text-left font-semibold">{referenceFieldsOnly ? "Item #" : "Item / category"}</th>}
          <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">
            Description
          </th>
          <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">
            Packaging
          </th>
          <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">
            {referenceFieldsOnly ? `QTY ${doc.items[0]?.unit || ""}`.trim() : "Quantity"}
          </th>
          <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">
            Unit Price ({doc.totals.currency})
          </th>
          <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">
            {referenceFieldsOnly ? "Total" : "Total Amount"}
          </th>
        </tr>
      </thead>

      <tbody>
        {doc.items.map((item, index) => (
          <tr
            key={item.id}
            className="break-inside-avoid border-b border-slate-200"
          >
            <td className="px-4 py-4 text-center">{index + 1}</td>
            {separateItem && <td className="px-4 py-4 font-medium">{item.description ? item.name : ""}</td>}
            <td className="px-4 py-4">
              <span className="font-medium">{separateItem ? item.description || item.name : item.name}</span>
            </td>
            <td className="px-4 py-4 text-center">{item.packaging || "—"}</td>
            <td className="px-4 py-4 text-center">
              {fmt(item.quantity)} {item.unit || ""}
            </td>
            <td className="px-4 py-4 text-center tabular-nums">
              {fmt(item.unitPrice)}
            </td>
            <td className="px-4 py-4 text-center font-medium tabular-nums">
              {fmt(item.lineTotal)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
