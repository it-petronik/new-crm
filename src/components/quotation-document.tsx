import { money, type RecordItem } from "@/lib/domain";
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

/**
 * What a phone needs before the A4 preview: who it is for, what, how much and
 * until when. Read from the same quotationData() the printed document uses, so
 * the two can never disagree. Screen only; print is the document alone.
 */
export function QuotationSummary({ record }: { record: RecordItem }) {
  const data = quotationData(record);
  return (
    <dl className="quotation-summary" aria-label="Quotation summary">
      <div className="is-wide">
        <dt>Customer</dt>
        <dd>{data.to.name}</dd>
      </div>
      <div className="is-wide">
        <dt>{data.items.length === 1 ? "Product" : "Products"}</dt>
        <dd>
          {data.items.map((item) => (
            <span key={item.id}>
              {item.name || "Product not specified"} · {item.quantity.toLocaleString("en-US")} {item.unit}
            </span>
          ))}
        </dd>
      </div>
      <div>
        <dt>Total</dt>
        <dd className="quotation-summary-total e-numeric">
          {money(data.totals.total, data.totals.currency)}
        </dd>
      </div>
      <div>
        <dt>Valid until</dt>
        <dd>{data.dates.expiryDate || "Not set"}</dd>
      </div>
      {data.deliveryTerms && (
        <div>
          <dt>Incoterm</dt>
          <dd>{data.deliveryTerms}</dd>
        </div>
      )}
      <div>
        <dt>Reference</dt>
        <dd className="record-reference">{data.refNo}</dd>
      </div>
    </dl>
  );
}
