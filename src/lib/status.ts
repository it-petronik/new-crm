/**
 * One meaning for every CRM status.
 *
 * The same business state must look the same everywhere: "Delayed" cannot be
 * amber on one page and red on another, because the colour is the thing people
 * read first. Each status maps to a semantic tone once, here, and every badge
 * in the application derives from this map.
 *
 * Tone is never the only signal — the badge always shows its text, and carries
 * a shape as well as a colour — so the meaning survives for anyone who cannot
 * distinguish the colours.
 */

export type Tone = "neutral" | "info" | "active" | "success" | "warning" | "danger";

const TONES: Record<Tone, string[]> = {
  // Nothing has happened yet, or the record is simply closed.
  neutral: ["New", "Draft", "Planned", "Inactive", "Offboarding", "Cancelled", "Recorded", "On Request"],
  // In hand and progressing.
  active: ["Contacted", "Qualified", "In Progress", "In Transit", "Confirmed", "Active", "Available", "Picked Up", "On Leave"],
  // Waiting on someone else.
  info: ["Quote Sent", "Sent", "Open", "Pending Planning", "Awaiting Collection", "Partially Paid", "Documents Pending", "Ready to Dispatch"],
  // Needs a decision or is slipping.
  warning: ["Negotiation", "Pending Approval", "On Hold", "Credit Hold", "Low Stock", "Expiring"],
  // Concluded well.
  success: ["Won", "Accepted", "Paid", "Delivered", "Completed", "Approved", "Resolved"],
  // Money or goods are late, or the record failed.
  danger: ["Lost", "Overdue", "Delayed", "Rejected", "Declined", "Expired"],
};

const BY_STATUS = new Map<string, Tone>();
for (const [tone, statuses] of Object.entries(TONES) as [Tone, string[]][])
  for (const status of statuses) BY_STATUS.set(status.toLowerCase(), tone);

/** An unmapped status reads as neutral rather than inventing a colour. */
export const statusTone = (status: string): Tone =>
  BY_STATUS.get(String(status || "").trim().toLowerCase()) ?? "neutral";

/** Every status the map knows, for tests and audits. */
export const knownStatuses = () => [...BY_STATUS.keys()];
