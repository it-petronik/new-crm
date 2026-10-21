import { isProforma, money, type RecordItem } from "@/lib/domain";
import { proformaData } from "@/lib/pdf/proforma-data";
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
  Petronik: { accent: "#5ad5dc", heading: "#096473" },
  Petronex: { accent: "#f5c451", heading: "#775214" },
  Afrilube: { accent: "#8fd99a", heading: "#22663b" },
  Istanegry: { accent: "#c4b5f5", heading: "#5b3fa0" },
  Enercore: { accent: "#64d9e5", heading: "#124660" },
};
export function QuotationDocument({ record, connected = false }: { record: RecordItem; connected?: boolean }) {
  const proforma = isProforma(record);
  const data = proforma ? proformaData(record, connected) : quotationData(record, connected);
  const footerColor = themes[record.company]?.heading || "#18354a";
  const cssText = (text: string) => JSON.stringify(text.replace(/\s+/g, " ").trim()).replaceAll("<", "\\3c ");
  const thanks = cssText(data.footerMessage || "");
  const contacts = cssText([data.footerContacts?.phone && `Tel: ${data.footerContacts.phone}`, data.footerContacts?.email && `Email: ${data.footerContacts.email}`, data.footerWebsite || record.company].filter(Boolean).join(" · "));
  // Each row owns its vertical geometry: centering two generated lines inside
  // a gradient leaves unequal ink padding. Paint one solid contact band, with
  // an independently centered thank-you above it and transparent page counter.
  const footerBackground = `color-mix(in srgb, ${footerColor} 10%, white)`;
  const footerType = `color: ${footerColor}; font: 8.5px Arial, sans-serif; line-height: 1.3; white-space: nowrap; vertical-align: middle; -webkit-print-color-adjust: exact; print-color-adjust: exact;`;
  // A 0.25mm optical baseline correction balances visible ink (including
  // company contacts with no descenders), not merely the font's line box.
  const footerBand = `height: 6.5mm; margin-top: 11mm; margin-bottom: 4mm; padding: .5mm 0 0; ${footerType}`;
  return (
    <article className="reference-document" aria-label={proforma ? "Customer proforma document" : "Quotation document"}>
      <style>{styles}</style>
      <style>{`@media print { @page { size: A4; margin: 9mm 9mm 22mm; @top-left { content: ""; } @top-center { content: ""; } @top-right { content: ""; }
        @bottom-left { content: ${thanks}; width: 192mm; margin-right: -192mm; height: 6mm; margin-top: 5mm; margin-bottom: 11mm; padding: 0; text-align: center; background: transparent; ${footerType} }
        @bottom-center { content: ${contacts}; width: 192mm; text-align: center; background: ${footerBackground}; ${footerBand} }
        @bottom-right { content: "Page " counter(page) " of " counter(pages); width: 25mm; margin-left: -28mm; text-align: right; background: transparent; position: relative; z-index: 1; ${footerBand} padding-right: 3mm; }
      } @page:first { margin-top: 9mm; }
        /* Fixed print decorations repeat per sheet, including continuation
           pages. Keep clear of both the letterhead and page-margin footer. */
        .reference-document .pdf-brand-watermark { position: fixed; top: 85mm; }
        .reference-document .pdf-brand-watermark--petronik { top: 65mm; }
      }`}</style>
      <div data-print-document>
        <DocumentTemplate
          type={proforma ? "proforma" : "quotation"}
          data={data}
          theme={{
            ...themes[record.company],
            panel: "#f1f5f9",
            tableHeader: "#18354a",
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
