import type { DocumentTypeConfig } from "@/config/document-templates";
import type { DocumentData } from "@/types/document";
import { ContactLink } from "./ContactLink";

/**
 * One screen footer group keeps the thank-you attached to the contact band.
 * Print reproduces both rows in reserved page-margin boxes.
 */
export function Footer({
  doc,
  config,
}: {
  doc: DocumentData;
  config: DocumentTypeConfig;
}) {
  return (
    <footer className="pdf-footer-group">
    {doc.footerMessage && <p className="pdf-thank-you">{doc.footerMessage}</p>}
    <div
      className="pdf-footer-band text-[10px] text-slate-500"
      style={{ backgroundColor: "color-mix(in srgb, var(--pdf-heading) 10%, white)", color: "var(--pdf-heading)" }}
    >
      <div className="pdf-footer-contacts" aria-label="Company contact details">
        {doc.footerContacts?.phone && <span>Tel: <ContactLink kind="phone" value={doc.footerContacts.phone} /></span>}
        {doc.footerContacts?.email && <span>Email: <ContactLink kind="email" value={doc.footerContacts.email} /></span>}
        {(doc.footerWebsite ?? config.footerWebsite) && <ContactLink kind="website" value={doc.footerWebsite ?? config.footerWebsite} />}
      </div>
    </div>
    </footer>
  );
}
