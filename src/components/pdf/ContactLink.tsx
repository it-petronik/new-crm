import { documentContactLink } from "@/lib/pdf/contact-link";

export function ContactLink({ kind, value }: { kind: "email" | "phone" | "website"; value: string }) {
  const href = documentContactLink(kind, value);
  // No business value is rewritten for display or made into an unsafe URL.
  return href ? <a className="pdf-contact-link" href={href} {...(kind === "website" ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{value}</a> : <span>{value}</span>;
}
