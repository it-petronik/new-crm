import { z } from "zod";
import {
  canRead,
  canWrite,
  type Actor,
  type RecordItem,
  type Workspace,
} from "./domain";
export { businessToday } from "./gst";
import { businessToday } from "./gst";

export const leadTypes = [
  "Buyer inquiry",
  "Buyer prospect",
  "Supplier prospect",
  "Supplier offer",
] as const;
export const leadOutcomes = [
  "Acknowledged",
  "Contacted",
  "No Answer",
  "Interested",
  "Waiting for Customer",
  "Quotation Needed",
  "Not Relevant",
] as const;
export const leadFeedbackSchema = z
  .object({
    action: z.literal("lead-feedback"),
    id: z.string().min(1).max(100),
    expectedUpdatedAt: z.string().min(1).max(40),
    outcome: z.enum(leadOutcomes),
    note: z.string().trim().max(500).default(""),
    due: z.iso.date().optional(),
  })
  .strict();
export type LeadFeedback = z.infer<typeof leadFeedbackSchema>;
export type LeadFeedbackAction = Omit<LeadFeedback, "id" | "expectedUpdatedAt">;
export const leadSystemKeys = [
  "leadTracking",
  "leadCapturedAt",
  "leadCapturedById",
  "leadCapturedBy",
  "leadCapturedRole",
  "leadReceivedAt",
  "leadOwnerRole",
  "leadAssignedAt",
  "leadAssignedBy",
  "leadAcknowledgedAt",
  "leadAcknowledgedOwnerId",
  "leadFeedbackAt",
  "leadFeedbackBy",
  "leadFeedbackOwnerId",
  "leadOutcome",
  "leadFeedbackNote",
  "leadFirstResponseAt",
  "leadFirstResponseBy",
  "leadQualifiedAt",
];
export const leadSalesRoles = [
  "MD",
  "IT Administrator",
  "Group Manager",
  "Branch Manager",
  "Sales Manager",
  "Sales Executive",
];
export const awaitingAllocation = (r: RecordItem) =>
  openLead(r) &&
  (!r.ownerId || Boolean(r.attributes?.leadOwnerRole &&
    !["Sales Manager", "Sales Executive", "Sales"].includes(r.attributes.leadOwnerRole)));

export function leadType(r: RecordItem) {
  return leadTypes.find((t) => t === r.attributes?.leadType) || "Unclassified";
}
export const buyerInquiry = (r: RecordItem) =>
  r.kind === "leads" && leadType(r) === "Buyer inquiry";
export const supplierOpportunity = (r: RecordItem) =>
  leadType(r).startsWith("Supplier");
export const openLead = (r: RecordItem) =>
  r.kind === "leads" && !r.deletedAt && !["Won", "Lost"].includes(r.status);
export const acknowledged = (r: RecordItem) =>
  Boolean(
    r.attributes?.leadAcknowledgedAt &&
    r.attributes.leadAcknowledgedOwnerId === r.ownerId,
  );
export const needsFeedback = (r: RecordItem) =>
  openLead(r) &&
  (!r.attributes?.leadFeedbackAt ||
    r.attributes.leadFeedbackOwnerId !== r.ownerId);

/** Only real intake knows receipt time. Manual creation must not fabricate it. */
export function initializeLead(
  r: RecordItem,
  creator: { id: string; name: string; role: string },
  options: { imported?: boolean; receivedAt?: string } = {},
) {
  if (r.kind !== "leads") return r;
  const attributes = { ...r.attributes };
  for (const key of leadSystemKeys) delete attributes[key];
  return {
    ...r,
    attributes: {
      ...attributes,
      leadType: [...leadTypes, "Unclassified"].includes(attributes.leadType)
        ? attributes.leadType
        : options.imported
          ? "Buyer prospect"
          : "Buyer inquiry",
      leadTracking: "1",
      leadCapturedAt: r.createdAt,
      leadCapturedById: creator.id,
      leadCapturedBy: creator.name,
      leadCapturedRole: creator.role,
      leadAssignedAt: r.createdAt,
      leadAssignedBy: creator.name,
      leadOwnerRole: creator.role === "System" ? "Sales" : creator.role,
      ...(options.receivedAt ? { leadReceivedAt: options.receivedAt } : {}),
    },
  };
}

