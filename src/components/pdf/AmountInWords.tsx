import { amountInWords } from "@/lib/quotation";
import type { DocumentData } from "@/types/document";

export function AmountInWords({ doc, referenceFieldsOnly = false }: { doc: DocumentData; referenceFieldsOnly?: boolean }) {
  const words =
    doc.totals.amountInWords ||
    amountInWords(Math.round(doc.totals.total * 100), doc.totals.currency);
  // Capitalize word and hyphenated-word initials without lowercasing currency
  // abbreviations (US, AED, USD) or changing the actual financial amount.
  const capitalizedWords = words.replace(/\b[a-z]/g, letter => letter.toUpperCase());
  return <div className={referenceFieldsOnly ? "pdf-amount-words" : "text-right text-slate-500"}>{referenceFieldsOnly && <p className="text-slate-500">Amount in words</p>}<p>{capitalizedWords}</p></div>;
}
