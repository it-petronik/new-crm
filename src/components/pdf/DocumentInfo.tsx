import type { DocumentTypeConfig } from "@/config/document-templates";
import type { DocumentData } from "@/types/document";
import { formatPdfDate } from "@/lib/pdf/format-pdf-date";

/** Renders the configured date fields plus delivery terms/destination as a full-width two-column grid. */
export function DocumentInfo({
  doc,
  config,
}: {
  doc: DocumentData;
  config: DocumentTypeConfig;
}) {
  const dateFields = config.dateFields.filter((f) => doc.dates[f.key]);
  const entries = [
    ...dateFields.map((f) => ({
      label: f.label,
      value: formatPdfDate(doc.dates[f.key]),
    })),
    ...(doc.deliveryTerms
      ? [{ label: "Delivery Terms", value: doc.deliveryTerms }]
      : []),
    ...(doc.deliveryTo
      ? [{ label: "Delivery To", value: doc.deliveryTo }]
      : []),
  ];

  if (entries.length === 0) return null;

  return (
    <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-[11px]">
      {entries.map((e) => (
        <div key={e.label}>
          <p className="text-slate-500">{e.label}</p>
          <p className="mt-0.5 font-semibold text-black">{e.value}</p>
        </div>
      ))}
    </div>
  );
}
