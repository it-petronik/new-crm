import { type RecordItem } from "@/lib/domain";
import { quotationData } from "@/lib/pdf/quotation-data";
import { DOCUMENT_PRINT_CSS } from "@/lib/pdf/document-print-css";
import { DocumentTemplate } from "./pdf/DocumentTemplate";
// Scope the imported utility stylesheet so it cannot alter the surrounding CRM.
const styles = DOCUMENT_PRINT_CSS.replace(
  /(^|})(\s*)([^{}]+)\{/g,
  (_match, end, whitespace, selectors: string) =>
    `${end}${whitespace}${selectors
      .split(",")
      .map((selector: string) => `.reference-document ${selector.trim()}`)
      .join(", ")}{`,
);
const themes: Record<string, { accent: string; heading: string }> = {
  Petronik: { accent: "#6ad9e8", heading: "#25a8c9" },
  Petronex: { accent: "#f5c451", heading: "#b8791a" },
  Afrilube: { accent: "#8fd99a", heading: "#1f7a3f" },
  Istanegry: { accent: "#c4b5f5", heading: "#5b3fa0" },
};
export function QuotationDocument({ record }: { record: RecordItem }) {
  const data = quotationData(record);
  const footer = JSON.stringify(
    data.footerWebsite || record.company,
  ).replaceAll("<", "\\3c ");
  return (
    <article className="reference-document" aria-label="Quotation document">
      <style>{styles}</style>
      <style>{`@media print { @page { @bottom-left { content: ${footer}; width: 70%; background: #f1f5f9; color: #64748b; font: 9px sans-serif; padding-left: 14mm; text-align: left; } @bottom-right { width: 30%; background: #f1f5f9; } } }`}</style>
      <div data-print-document>
        <DocumentTemplate
          type="quotation"
          data={data}
          theme={{
            ...themes[record.company],
            panel: "#f1f5f9",
            tableHeader: "#8a8a8a",
          }}
        />
      </div>
    </article>
  );
}
