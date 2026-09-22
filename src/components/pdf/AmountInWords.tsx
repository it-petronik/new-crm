import { amountInWords } from "@/lib/quotation";
import type { DocumentData } from "@/types/document";

export function AmountInWords({ doc }: { doc: DocumentData }) {
  const words =
    doc.totals.amountInWords ||
    amountInWords(Math.round(doc.totals.total * 100), doc.totals.currency);
  return <div className="text-right text-slate-500">{words}</div>;
}
