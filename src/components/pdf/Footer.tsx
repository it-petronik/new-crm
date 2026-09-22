import type { DocumentTypeConfig } from "@/config/document-templates";
import type { DocumentData } from "@/types/document";

/**
 * Screen-preview website band. Printing replaces it with a company website
 * and page counter in the reserved bottom margin on every sheet.
 */
export function Footer({
  doc,
  config,
}: {
  doc: DocumentData;
  config: DocumentTypeConfig;
}) {
  return (
    <div
      className="pdf-footer-band grid h-[14mm] grid-cols-[1fr_auto_1fr] items-center text-[10px] text-slate-500"
      style={{ backgroundColor: "var(--pdf-panel)" }}
    >
      <span aria-hidden className="block" />
      <span className="text-center">
        {doc.footerWebsite || config.footerWebsite}
      </span>
      <span aria-hidden className="block" />
    </div>
  );
}
