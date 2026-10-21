import type { DocumentTypeConfig } from "@/config/document-templates";
import type { DocumentData } from "@/types/document";

export interface PdfTheme {
  accent: string;
  heading: string;
  panel: string;
  tableHeader: string;
}

/** Ref-number badge, printed title (driven by config), and letterhead logo. */
export function Header({
  doc,
  config,
}: {
  doc: DocumentData;
  config: DocumentTypeConfig;
}) {
  return (
    <div className="pdf-header flex items-start justify-between">
      <div>
        <div
          className="pdf-reference inline-flex rounded border bg-white px-2 py-0.5 text-[11px] font-bold"
          style={{
            borderColor: "var(--pdf-accent)",
            color: "var(--pdf-heading)",
          }}
        >
          {config.refLabel} {doc.refNo}
        </div>

        <h1 className="mt-2 text-3xl font-bold tracking-tight text-black">
          {config.title}
        </h1>
      </div>

      {doc.from.logoUrl && (
        <img
          src={doc.from.logoUrl}
          alt={doc.from.name}
          loading="eager"
          className="pdf-company-logo object-contain"
        />
      )}
    </div>
  );
}
