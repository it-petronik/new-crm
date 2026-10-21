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
  const deliveryTerms = config.referenceFieldsOnly ? [doc.deliveryTerms, doc.deliveryTo].filter(Boolean).join("\n") : doc.deliveryTerms;
  const entries = [
    ...(doc.extraInfo || []),
    ...dateFields.map((f) => ({
      label: f.label,
      value: formatPdfDate(doc.dates[f.key]),
    })),
    ...(deliveryTerms
      ? [{ label: "Delivery Terms", value: deliveryTerms }]
      : []),
    ...(doc.deliveryTo && !config.referenceFieldsOnly
      ? [{ label: "Delivery To", value: doc.deliveryTo }]
      : []),
    ...(doc.paymentTerms ? [{ label: "Payment terms", value: doc.paymentTerms }] : []),
  ];

  if (entries.length === 0) return null;

  return (
    <div className="pdf-info-grid mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-[11px]">
      {entries.map((e) => (
        <div key={e.label}>
          <p className="text-slate-500">{e.label}</p>
          <p className="mt-0.5 font-semibold text-black">{e.value}</p>
        </div>
      ))}
    </div>
  );
}
