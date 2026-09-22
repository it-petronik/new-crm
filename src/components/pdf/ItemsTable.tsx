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
export function ItemsTable({ doc }: { doc: DocumentData }) {
  return (
    <table className="w-full border-collapse">
      <thead className="table-header-group">
        <tr
          className="break-inside-avoid text-[11px] text-white"
          style={{ backgroundColor: "var(--pdf-table-header)" }}
        >
          <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">
            Sr. #
          </th>
          <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">
            Description
          </th>
          <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">
            Packaging
          </th>
          <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">
            Quantity
          </th>
          <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">
            Unit Price ({doc.totals.currency})
          </th>
          <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">
            Total Amount
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
            <td className="px-4 py-4">
              <span className="font-medium">{item.name}</span>
              {item.description && (
                <span className="block text-slate-500">{item.description}</span>
              )}
            </td>
            <td className="px-4 py-4 text-center">{item.packaging || "—"}</td>
            <td className="px-4 py-4 text-center">
              {item.quantity} {item.unit || ""}
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
