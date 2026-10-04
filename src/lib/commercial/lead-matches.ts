import type { RecordItem } from "../domain";
import { companyCore } from "./model";

export type LeadMatch = { record: RecordItem; sameContact: boolean };
/** Possible active matches in already-visible records. Never merges identities. */
export function activeLeadMatches(
  records: RecordItem[],
  lead: { customerId?: string | null; contactId?: string | null; productId?: string | null; title: string; product: string },
): LeadMatch[] {
  const core = companyCore(lead.title);
  const product = lead.product.trim().toLowerCase();
  return records
    .filter((r) => r.kind === "leads" && !["Won", "Lost"].includes(r.status))
    .filter((r) => (lead.customerId ? r.customerId === lead.customerId : core.length >= 3 && companyCore(r.title) === core))
    .filter((r) =>
      lead.productId && r.productId
        ? r.productId === lead.productId
        : !product || (r.product || "").toLowerCase().includes(product) || product.includes((r.product || "~").toLowerCase()),
    )
    .map((r) => ({ record: r, sameContact: !lead.contactId || !r.contactId || r.contactId === lead.contactId }))
    .sort((a, b) => Number(b.sameContact) - Number(a.sameContact))
    .slice(0, 3);
}
