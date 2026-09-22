import type { DocumentTypeConfig } from "@/config/document-templates";
import type { DocumentData } from "@/types/document";

function fmt(n: number) {
  return n.toLocaleString("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Always rendered immediately after the last item row (never pinned to page
 * bottom), so it naturally lands on whichever page the table ends on.
 */
export function Totals({
  doc,
  config,
}: {
  doc: DocumentData;
  config: DocumentTypeConfig;
}) {
  const { totals } = doc;
  const cur = totals.currency;

  return (
    <div className="flex break-inside-avoid justify-end">
      <div className="w-82.5">
        <div className="flex justify-between border-b py-2.5">
          <span className="font-medium">Subtotal</span>
          <span className="font-semibold">
            {cur} {fmt(totals.subtotal)}
          </span>
        </div>

        {config.showVat && totals.vatAmount != null && (
          <div className="flex justify-between border-b py-2.5">
            <span className="font-medium">VAT {totals.vatRate ?? 5}%</span>
            <span className="font-semibold">
              {cur} {fmt(totals.vatAmount)}
            </span>
          </div>
        )}

        <div
          className="mt-2.5 flex justify-between rounded px-4 py-3 text-base font-bold text-white"
          style={{ backgroundColor: "var(--pdf-accent)" }}
        >
          <span>Total Amount</span>
          <span>
            {cur} {fmt(totals.total)}
          </span>
        </div>

        {!!totals.amountPaid && totals.amountPaid > 0 && (
          <>
            <div className="mt-2.5 flex justify-between py-2 text-sm">
              <span className="font-medium text-slate-500">Amount Paid</span>
              <span className="font-semibold">
                {cur} {fmt(totals.amountPaid)}
              </span>
            </div>
            <div className="flex justify-between py-2 text-sm">
              <span className="font-medium text-slate-500">Balance Due</span>
              <span className="font-semibold">
                {cur} {fmt(Math.max(0, totals.total - totals.amountPaid))}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
