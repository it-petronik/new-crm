import { allowedModules, type Actor, type RecordItem } from "./domain";
import { companyName } from "./company-name";
import { acknowledged, buyerInquiry, leadSummary, leadType, qualificationMissing } from "./lead-desk";
import { toCsv } from "./export";

type Summary = ReturnType<typeof leadSummary>;
type Group = { id: string; name: string; data: Summary };

/** Shared definitions for the on-screen metrics and the downloaded report. */
export function leadReportMetrics(actor: Actor, summary: Summary): [string, string][] {
  const modules = allowedModules(actor);
  return [
    ["Buyer inquiries", String(summary.inquiries)],
    ["Qualified inquiries", String(summary.qualified)],
    ["Quotations sent", modules.includes("quotations") ? String(summary.quotations) : "Restricted"],
    ["Confirmed conversions", modules.includes("orders")
      ? `${summary.converted} · ${summary.conversion === null ? "—" : `${summary.conversion}%`}` : "Restricted"],
    ["Awaiting feedback", String(summary.pending)],
    ["Overdue follow-ups", String(summary.overdue)],
    ["No next action", String(summary.noNextAction)],
    ["Median first response", summary.responseMinutes === null ? "Unknown" : `${Math.round(summary.responseMinutes)} min`],
    ["Needs assignment", String(summary.awaitingAllocation)],
    ["New inquiries", String(summary.newInquiries)],
  ];
}

/** Reapply access checks even when a caller supplies an unscoped array.
 * Owner IDs, not names, keep two employees with the same name separate.
 * Zero-lead brands are included only when explicitly in the allowed scope. */
export function leadReportGroups(actor: Actor, records: RecordItem[], from = "", to = "", brands: string[] = []) {
  const summary = leadSummary(actor, records, from, to);
  const definitions: [string, (r: RecordItem) => [string, string]][] = [
    ["By brand", r => [r.company, companyName(r.company)]],
    ["By product / grade", r => {
      const name = [r.product || "Not yet known", r.attributes?.grade].filter(Boolean).join(" · ");
      return [name, name];
    }],
    ["By owner", r => [r.ownerId || "unassigned", r.owner || "No owner"]],
    ["By source", r => [r.source || "Not recorded", r.source || "Not recorded"]],
  ];
  return definitions.map(([title, key]) => {
    const buckets = new Map<string, { name: string; ids: Set<string> }>();
    if (title === "By brand") for (const brand of brands)
      if (actor.companies.includes(brand)) buckets.set(brand, { name: companyName(brand), ids: new Set() });
    for (const lead of summary.leads) {
      const [id, name] = key(lead);
      if (!buckets.has(id)) buckets.set(id, { name, ids: new Set() });
      buckets.get(id)!.ids.add(lead.id);
    }
    const groups: Group[] = [...buckets].map(([id, { name, ids }]) => ({
      id, name,
      data: leadSummary(actor, records.filter(r => r.kind !== "leads" || ids.has(r.id)), from, to),
    })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { title, groups };
  });
}

/** Export the selected creation cohort, not only the current ten-row queue.
 * Provider delivery, SLA compliance and staff attendance are not inferred. */
export function leadAccountabilityCsv(actor: Actor, records: RecordItem[], options: {
  from?: string; to?: string; scope?: string; asOf?: string;
  brands?: string[]; filters?: [string, string][];
} = {}) {
  const { from = "", to = "", scope = "Allowed brands", asOf = "Fictional preview", brands = [], filters = [] } = options;
  const summary = leadSummary(actor, records, from, to);
  const modules = allowedModules(actor);
  const groupHeader = ["Group", "Group ID", "Captured leads", "Buyer inquiries", "New inquiries", "Qualified inquiries", "Quotations sent", "Confirmed conversions", "Conversion %", "Needs assignment", "Awaiting feedback", "Overdue follow-ups", "No next action", "Median first response (min)", "Response samples", "Buyer prospects", "Supplier opportunities"];
  return toCsv([
    ["Report", "Lead accountability", "From", from || "All dates", "To", to || "All dates", "Scope", scope, "As of", asOf],
    ["Coverage", "All matching leads; not limited to the selected work queue or page"],
    ...filters,
    ...leadReportMetrics(actor, summary),
    ["Response samples", summary.responseSamples, "Response basis", "Staff-reported contact; known receipt timestamps only; elapsed minutes, not business-hour SLA"],
    ["Definitions", "Buyer inquiries exclude prospects and supplier opportunities. Conversions require linked confirmed orders; Won alone is not a conversion."],
    ["Assignment basis", "Known non-sales owners and missing owners need allocation. Legacy owner roles without evidence are not assumed."],
    ...leadReportGroups(actor, records, from, to, brands).flatMap(({ title, groups }) => [
      [], [title], groupHeader,
      ...groups.map(({ id, name, data }) => [
        name, id, data.leads.length, data.inquiries, data.newInquiries, data.qualified,
        modules.includes("quotations") ? data.quotations : "Restricted",
        modules.includes("orders") ? data.converted : "Restricted",
        modules.includes("orders") ? data.conversion ?? "Unknown" : "Restricted",
        data.awaitingAllocation, data.pending, data.overdue, data.noNextAction,
        data.responseMinutes === null ? "Unknown" : Math.round(data.responseMinutes), data.responseSamples,
        data.prospects, data.suppliers,
      ]),
    ]),
    [], ["Lead details"],
    ["Reference", "Lead", "Company", "Type", "Source", "Product", "Grade", "Quantity", "Unit", "Destination / port", "Contact", "Email", "Phone", "Owner", "Owner ID", "Status", "Created", "Captured by", "Next follow-up", "Acknowledged", "Latest outcome", "Feedback by", "Feedback time", "Reason / update", "Received at", "First response at", "Missing qualification details"],
    ...summary.leads.map(r => [
      r.id, r.title, companyName(r.company), leadType(r), r.source, r.product, r.attributes?.grade || "",
      r.quantity, r.unit, r.destination || "", r.contact, r.email || "", r.phone || "", r.owner, r.ownerId,
      r.status, r.createdAt, r.attributes?.leadCapturedBy || "Unknown", r.due,
      acknowledged(r) ? "Yes" : "No", r.attributes?.leadOutcome || "No feedback", r.attributes?.leadFeedbackBy || "",
      r.attributes?.leadFeedbackAt || "", r.attributes?.leadFeedbackNote || "", r.attributes?.leadReceivedAt || "Unknown",
      r.attributes?.leadFirstResponseAt || "Unknown",
      buyerInquiry(r) ? qualificationMissing(r).join("; ") : "Not a buyer inquiry",
    ]),
  ]);
}
