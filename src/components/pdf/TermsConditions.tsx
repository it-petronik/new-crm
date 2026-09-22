import type { DocumentTypeConfig } from "@/config/document-templates";
import type { DocumentData } from "@/types/document";
import { TermsBody } from "./TermsBody";
import { isEmptyTerms } from "@/lib/pdf/plain-terms";

export function TermsConditions({
  doc,
  config,
}: {
  doc: DocumentData;
  config: DocumentTypeConfig;
}) {
  const customText = doc.termsText?.trim() ?? "";
  const notes = doc.notes?.trim() ?? "";
  const hasTerms = !isEmptyTerms(customText);
  const hasNotes = notes.length > 0;

  // No static fallback — omit the whole section when the document has no terms/notes.
  if (!hasTerms && !hasNotes) return null;
  if (!config.showTerms && !hasNotes) return null;

  return (
    <div className="pdf-terms">
      {hasTerms && (
        <>
          <h2
            className="mb-3 text-base font-bold uppercase"
            style={{ color: "var(--pdf-heading)" }}
          >
            Terms and Conditions
          </h2>
          <TermsBody text={customText} />
        </>
      )}

      {hasNotes && (
        <p className={hasTerms ? "mt-4 text-[11px]" : "text-[11px]"}>
          <span className="text-slate-500">Notes: </span>
          <span className="font-semibold whitespace-pre-line text-black">
            {notes}
          </span>
        </p>
      )}
    </div>
  );
}
