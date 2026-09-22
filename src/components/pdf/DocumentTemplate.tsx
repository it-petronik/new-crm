import type { CSSProperties } from "react";
import { documentConfig } from "@/config/document-templates";
import type { DocumentData, DocumentType } from "@/types/document";
import { isEmptyTerms } from "@/lib/pdf/plain-terms";
import { AmountInWords } from "./AmountInWords";
import { BankDetails } from "./BankDetails";
import { DocumentInfo } from "./DocumentInfo";
import { Footer } from "./Footer";
import { Header, type PdfTheme } from "./Header";
import { ItemsTable } from "./ItemsTable";
import { PartySection } from "./PartySection";
import { Signature } from "./Signature";
import { Totals } from "./Totals";
import { TermsConditions } from "./TermsConditions";

const DEFAULT_THEME: PdfTheme = {
  accent: "#1e3a5f",
  heading: "#1e3a5f",
  panel: "#f1f5f9",
  tableHeader: "#334155",
};

export interface DocumentTemplateProps {
  /** Which document to render. Drives the title, visible date fields, and default terms — nothing else changes. */
  type: DocumentType;
  data: DocumentData;
  theme?: Partial<PdfTheme>;
}

/**
 * The single reusable engine behind every printable sales document. Swapping
 * `type` swaps the title, which date fields appear, whether VAT/bank/terms
 * render, and the default terms copy — driven entirely by `documentConfig`.
 * No document type has its own component; only its own config entry.
 *
 * To offer an alternative *look* in future (ModernTemplate, ClassicTemplate,
 * ...), create a sibling component that composes these same building blocks
 * differently — the engine (this file's contract: `type` + `data` in, a
 * printable document out) never has to change.
 */
export function DocumentTemplate({ type, data, theme }: DocumentTemplateProps) {
  const config = documentConfig[type];
  const resolvedTheme = { ...DEFAULT_THEME, ...theme };

  const hasBank = Boolean(config.showBankDetails && data.bankAccount);
  const hasTerms =
    config.showTerms &&
    (!isEmptyTerms(data.termsText) || Boolean(data.notes?.trim()));
  // Additional content follows the commercial block; the print stylesheet
  // paginates naturally rather than forcing short terms onto another sheet.
  const hasSecondarySheet = hasBank || hasTerms;

  return (
    <div
      className="mx-auto max-w-[210mm] bg-white text-[12.5px] leading-relaxed text-[#1a1a1a] print:max-w-none"
      style={
        {
          "--pdf-accent": resolvedTheme.accent,
          "--pdf-heading": resolvedTheme.heading,
          "--pdf-panel": resolvedTheme.panel,
          "--pdf-table-header": resolvedTheme.tableHeader,
        } as CSSProperties
      }
    >
      <table className="pdf-page-table w-full border-collapse">
        <thead>
          <tr>
            <td className="pdf-top-pad">&nbsp;</td>
          </tr>
        </thead>
        <tbody>
          <tr
            className={
              hasSecondarySheet
                ? "pdf-sheet-row pdf-sheet-row--commercial"
                : "pdf-sheet-row pdf-sheet-row--commercial pdf-sheet-row--commercial-alone"
            }
          >
            <td>
              <div className="pdf-commercial">
                <div
                  className="-mx-[14mm] px-[14mm] pt-5 pb-6"
                  style={{ backgroundColor: "var(--pdf-panel)" }}
                >
                  <Header doc={data} config={config} />
                  <PartySection doc={data} />
                </div>

                <DocumentInfo doc={data} config={config} />

                <div className="mt-4">
                  <ItemsTable doc={data} />
                </div>

                <div className="mt-7">
                  <Totals doc={data} config={config} />
                </div>

                <div className="mt-3">
                  <AmountInWords doc={data} />
                </div>

                {!hasSecondarySheet && (
                  <div className="pdf-sign-block mt-6">
                    <Signature doc={data} />
                    <p className="mt-6 text-[10px] text-slate-400">
                      Generated electronically by {data.from.name} - no physical
                      signature required unless otherwise agreed.
                    </p>
                  </div>
                )}
              </div>
            </td>
          </tr>

          {hasSecondarySheet && (
            <tr className="pdf-sheet-row pdf-sheet-row--terms">
              <td>
                <div className="pdf-terms-sign flex flex-col gap-5">
                  {hasBank && (
                    <div className="pdf-bank-block mb-3">
                      <BankDetails doc={data} />
                    </div>
                  )}
                  {hasTerms && <TermsConditions doc={data} config={config} />}
                  <div className="pdf-sign-block">
                    <Signature doc={data} />
                    <p className="mt-6 text-[10px] text-slate-400">
                      Generated electronically by {data.from.name} - no physical
                      signature required unless otherwise agreed.
                    </p>
                  </div>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <Footer doc={data} config={config} />
    </div>
  );
}
