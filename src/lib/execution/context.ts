import { and, eq, inArray, sql, desc } from "drizzle-orm";
import type { Actor, RecordItem } from "../domain";
import type { Database } from "../d1";
import type { AiContext } from "../ai/context";
import { gstToday } from "../ai/context";
import {
  deals,
  supplierRfqs,
  supplierOffers,
  commercialScenarios,
} from "../schema";
import { executionView, endpoints } from "./store";
import { canBuyCosts, offerValidity } from "./model";
import { CommercialError } from "../commercial/model";
import type { ProactiveSignal } from "../proactive/signals";
export async function addExecutionContext(
  db: Database,
  actor: Actor,
  dealId: string,
  ctx: AiContext,
) {
  const v = await executionView(db, actor, dealId);
  const ref = ctx.ref("Deal sourcing", {
    type: "record",
    kind: "leads",
    id: v.lead.id,
  });
  ctx.fact(
    "Sourcing candidates",
    v.candidates.filter((c) => c.status !== "Removed").length,
    ref,
  );
  ctx.fact("Commercial approval policy", v.approvalPolicy, ref);
  ctx.fact(
    "Offer interpretation",
    "Supplier-stated terms only. No automatic selection or current market price inference.",
    ref,
  );
  for (const r of v.rfqs.slice(0, 10)) {
    ctx.record(ref, {
      supplier: r.supplier,
      rfqStatus: r.status,
      quantity: r.details.quantity,
      unit: r.details.unit,
      incoterm: r.details.requestedIncoterm,
      meaning: r.details.incotermState,
      followUp: r.details.followUpDate,
    });
    ctx.text("supplier_rfq_notes", r.details.notes, ref);
  }
  for (const o of v.offers
    .filter((o) => o.status !== "Superseded")
    .slice(0, 10)) {
    ctx.record(ref, {
      supplier: o.supplier,
      revision: o.revision,
      status: o.status,
      validity: o.validity,
      price: o.details.price,
      currency: o.details.currency,
      unit: o.details.priceUnit,
      incoterm: o.details.incoterm,
      availability: o.details.availability,
    });
    ctx.text("supplier_offer_notes", o.details.notes, ref);
  }
  for (const s of v.scenarios.slice(0, 5)) {
    ctx.record(ref, {
      scenario: s.details.name,
      status: s.status,
      currency: s.details.currency,
      quantity: s.details.quantity,
      unit: s.details.unit,
    });
    ctx.fact(
      `${s.details.name}: landed cost`,
      `${s.calculation.landedCost} ${s.details.currency}`,
      ref,
    );
    ctx.fact(
      `${s.details.name}: margin`,
      `${s.calculation.marginAmount} ${s.details.currency} (${s.calculation.marginPercent}%)`,
      ref,
    );
    ctx.text("commercial_scenario_notes", s.details.notes, ref);
  }
}
export async function executionSignals(
  db: Database,
  actor: Actor,
  records: RecordItem[],
): Promise<ProactiveSignal[]> {
  const leads = new Map(
    records
      .filter(
        (r) =>
          r.kind === "leads" &&
          !r.deletedAt &&
          !["Won", "Lost"].includes(r.status),
      )
      .map((r) => [r.id, r]),
  );
  if (!leads.size) return [];
  const rooms = await db
    .select()
    .from(deals)
    .where(inArray(deals.company, actor.companies))
    .limit(1000);
  const byId = new Map(
    rooms
      .filter((r) => leads.has(r.leadId))
      .map((r) => [r.id, leads.get(r.leadId)!]),
  );
  const today = gstToday();
  const rfqs = await db
    .select()
    .from(supplierRfqs)
    .where(
      and(
        inArray(supplierRfqs.company, actor.companies),
        eq(supplierRfqs.status, "Sent externally"),
        sql`json_extract(${supplierRfqs.details},'$.followUpDate') <= ${today}`,
        sql`json_extract(${supplierRfqs.details},'$.followUpDate') != ''`,
      ),
    )
    .limit(200);
  const offers = await db
    .select()
    .from(supplierOffers)
    .where(
      and(
        inArray(supplierOffers.company, actor.companies),
        sql`${supplierOffers.status} NOT IN ('Superseded','Declined')`,
        sql`json_extract(${supplierOffers.details},'$.validUntil') != ''`,
      ),
    )
    .orderBy(desc(supplierOffers.updatedAt))
    .limit(200);
  const out: ProactiveSignal[] = [];
  for (const row of [...rfqs, ...offers]) {
    const lead = byId.get(row.dealId);
    if (!lead || !canBuyCosts(actor, lead)) continue;
    const offer = "seriesId" in row;
    const validity = offer
      ? offerValidity(
          (row as (typeof offers)[number]).details.validUntil,
          today,
        )
      : "";
    if (offer && !["Expired", "Expiring soon"].includes(validity)) continue;
    try {
      await endpoints(db, actor, row.dealId, row.supplierId, row.productId);
    } catch (e) {
      if (e instanceof CommercialError && e.status === 404) continue;
      throw e;
    }
    const type = offer ? "SUPPLIER_OFFER_VALIDITY" : "SUPPLIER_RFQ_FOLLOW_UP";
    const label = offer
      ? `Review ${validity.toLowerCase()} supplier offer`
      : "Supplier request follow-up due";
    out.push({
      key: `${type}:${row.id}`,
      type,
      category: "sales",
      severity: "important",
      section: "needs_action",
      entity: {
        type: "leads",
        id: lead.id,
        title: lead.title,
        status: lead.status,
        company: lead.company,
        branch: lead.branch,
        ownerId: lead.ownerId || null,
        owner: lead.owner || null,
        value: "",
      },
      label,
      facts: {
        evidence: `${row.id}:${row.version}:${validity}`,
        detail: label,
      },
      actions: ["open"],
      dismissible: true,
      snoozable: true,
      rank: 2000000,
      fingerprint: `${row.version}:${validity}`,
    });
  }
  return out;
}
export async function searchExecution(
  db: Database,
  actor: Actor,
  query: string,
) {
  const pattern = `%${query.replace(/[!%_]/g, "!$&")}%`;
  const out: {
    id: string;
    parentId: string;
    kind: string;
    label: string;
    detail: string;
    targetKind: string;
  }[] = [];
  for (const table of [supplierRfqs, supplierOffers]) {
    const rows = await db
      .select()
      .from(table)
      .where(
        and(
          inArray(table.company, actor.companies),
          sql`(${table.id} LIKE ${pattern} ESCAPE '!' OR ${table.supplierId} IN (SELECT id FROM BusinessRecord WHERE json_extract(payload,'$.title') LIKE ${pattern} ESCAPE '!'))`,
        ),
      )
      .limit(20);
    for (const row of rows)
      try {
        const p = await endpoints(
          db,
          actor,
          row.dealId,
          row.supplierId,
          row.productId,
        );
        if (!canBuyCosts(actor, p.record)) continue;
        out.push({
          id: row.id,
          parentId: p.record.id,
          kind: table === supplierRfqs ? "rfqs" : "offers",
          label: p.supplier.title,
          detail:
            table === supplierRfqs
              ? "Supplier RFQ · Deal Room"
              : "Supplier offer · Deal Room",
          targetKind: "leads",
        });
      } catch (e) {
        if (!(e instanceof CommercialError && e.status === 404)) throw e;
      }
  }
  return out;
}