export function qualificationMissing(r: RecordItem): string[] {
  return [
    !r.product.trim() && "product",
    !r.attributes?.grade?.trim() && "grade",
    !(r.quantity > 0) && "quantity",
    !r.unit.trim() && "unit",
    !r.destination?.trim() && "destination / port",
    !r.title.trim() && "company",
    !r.contact.trim() && "contact person",
    !(r.email?.trim() || r.phone?.trim()) && "email or phone",
    !r.ownerId && "responsible salesperson",
  ].filter(Boolean) as string[];
}

/** One audited, optimistic update. Acknowledgement is not customer contact. */
export function applyLeadFeedback(
  workspace: Workspace,
  actor: Actor,
  raw: LeadFeedback,
  at = new Date().toISOString(),
): Workspace {
  const c = leadFeedbackSchema.parse(raw);
  const r = workspace.records.find((row) => row.id === c.id);
  if (!r || !canWrite(actor, r) || !openLead(r))
    throw new Error("This open lead is not available for you to update.");
  // Marketing can capture/route leads but cannot claim a salesperson's response.
  if (!leadSalesRoles.includes(actor.role))
    throw new Error(
      "Sales or an authorised manager must record the contact outcome.",
    );
  if (r.updatedAt !== c.expectedUpdatedAt)
    throw new Error("This lead changed. Refresh it before saving your update.");
  if (c.outcome === "Acknowledged" && actor.id !== r.ownerId)
    throw new Error("Only the assigned person can acknowledge this lead.");
  if (c.outcome === "Not Relevant" && !c.note.trim())
    throw new Error(
      "Add a short reason so Marketing knows why this lead is not relevant.",
    );
  if (c.outcome !== "Acknowledged" && c.outcome !== "Not Relevant" && !c.due)
    throw new Error("Choose the next follow-up date.");
  if (c.due && c.due < businessToday(new Date(at)))
    throw new Error("Choose today or a future follow-up date.");
  if (supplierOpportunity(r) && c.outcome === "Quotation Needed")
    throw new Error(
      "This is a supplier opportunity. Record its sourcing update instead of a customer quotation request.",
    );
  const actualContact = [
    "Contacted",
    "Interested",
    "Waiting for Customer",
    "Quotation Needed",
  ].includes(c.outcome);
  const attrs = { ...r.attributes };
  if (c.outcome === "Acknowledged" && acknowledged(r)) return workspace;
  const updated: RecordItem = {
    ...r,
    updatedAt: at,
    ...(c.due ? { due: c.due } : {}),
    status:
      c.outcome === "Not Relevant"
        ? "Lost"
        : actualContact && r.status === "New"
          ? "Contacted"
          : r.status,
    attributes: {
      ...attrs,
      ...(actor.id === r.ownerId
        ? {
            leadAcknowledgedAt:
              attrs.leadAcknowledgedAt && acknowledged(r)
                ? attrs.leadAcknowledgedAt
                : at,
            leadAcknowledgedOwnerId: r.ownerId,
          }
        : {}),
      ...(c.outcome !== "Acknowledged"
        ? {
            leadFeedbackAt: at,
            leadFeedbackBy: actor.name,
            leadFeedbackOwnerId: r.ownerId,
            leadOutcome: c.outcome,
            leadFeedbackNote: c.note,
          }
        : {}),
      ...(actualContact && !attrs.leadFirstResponseAt
        ? { leadFirstResponseAt: at, leadFirstResponseBy: actor.name }
        : {}),
    },
    notes: [
      ...(r.notes || []),
      {
        id: crypto.randomUUID(),
        text: `${c.outcome}${c.note ? ` — ${c.note}` : ""}${c.due ? ` · Follow up ${c.due}` : ""}`,
        actor: actor.name,
        at,
      },
    ],
  };
  return {
    records: workspace.records.map((row) => (row.id === r.id ? updated : row)),
    audit: [
      {
        id: crypto.randomUUID(),
        actor: actor.name,
        action: `Lead feedback: ${c.outcome}`,
        recordId: r.id,
        company: r.company,
        at,
      },
      ...workspace.audit,
    ],
  };
}

