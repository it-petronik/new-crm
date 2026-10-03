"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/controls";
import type { RecordItem } from "@/lib/domain";
import { companyCore } from "@/lib/commercial/model";

/**
 * Guidance shown while a record is being created, so a duplicate is noticed
 * before the form is finished rather than after. It never blocks typing and
 * never merges anything: it offers the existing record, and the person
 * decides.
 */

export type CustomerMatch = { id: string; title: string; place?: string; reasons: string[] };

/** Reasons strong enough to ask for an explicit choice before creating. */
const STRONG = ["Same normalized name", "Same email"];
export const isStrongMatch = (m: CustomerMatch) => m.reasons.some((r) => STRONG.includes(r));

const reasonText: Record<string, string> = {
  "Same normalized name": "Same name",
  "Same name apart from legal form": "Same name (without LLC, Ltd…)",
  "Same email": "Same email",
  "Same phone": "Same phone",
  "Same business email domain": "Same email domain",
};

/**
 * Possible existing customers for what has been typed so far. Debounced, and
 * only asked once there is enough to compare; the server answers from the
 * records this person may already read, in the target company and branch.
 */
export function useCustomerMatches(
  enabled: boolean,
  query: { company: string; branch: string; title: string; email: string; phone: string },
) {
  const [matches, setMatches] = useState<CustomerMatch[]>([]);
  const { company, branch, title, email, phone } = query;
  useEffect(() => {
    const enough = title.trim().length >= 3 || email.includes("@") || phone.replace(/\D/g, "").length >= 7;
    if (!enabled || !enough) {
      setMatches([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ view: "duplicates", company, branch, title, email, phone });
      fetch(`/api/commercial?${params}`, { signal: controller.signal, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { duplicates: [] }))
        .then((d) => setMatches(Array.isArray(d.duplicates) ? d.duplicates : []))
        .catch(() => {});
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, company, branch, title, email, phone]);
  return matches;
}

export function openExisting(record: { id: string; kind: string }) {
  window.dispatchEvent(new CustomEvent("enercore:open-record", { detail: record }));
}

export function CustomerMatches({
  matches,
  acknowledged,
  onAcknowledge,
  onOpen,
}: {
  matches: CustomerMatch[];
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  onOpen: (id: string) => void;
}) {
  if (!matches.length) return null;
  const strong = matches.some(isStrongMatch);
  return (
    <section className="form-guidance field-wide" role="status" aria-live="polite" aria-label="Possible existing customers">
      <p className="form-guidance-title">{matches.length === 1 ? "This customer may already exist" : "These customers may already exist"}</p>
      <ul>
        {matches.map((m) => (
          <li key={m.id}>
            <span className="form-guidance-name">
              <b>{m.title}</b>
              {m.place && <span> · {m.place}</span>}
              <small>
                {m.reasons
                  .filter((r) => !(r === "Same business email domain" && m.reasons.includes("Same email")))
                  .map((r) => reasonText[r] || r)
                  .join(" · ")}
              </small>
            </span>
            <Button type="button" className="secondary compact" onClick={() => onOpen(m.id)}>
              Use existing
            </Button>
          </li>
        ))}
      </ul>
      {strong && (
        <label className="form-guidance-confirm">
          <input type="checkbox" checked={acknowledged} onChange={(e) => onAcknowledge(e.target.checked)} />
          It is a different company — create a separate customer
        </label>
      )}
    </section>
  );
}

const open = (r: RecordItem) => !["Won", "Lost"].includes(r.status);
export type LeadMatch = { record: RecordItem; sameContact: boolean };
/**
 * Active leads for the same customer (and product, once one is known: by id
 * when both have one, otherwise by name). Read from the records this person
 * already sees, so nothing new is disclosed. A lead with a different contact
 * is related context, not a duplicate. Repeat business is legitimate: this
 * only informs.
 */
export function activeLeadMatches(
  records: RecordItem[],
  lead: { customerId?: string | null; contactId?: string | null; productId?: string | null; title: string; product: string },
): LeadMatch[] {
  const core = companyCore(lead.title);
  const product = lead.product.trim().toLowerCase();
  return records
    .filter((r) => r.kind === "leads" && open(r))
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

export function LeadMatches({ leads, onOpen, onDismiss }: { leads: LeadMatch[]; onOpen: (r: RecordItem) => void; onDismiss: () => void }) {
  if (!leads.length) return null;
  const direct = leads.some((l) => l.sameContact);
  return (
    <section className="form-guidance field-wide" role="status" aria-live="polite" aria-labelledby="lead-matches-title">
      <p className="form-guidance-title" id="lead-matches-title">
        {direct
          ? leads.length === 1 ? "An active lead for this customer already exists" : "Active leads for this customer already exist"
          : "Related: this customer has an active lead with another contact"}
      </p>
      <ul>
        {leads.map(({ record: r, sameContact }) => (
          <li key={r.id}>
            <span className="form-guidance-name">
              <b>{r.product || r.title}</b>
              <small>
                {[r.status, r.owner && `Owner ${r.owner}`, r.due && `Follow-up ${r.due}`, !sameContact && r.contact && `Contact ${r.contact}`]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
            <Button type="button" className="secondary compact" onClick={() => onOpen(r)}>
              Open existing
            </Button>
          </li>
        ))}
      </ul>
      <Button type="button" className="ghost compact form-guidance-dismiss" onClick={onDismiss}>
        Create another lead
      </Button>
    </section>
  );
}
