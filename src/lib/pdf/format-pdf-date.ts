/** Formats an ISO date string as "24 June 2026" for print documents, in Asia/Dubai time. */
export function formatPdfDate(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Dubai",
  });
}
