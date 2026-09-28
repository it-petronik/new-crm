import { quotationError } from "../quotation";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import type { Database } from "../d1";
import type { Actor, RecordItem } from "../domain";
import { canRead, canWrite } from "../domain";
import {
  deals,
  dealSuppliers,
  supplierRfqs,
  supplierOffers,
  commercialScenarios,
  businessRecords,
  auditEvents,
} from "../schema";
import { parent, capabilities, resolveLinks } from "../commercial/store";
import {
  CommercialError,
  normalizedName,
  unavailable,
} from "../commercial/model";
import {
  calculateScenario,
  canBuyCosts,
  canExecute,
  rfqInput,
  offerInput,
  scenarioInput,
  quotationPrice,
  offerValidity,
  comparisonKey,
  type ScenarioDetails,
} from "./model";

export async function requestIdentity(
  actor: Actor,
  action: string,
  requestId: string,
) {
  if (!requestId || requestId.length > 100)
    throw new CommercialError(400, "A request identity is required.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${actor.id}:${action}:${requestId}`),
  );
  return `EX-${Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  )
    .join("")
    .slice(0, 40)}`;
}
export function event(actor: Actor, r: RecordItem, action: string) {
  return {
    id: crypto.randomUUID(),
    actor: actor.name,
    actorId: actor.id,
    company: r.company,
    recordId: r.id,
    action,
    at: new Date(),
  };
}
export async function dealRoot(
  db: Database,
  actor: Actor,
  dealId: string,
  write = false,
) {
  const deal = await db.select().from(deals).where(eq(deals.id, dealId)).get();
  if (!deal) throw unavailable();
  const p = await parent(db, actor, deal.leadId, ["leads"], write);
  if (p.record.company !== deal.company || p.record.branch !== deal.branch)
    throw unavailable();
  return { ...p, deal };
}
export async function endpoints(
  db: Database,
  actor: Actor,
  dealId: string,
  supplierId: string,
  productId: string,
  write = false,
) {
  const root = await dealRoot(db, actor, dealId, write);
  const supplier = await parent(db, actor, supplierId, ["suppliers"]);
  const product = await parent(db, actor, productId, ["products"]);
  for (const p of [supplier, product])
    if (
      p.record.company !== root.record.company ||
      p.record.branch !== root.record.branch
    )
      throw unavailable();
  if (
    write &&
    (!canExecute(actor, root.record) || supplier.record.status !== "Active")
  )
    throw unavailable();
  return { ...root, supplier: supplier.record, product: product.record };
}
const tables = {
  candidate: dealSuppliers,
  rfq: supplierRfqs,
  offer: supplierOffers,
  scenario: commercialScenarios,
};
type Table = (typeof tables)[keyof typeof tables];
function guard(db: Database, table: Table, id: string, version: number) {
  return db
    .update(table)
    .set({
      version: sql`CASE WHEN ${table.version}=${version} THEN ${version + 1} ELSE NULL END`,
      updatedAt: new Date(),
    })
    .where(eq(table.id, id));
}
function leadGuard(db: Database, root: Awaited<ReturnType<typeof dealRoot>>) {
  return db
    .update(businessRecords)
    .set({
      version: sql`CASE WHEN ${businessRecords.version}=${root.row.version} THEN ${root.row.version + 1} ELSE NULL END`,
    })
    .where(eq(businessRecords.id, root.record.id));
}
async function atomic(
  db: Database,
  statements: Parameters<Database["batch"]>[0],
) {
  try {
    return await db.batch(statements);
  } catch (e) {
    if (/constraint|execution_|offer_|scenario_/i.test(String(e)))
      throw new CommercialError(
        409,
        "This commercial record changed or conflicts with existing history. Refresh and review.",
      );
    throw e;
  }
}
function base(
  actor: Actor,
  r: RecordItem,
  dealId: string,
  supplierId: string,
  productId: string,
  id: string,
  status: string,
) {
  return {
    id,
    dealId,
    supplierId,
    productId,
    company: r.company,
    branch: r.branch,
    status,
    version: 1,
    createdBy: actor.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
export async function sourcingCandidates(
  db: Database,
  actor: Actor,
  lead: RecordItem,
) {
  if (!lead.productId) return [];
  const matches = await capabilities(db, actor, lead, true);
  const out = [];
  for (const c of matches) {
    const { record: s } = await parent(db, actor, c.supplierId, ["suppliers"]);
    if (s.status !== "Active") continue;
    if (
      lead.attributes?.grade &&
      c.grade &&
      normalizedName(lead.attributes.grade) !== normalizedName(c.grade)
    )
      continue;
    if (
      lead.attributes?.originCountry &&
      c.originCountry &&
      normalizedName(lead.attributes.originCountry) !==
        normalizedName(c.originCountry)
    )
      continue;
    out.push(c);
  }
  return out;
}
export async function saveCandidate(
  db: Database,
  actor: Actor,
  c: {
    dealId: string;
    supplierId: string;
    productId: string;
    requestId: string;
    status?: string;
    version?: number;
  },
) {
  const root = await endpoints(
    db,
    actor,
    c.dealId,
    c.supplierId,
    c.productId,
    true,
  );
  const prior = await db
    .select()
    .from(dealSuppliers)
    .where(
      and(
        eq(dealSuppliers.dealId, c.dealId),
        eq(dealSuppliers.supplierId, c.supplierId),
        eq(dealSuppliers.productId, c.productId),
      ),
    )
    .get();
  const status = c.status || "Candidate";
  if (!["Candidate", "No response", "Declined", "Removed"].includes(status))
    throw new CommercialError(400, "Choose a valid sourcing status.");
  if (prior) {
    if (prior.status === status) return prior.id;
    if (c.version !== prior.version)
      throw new CommercialError(409, "Refresh the sourcing candidate.");
    await atomic(db, [
      leadGuard(db, root),
      guard(db, dealSuppliers, prior.id, c.version),
      db
        .update(dealSuppliers)
        .set({ status })
        .where(eq(dealSuppliers.id, prior.id)),
      db
        .insert(auditEvents)
        .values(event(actor, root.record, `Sourcing candidate: ${status}`)),
    ]);
    return prior.id;
  }
  const matches = await sourcingCandidates(db, actor, root.record);
  if (
    !matches.some(
      (m) => m.supplierId === c.supplierId && m.productId === c.productId,
    )
  )
    throw new CommercialError(
      400,
      "Choose an active supplier with matching recorded capability.",
    );
  const id = await requestIdentity(actor, "candidate", c.requestId);
  await atomic(db, [
    leadGuard(db, root),
    db
      .insert(dealSuppliers)
      .values(
        base(
          actor,
          root.record,
          c.dealId,
          c.supplierId,
          c.productId,
          id,
          status,
        ),
      ),
    db
      .insert(auditEvents)
      .values(event(actor, root.record, "Sourcing candidate added")),
  ]);
  return id;
}
export async function saveRfq(
  db: Database,
  actor: Actor,
  c: {
    dealId: string;
    supplierId: string;
    productId: string;
    requestId: string;
    id?: string;
    version?: number;
    status: string;
    details: unknown;
  },
) {
  const root = await endpoints(
    db,
    actor,
    c.dealId,
    c.supplierId,
    c.productId,
    true,
  );
  const details = rfqInput.parse(c.details);
  if (Number(details.quantity) <= 0)
    throw new CommercialError(400, "RFQ quantity must be above zero.");
  const candidate = await db
    .select()
    .from(dealSuppliers)
    .where(
      and(
        eq(dealSuppliers.dealId, c.dealId),
        eq(dealSuppliers.supplierId, c.supplierId),
        eq(dealSuppliers.productId, c.productId),
      ),
    )
    .get();
  if (!candidate || candidate.status === "Removed")
    throw new CommercialError(
      400,
      "Add this supplier as a sourcing candidate first.",
    );
  const id = c.id || (await requestIdentity(actor, "rfq", c.requestId));
  const prior = await db
    .select()
    .from(supplierRfqs)
    .where(eq(supplierRfqs.id, id))
    .get();
  if (prior) {
    if (
      prior.dealId !== c.dealId ||
      prior.supplierId !== c.supplierId ||
      prior.productId !== c.productId
    )
      throw unavailable();
    if (!c.id) return id;
    if (c.version !== prior.version)
      throw new CommercialError(409, "The RFQ changed. Refresh it.");
    const allowed: Record<string, string[]> = {
      Draft: ["Draft", "Prepared", "Closed"],
      Prepared: ["Draft", "Prepared", "Sent externally", "Closed"],
      "Sent externally": ["Responded", "Closed"],
      Responded: ["Closed"],
      Closed: [],
    };
    if (!allowed[prior.status]?.includes(c.status))
      throw new CommercialError(
        400,
        "This RFQ status change is not available.",
      );
    if (
      ["Sent externally", "Responded", "Closed"].includes(prior.status) &&
      JSON.stringify(details) !== JSON.stringify(prior.details)
    )
      throw new CommercialError(
        400,
        "Preserve the sent request. Prepare a separate RFQ round for revised terms.",
      );
    await atomic(db, [
      leadGuard(db, root),
      guard(db, supplierRfqs, id, c.version),
      db
        .update(supplierRfqs)
        .set({ details, status: c.status })
        .where(eq(supplierRfqs.id, id)),
      db
        .insert(auditEvents)
        .values(
          event(
            actor,
            root.record,
            `Supplier RFQ ${c.status}${c.status === "Sent externally" ? " (recorded manually)" : ""}`,
          ),
        ),
    ]);
  } else {
    if (c.id) throw unavailable();
    if (c.status !== "Draft")
      throw new CommercialError(400, "New RFQs start as drafts.");
    if (root.record.productId !== c.productId)
      throw new CommercialError(
        409,
        "Review the current Lead product before preparing this RFQ.",
      );
    await atomic(db, [
      leadGuard(db, root),
      db.insert(supplierRfqs).values({
        ...base(
          actor,
          root.record,
          c.dealId,
          c.supplierId,
          c.productId,
          id,
          "Draft",
        ),
        details,
      }),
      db
        .insert(auditEvents)
        .values(event(actor, root.record, "Supplier RFQ created")),
    ]);
  }
  return id;
}
export async function recordOffer(
  db: Database,
  actor: Actor,
  c: {
    dealId: string;
    supplierId: string;
    productId: string;
    requestId: string;
    rfqId?: string;
    previousId?: string;
    version?: number;
    details: unknown;
  },
) {
  const root = await endpoints(
    db,
    actor,
    c.dealId,
    c.supplierId,
    c.productId,
    true,
  );
  const details = offerInput.parse(c.details);
  if (Number(details.quantity) <= 0 || Number(details.price) <= 0)
    throw new CommercialError(
      400,
      "Offer quantity and price must be above zero.",
    );
  if (c.rfqId) {
    const rfq = await db
      .select()
      .from(supplierRfqs)
      .where(eq(supplierRfqs.id, c.rfqId))
      .get();
    if (
      !rfq ||
      rfq.dealId !== c.dealId ||
      rfq.supplierId !== c.supplierId ||
      rfq.productId !== c.productId
    )
      throw unavailable();
  }
  const id = await requestIdentity(actor, "offer", c.requestId);
  const retry = await db
    .select()
    .from(supplierOffers)
    .where(eq(supplierOffers.id, id))
    .get();
  if (retry) {
    if (retry.dealId !== c.dealId || retry.supplierId !== c.supplierId)
      throw unavailable();
    return id;
  }
  const previous = c.previousId
    ? await db
        .select()
        .from(supplierOffers)
        .where(eq(supplierOffers.id, c.previousId))
        .get()
    : null;
  if (
    c.previousId &&
    (!previous ||
      previous.dealId !== c.dealId ||
      previous.supplierId !== c.supplierId ||
      previous.productId !== c.productId)
  )
    throw unavailable();
  if (
    previous &&
    (previous.version !== c.version || previous.status === "Superseded")
  )
    throw new CommercialError(409, "Use the latest supplier offer revision.");
  await atomic(db, [
    leadGuard(db, root),
    ...(previous
      ? [
          guard(db, supplierOffers, previous.id, c.version!),
          db
            .update(supplierOffers)
            .set({ status: "Superseded" })
            .where(eq(supplierOffers.id, previous.id)),
        ]
      : []),
    db.insert(supplierOffers).values({
      ...base(
        actor,
        root.record,
        c.dealId,
        c.supplierId,
        c.productId,
        id,
        "Received",
      ),
      details,
      rfqId: c.rfqId || previous?.rfqId || null,
      seriesId: previous?.seriesId || id,
      revision: (previous?.revision || 0) + 1,
      previousId: previous?.id || null,
    }),
    db
      .insert(auditEvents)
      .values(
        event(
          actor,
          root.record,
          previous
            ? "Supplier offer revised; prior terms retained"
            : "Supplier offer recorded",
        ),
      ),
  ]);
  return id;
}
export async function offerStatus(
  db: Database,
  actor: Actor,
  c: { id: string; version: number; status: string },
) {
  const row = await db
    .select()
    .from(supplierOffers)
    .where(eq(supplierOffers.id, c.id))
    .get();
  if (!row) throw unavailable();
  const root = await endpoints(
    db,
    actor,
    row.dealId,
    row.supplierId,
    row.productId,
    true,
  );
  if (
    row.status === "Superseded" ||
    !["Under review", "Declined", "Selected"].includes(c.status)
  )
    throw new CommercialError(
      400,
      "Choose a current offer to review or select.",
    );
  await atomic(db, [
    leadGuard(db, root),
    guard(db, supplierOffers, row.id, c.version),
    db
      .update(supplierOffers)
      .set({ status: c.status })
      .where(eq(supplierOffers.id, row.id)),
    db
      .insert(auditEvents)
      .values(
        event(
          actor,
          root.record,
          `Supplier offer ${c.status.toLowerCase()} by employee`,
        ),
      ),
  ]);
}
export async function saveScenario(
  db: Database,
  actor: Actor,
  c: {
    offerId: string;
    requestId: string;
    id?: string;
    version?: number;
    details: unknown;
  },
) {
  const offer = await db
    .select()
    .from(supplierOffers)
    .where(eq(supplierOffers.id, c.offerId))
    .get();
  if (!offer) throw unavailable();
  const root = await endpoints(
    db,
    actor,
    offer.dealId,
    offer.supplierId,
    offer.productId,
    true,
  );
  const input = scenarioInput.parse(c.details);
  calculateScenario(input, offer.details);
  const id = c.id || (await requestIdentity(actor, "scenario", c.requestId));
  const prior = await db
    .select()
    .from(commercialScenarios)
    .where(eq(commercialScenarios.id, id))
    .get();
  if (prior) {
    if (prior.dealId !== offer.dealId || prior.offerId !== offer.id)
      throw unavailable();
    if (!c.id) return id;
    if (prior.status !== "Draft")
      throw new CommercialError(
        400,
        "Reviewed scenarios are preserved. Create another scenario to change inputs.",
      );
    if (c.version !== prior.version)
      throw new CommercialError(409, "Refresh this scenario.");
  }
  if (c.id && !prior) throw unavailable();
  const details: ScenarioDetails = {
    ...input,
    fxActor: actor.id,
    fxEnteredAt: new Date().toISOString(),
  };
  await atomic(db, [
    leadGuard(db, root),
    ...(prior
      ? [
          guard(db, commercialScenarios, id, c.version!),
          db
            .update(commercialScenarios)
            .set({ details })
            .where(eq(commercialScenarios.id, id)),
        ]
      : [
          db.insert(commercialScenarios).values({
            ...base(
              actor,
              root.record,
              offer.dealId,
              offer.supplierId,
              offer.productId,
              id,
              "Draft",
            ),
            details,
            offerId: offer.id,
          }),
        ]),
    db
      .insert(auditEvents)
      .values(
        event(
          actor,
          root.record,
          prior
            ? "Scenario cost inputs and selling price reviewed and changed"
            : "Commercial scenario created",
        ),
      ),
    ...(input.fx.length
      ? [
          db
            .insert(auditEvents)
            .values(
              event(actor, root.record, "Manual FX recorded for scenario"),
            ),
        ]
      : []),
  ]);
  return id;
}
export async function scenarioStatus(
  db: Database,
  actor: Actor,
  c: { id: string; version: number; status: string },
) {
  const row = await db
    .select()
    .from(commercialScenarios)
    .where(eq(commercialScenarios.id, c.id))
    .get();
  if (!row) throw unavailable();
  const root = await endpoints(
    db,
    actor,
    row.dealId,
    row.supplierId,
    row.productId,
    true,
  );
  if (!(
    (row.status === "Draft" && c.status === "Reviewed") ||
    (row.status === "Reviewed" && c.status === "Selected")
  ))
    throw new CommercialError(
      400,
      "Review a draft, then explicitly select the reviewed scenario.",
    );
  const offer = await db
    .select()
    .from(supplierOffers)
    .where(eq(supplierOffers.id, row.offerId))
    .get();
  if (!offer) throw unavailable();
  calculateScenario(row.details, offer.details);
  if (
    c.status === "Selected" &&
    (["Superseded", "Declined"].includes(offer.status) ||
      offerValidity(offer.details.validUntil) === "Expired")
  )
    throw new CommercialError(
      400,
      "Review a current, unexpired supplier offer before selecting this scenario.",
    );
  await atomic(db, [
    leadGuard(db, root),
    ...(c.status === "Selected"
      ? [
          db
            .update(commercialScenarios)
            .set({
              status: "Reviewed",
              version: sql`${commercialScenarios.version}+1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(commercialScenarios.dealId, row.dealId),
                eq(commercialScenarios.status, "Selected"),
              ),
            ),
        ]
      : []),
    guard(db, commercialScenarios, row.id, c.version),
    db
      .update(commercialScenarios)
      .set({
        status: c.status,
        ...(c.status === "Selected"
          ? { selectedBy: actor.id, selectedAt: new Date() }
          : {}),
      })
      .where(eq(commercialScenarios.id, row.id)),
    db
      .insert(auditEvents)
      .values(
        event(
          actor,
          root.record,
          `Commercial scenario ${c.status.toLowerCase()} by employee`,
        ),
      ),
  ]);
}
export async function prepareQuotation(
  db: Database,
  actor: Actor,
  c: { id: string; version: number },
) {
  const row = await db
    .select()
    .from(commercialScenarios)
    .where(eq(commercialScenarios.id, c.id))
    .get();
  if (!row) throw unavailable();
  const root = await endpoints(
    db,
    actor,
    row.dealId,
    row.supplierId,
    row.productId,
    true,
  );
  if (row.quotationId) {
    await parent(db, actor, row.quotationId, ["quotations"]);
    return row.quotationId;
  }
  if (row.status !== "Selected" || row.version !== c.version)
    throw new CommercialError(
      409,
      "Select and refresh the reviewed scenario first.",
    );
  const offer = await db
    .select()
    .from(supplierOffers)
    .where(eq(supplierOffers.id, row.offerId))
    .get();
  if (!offer) throw unavailable();
  if (
    ["Superseded", "Declined"].includes(offer.status) ||
    offerValidity(offer.details.validUntil) === "Expired"
  )
    throw new CommercialError(
      400,
      "Review the current supplier offer before quotation preparation.",
    );
  calculateScenario(row.details, offer.details);
  const price = quotationPrice(row.details),
    now = new Date().toISOString();
  const id = `${row.id}-Q`;
  const quoteError = quotationError(
    [{ quantity: price.quantity, unitPriceCents: price.unitPriceCents }],
    now.slice(0, 10),
    row.details.quotationValidUntil,
  );
  if (quoteError) throw new CommercialError(400, quoteError);
  const quote = await resolveLinks(db, actor, {
    ...root.record,
    id,
    kind: "quotations",
    status: "Draft",
    due: row.details.quotationValidUntil,
    source: "Reviewed commercial scenario",
    parentId: root.record.id,
    dealId: row.dealId,
    productId: row.productId,
    quantity: price.quantity,
    unit: row.details.unit,
    currency: row.details.currency,
    amount: price.amount,
    detail: "",
    lines: [
      {
        description: root.product.title,
        quantity: price.quantity,
        unitPriceCents: price.unitPriceCents,
        packaging: row.details.packaging,
      },
    ],
    payments: [],
    notes: [],
    attributes: {
      incoterm: row.details.incoterm,
      packaging: row.details.packaging,
      paymentTerms: row.details.paymentTerms,
      deliveryTimeline: row.details.deliveryRequirement,
      commercialScenarioId: row.id,
    },
    createdAt: now,
    updatedAt: now,
  });
  if (!canWrite(actor, quote)) throw unavailable();
  await atomic(db, [
    leadGuard(db, root),
    guard(db, commercialScenarios, row.id, c.version),
    db.insert(businessRecords).values({
      id,
      kind: quote.kind,
      company: quote.company,
      branch: quote.branch,
      ownerId: quote.ownerId,
      status: quote.status,
      payload: quote,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    db
      .update(commercialScenarios)
      .set({ quotationId: id })
      .where(eq(commercialScenarios.id, row.id)),
    db
      .insert(auditEvents)
      .values(
        event(
          actor,
          quote,
          "Quotation draft prepared from selected scenario; existing approval required",
        ),
      ),
  ]);
  return id;
}
export async function executionView(
  db: Database,
  actor: Actor,
  dealId: string,
) {
  const root = await dealRoot(db, actor, dealId);
  const matches = await sourcingCandidates(db, actor, root.record);
  const candidates = await db
    .select()
    .from(dealSuppliers)
    .where(eq(dealSuppliers.dealId, dealId))
    .limit(200);
  const rfqs = await db
    .select()
    .from(supplierRfqs)
    .where(eq(supplierRfqs.dealId, dealId))
    .orderBy(desc(supplierRfqs.createdAt))
    .limit(200);
  const costs = canBuyCosts(actor, root.record);
  const offers = costs
    ? await db
        .select()
        .from(supplierOffers)
        .where(eq(supplierOffers.dealId, dealId))
        .orderBy(desc(supplierOffers.createdAt))
        .limit(200)
    : [];
  const scenarios = costs
    ? await db
        .select()
        .from(commercialScenarios)
        .where(eq(commercialScenarios.dealId, dealId))
        .orderBy(desc(commercialScenarios.createdAt))
        .limit(100)
    : [];
  const endpointCache = new Map<
    string,
    Awaited<ReturnType<typeof endpoints>> | null
  >();
  async function visible<T extends { supplierId: string; productId: string }>(
    rows: T[],
  ) {
    const out: (T & { supplier: string; product: string })[] = [];
    for (const r of rows) {
      const key = `${r.supplierId}:${r.productId}`;
      if (!endpointCache.has(key))
        try {
          endpointCache.set(
            key,
            await endpoints(db, actor, dealId, r.supplierId, r.productId),
          );
        } catch (e) {
          if (!(e instanceof CommercialError && e.status === 404)) throw e;
          endpointCache.set(key, null);
        }
      const p = endpointCache.get(key);
      if (p)
        out.push({
          ...r,
          supplier: p.supplier.title,
          product: p.product.title,
        });
    }
    return out;
  }
  const safeOffers = await visible(offers),
    safeScenarios = await visible(scenarios);
  const detailed = [];
  for (const s of safeScenarios) {
    const offer =
      safeOffers.find((o) => o.id === s.offerId) ||
      (await db
        .select()
        .from(supplierOffers)
        .where(eq(supplierOffers.id, s.offerId))
        .get());
    if (!offer) continue;
    await endpoints(db, actor, offer.dealId, offer.supplierId, offer.productId);
    detailed.push({
      ...s,
      calculation: calculateScenario(s.details, offer.details),
    });
  }
  return {
    dealId,
    lead: root.record,
    writable: canExecute(actor, root.record),
    canSeeCosts: costs,
    matches,
    candidates: await visible(candidates),
    rfqs: await visible(rfqs),
    offers: safeOffers.map((o) => ({
      ...o,
      validity: offerValidity(o.details.validUntil),
      comparisonGroup: comparisonKey(o.details),
    })),
    scenarios: detailed,
    coverage:
      "Up to 200 authorized sourcing records and 100 scenarios. Capability is recorded knowledge, not availability or an offer.",
    approvalPolicy:
      "No margin exception policy configured. Existing quotation approval applies.",
  };
}
export type ExecutionView = Awaited<ReturnType<typeof executionView>>;
export async function executionHistory(
  db: Database,
  actor: Actor,
  recordId: string,
) {
  const { record } = await parent(db, actor, recordId, [
    "suppliers",
    "products",
  ]);
  const rows = await db
    .select()
    .from(supplierOffers)
    .where(
      and(
        eq(supplierOffers.company, record.company),
        eq(supplierOffers.branch, record.branch),
        record.kind === "suppliers"
          ? eq(supplierOffers.supplierId, recordId)
          : eq(supplierOffers.productId, recordId),
      ),
    )
    .orderBy(desc(supplierOffers.createdAt))
    .limit(100);
  const visible = [];
  for (const row of rows)
    try {
      const root = await endpoints(
        db,
        actor,
        row.dealId,
        row.supplierId,
        row.productId,
      );
      if (canBuyCosts(actor, root.record))
        visible.push({
          ...row,
          supplier: root.supplier.title,
          product: root.product.title,
          leadId: root.record.id,
          validity: offerValidity(row.details.validUntil),
        });
    } catch (e) {
      if (!(e instanceof CommercialError && e.status === 404)) throw e;
    }
  const requests = await db
    .select()
    .from(supplierRfqs)
    .where(
      and(
        eq(supplierRfqs.company, record.company),
        eq(supplierRfqs.branch, record.branch),
        record.kind === "suppliers"
          ? eq(supplierRfqs.supplierId, recordId)
          : eq(supplierRfqs.productId, recordId),
      ),
    )
    .orderBy(desc(supplierRfqs.createdAt))
    .limit(100);
  const rfqs = [];
  for (const row of requests)
    try {
      const root = await endpoints(
        db,
        actor,
        row.dealId,
        row.supplierId,
        row.productId,
      );
      if (canBuyCosts(actor, root.record))
        rfqs.push({
          ...row,
          supplier: root.supplier.title,
          product: root.product.title,
          leadId: root.record.id,
        });
    } catch (e) {
      if (!(e instanceof CommercialError && e.status === 404)) throw e;
    }
  return {
    rfqs,
    offers: visible,
    label: "Historical Enercore supplier offers — not current market prices",
  };
}