export function leadSummary(
  actor: Actor,
  all: RecordItem[],
  from = "",
  to = "",
) {
  const visible = all.filter((r) => !r.deletedAt && canRead(actor, r));
  const leads = visible.filter(
    (r) =>
      r.kind === "leads" &&
      (!from || businessToday(new Date(r.createdAt)) >= from) &&
      (!to || businessToday(new Date(r.createdAt)) <= to),
  );
  const inquiries = leads.filter(buyerInquiry);
  const today = businessToday();
  const qualified = inquiries.filter((r) =>
    ["Qualified", "Quote Sent", "Negotiation", "Won"].includes(r.status),
  );
  const byId = new Map(inquiries.map((r) => [r.id, r]));
  const byDeal = new Map<string, string[]>();
  for (const r of inquiries)
    if (r.dealId) {
      const key = `${r.company}\0${r.dealId}`;
      byDeal.set(key, [...(byDeal.get(key) || []), r.id]);
    }
  const linkedIds = (r: RecordItem) => {
    const parent = r.parentId && byId.get(r.parentId);
    return [
      ...new Set([
        ...(parent && parent.company === r.company ? [parent.id] : []),
        ...(r.dealId ? byDeal.get(`${r.company}\0${r.dealId}`) || [] : []),
      ]),
    ];
  };
  const quoteLinks = new Map(
    visible
      .filter((r) => r.kind === "quotations")
      .map((r) => [r.id, { company: r.company, ids: linkedIds(r) }]),
  );
  const quotes = visible.filter(
    (r) =>
      r.kind === "quotations" &&
      ["Sent", "Accepted"].includes(r.status) &&
      quoteLinks.get(r.id)!.ids.length,
  );
  const convertedIds = new Set<string>();
  for (const r of visible)
    if (
      r.kind === "orders" &&
      ["Confirmed", "In Progress", "Completed"].includes(r.status)
    ) {
      const quote = r.parentId && quoteLinks.get(r.parentId);
      for (const id of [
        ...linkedIds(r),
        ...(quote && quote.company === r.company ? quote.ids : []),
      ])
        convertedIds.add(id);
    }
  const converted = inquiries.filter((r) => convertedIds.has(r.id));
  const durations = inquiries
    .flatMap((r) => {
      const start = Date.parse(r.attributes?.leadReceivedAt || ""),
        end = Date.parse(r.attributes?.leadFirstResponseAt || "");
      return Number.isFinite(start) && Number.isFinite(end) && end >= start
        ? [(end - start) / 60000]
        : [];
    })
    .sort((a, b) => a - b);
  const n = durations.length;
  return {
    leads,
    inquiries: inquiries.length,
    newInquiries: inquiries.filter(r => r.status === "New").length,
    qualified: qualified.length,
    quotations: quotes.length,
    converted: converted.length,
    conversion: inquiries.length
      ? Math.round((converted.length / inquiries.length) * 100)
      : null,
    unclassified: leads.filter((r) => leadType(r) === "Unclassified").length,
    awaitingAllocation: leads.filter(awaitingAllocation).length,
    prospects: leads.filter((r) => leadType(r) === "Buyer prospect").length,
    suppliers: leads.filter(supplierOpportunity).length,
    pending: leads.filter((r) => needsFeedback(r)).length,
    overdue: leads.filter((r) => openLead(r) && r.due && r.due < today).length,
    noNextAction: leads.filter((r) => openLead(r) && !r.due).length,
    responseMinutes: n
      ? n % 2
        ? durations[(n - 1) / 2]
        : (durations[n / 2 - 1] + durations[n / 2]) / 2
      : null,
    responseSamples: n,
  };
}
