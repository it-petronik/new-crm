import { and, eq, gt, lt, sql, desc, inArray } from "drizzle-orm";
import type { Database } from "../d1";
import {
  businessRecords,
  contacts,
  deals,
  apolloStages,
  apolloImports,
  auditEvents,
} from "../schema";
import { type Actor, type RecordItem, canWrite } from "../domain";
import {
  CommercialError,
  duplicateReasons,
  contactInput,
  unavailable,
} from "../commercial/model";
import {
  parent,
  readRecords,
  listContacts,
  saveContact,
} from "../commercial/store";
import { updateRecordWithAudit } from "../data";
import { canProspect } from "../execution/model";
import { requestIdentity, event } from "../execution/store";
import {
  searchInput,
  domainOf,
  type Prospect,
  type ProspectPage,
  type SearchInput,
} from "./model";
import type { ApolloProvider } from "./provider";

export function prospectScope(actor: Actor, company: string, branch: string) {
  if (
    !canProspect(actor) ||
    !actor.companies.includes(company) ||
    !branch ||
    branch.length > 80 ||
    (actor.branches.length && !actor.branches.includes(branch))
  )
    throw unavailable();
}
export async function searchProspects(
  db: Database,
  actor: Actor,
  company: string,
  branch: string,
  input: SearchInput,
  provider: ApolloProvider,
) {
  prospectScope(actor, company, branch);
  const criteria = searchInput.parse(input);
  if (
    !criteria.keywords &&
    !criteria.location &&
    !criteria.domain &&
    !criteria.titles &&
    !criteria.companySize &&
    !Object.values(criteria.advanced).some(Boolean)
  )
    throw new CommercialError(
      400,
      "Add search criteria before searching Apollo.",
    );
  return cachedProviderPage(
    db,
    actor,
    company,
    branch,
    JSON.stringify(criteria),
    criteria,
    () => provider.search(criteria),
  );
}
/** A D1 reservation prevents double-clicks across Worker isolates from spending twice. */
async function cachedProviderPage(
  db: Database,
  actor: Actor,
  company: string,
  branch: string,
  fingerprint: string,
  criteria: SearchInput,
  fetchPage: () => Promise<ProspectPage>,
) {
  const now = new Date();
  await db.delete(apolloStages).where(lt(apolloStages.expiresAt, now));
  const predicate = and(
    eq(apolloStages.actorId, actor.id),
    eq(apolloStages.company, company),
    eq(apolloStages.branch, branch),
    eq(apolloStages.fingerprint, fingerprint),
  );
  const cached = await db.select().from(apolloStages).where(predicate).get();
  if (cached) {
    if (cached.data.pending)
      throw new CommercialError(
        409,
        "This Apollo request is already running. Wait before trying again; no additional request was sent.",
      );
    return {
      stageId: cached.id,
      ...cached.data,
      cached: true,
      expiresAt: cached.expiresAt,
    };
  }
  const id = crypto.randomUUID(),
    expiresAt = new Date(Date.now() + 10 * 60000);
  const reserved = await db
    .insert(apolloStages)
    .values({
      id,
      actorId: actor.id,
      company,
      branch,
      fingerprint,
      expiresAt,
      data: {
        criteria,
        page: criteria.page,
        hasMore: false,
        prospects: [],
        source: "Apollo",
        pending: true,
      },
    })
    .onConflictDoNothing()
    .returning({ id: apolloStages.id });
  if (!reserved.length)
    throw new CommercialError(
      409,
      "This Apollo request is already running. Review the completed results before trying again.",
    );
  try {
    const data = await fetchPage();
    if (data.prospects.length > 100)
      throw new CommercialError(503, "Provider result exceeds the page limit.");
    await db.update(apolloStages).set({ data }).where(eq(apolloStages.id, id));
    return { stageId: id, ...data, cached: false, expiresAt };
  } catch (e) {
    await db.delete(apolloStages).where(eq(apolloStages.id, id));
    throw e;
  }
}

export async function staged(
  db: Database,
  actor: Actor,
  stageId: string,
  providerId: string,
) {
  const stage = await db
    .select()
    .from(apolloStages)
    .where(
      and(
        eq(apolloStages.id, stageId),
        eq(apolloStages.actorId, actor.id),
        gt(apolloStages.expiresAt, new Date()),
      ),
    )
    .get();
  if (!stage)
    throw new CommercialError(
      404,
      "Prospect review expired or was not found. Search again when ready.",
    );
  prospectScope(actor, stage.company, stage.branch);
  const prospect = stage.data.prospects.find((p) => p.id === providerId);
  if (!prospect) throw unavailable();
  return { stage, prospect };
}
export async function enrichProspect(
  db: Database,
  actor: Actor,
  stageId: string,
  providerId: string,
  provider: ApolloProvider,
) {
  const { stage, prospect } = await staged(db, actor, stageId, providerId);
  if (stage.data.enriched)
    return { stageId: stage.id, ...stage.data, cached: true };
  if (prospect.kind === "company" && !prospect.domain)
    throw new CommercialError(400, "Company enrichment needs a known domain.");
  return cachedProviderPage(
    db,
    actor,
    stage.company,
    stage.branch,
    `enrichment:${prospect.kind}:${providerId}`,
    stage.data.criteria,
    async () => ({
      ...stage.data,
      prospects: [await provider.enrich(prospect)],
      enriched: true,
    }),
  );
}

/** Request-local matching input, never shared across actors or cached across requests. */
export async function reviewContext(
  db: Database,
  actor: Actor,
  company: string,
  branch: string,
) {
  prospectScope(actor, company, branch);
  const customers = await readRecords(
    db,
    actor,
    and(
      eq(businessRecords.kind, "customers"),
      eq(businessRecords.company, company),
      eq(businessRecords.branch, branch),
    ),
    1000,
  );
  const contactRows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.company, company), eq(contacts.branch, branch)))
    .limit(5000);
  return { actorId: actor.id, company, branch, customers, contactRows };
}
export async function importReview(
  db: Database,
  actor: Actor,
  stageId: string,
  providerId: string,
  context?: Awaited<ReturnType<typeof reviewContext>>,
) {
  const { stage, prospect: p } = await staged(db, actor, stageId, providerId);
  const { customers, contactRows } =
    context &&
    context.actorId === actor.id &&
    context.company === stage.company &&
    context.branch === stage.branch
      ? context
      : await reviewContext(db, actor, stage.company, stage.branch);
  const possible = [];
  for (const r of customers) {
    const reasons = duplicateReasons(
      {
        title: p.companyName || p.name,
        email: p.kind === "company" ? p.email : "",
        phone: p.kind === "company" ? p.phone : "",
      },
      r,
    );
    if (p.domain && domainOf(r.attributes?.website || "") === p.domain)
      reasons.push("Same business domain");
    if (p.companyId && r.attributes?.apolloCompanyId === p.companyId)
      reasons.push("Same Apollo company reference");
    const people = contactRows
      .filter((c) => c.parentId === r.id)
      .map((c) => ({
        ...c.details,
        id: c.id,
        active: c.active,
        version: c.version,
      }));
    if (
      people.some(
        (c) =>
          duplicateReasons({ email: p.email, phone: p.phone }, c, false).length,
      )
    )
      reasons.push("Matching existing Contact evidence");
    if (reasons.length)
      possible.push({ id: r.id, title: r.title, reasons, contacts: people });
  }
  return {
    prospect: p,
    customers: possible.slice(0, 20),
    coverage:
      "Checks up to 1,000 authorized customers and 5,000 scoped contacts. Possible matches require your review.",
  };
}
export type ImportInput = {
  stageId: string;
  providerId: string;
  requestId: string;
  customerId?: string;
  contactId?: string;
  companyName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  createAnyway?: boolean;
  createLead?: boolean;
  createDeal?: boolean;
  createContact?: boolean;
  productId?: string;
};
export async function importProspect(
  db: Database,
  actor: Actor,
  c: ImportInput,
) {
  const { stage, prospect: p } = await staged(
    db,
    actor,
    c.stageId,
    c.providerId,
  );
  const prior = await db
    .select()
    .from(apolloImports)
    .where(
      and(
        eq(apolloImports.company, stage.company),
        eq(apolloImports.branch, stage.branch),
        eq(apolloImports.providerKind, p.kind),
        eq(apolloImports.providerId, p.id),
      ),
    )
    .get();
  if (prior) {
    await parent(db, actor, prior.customerId, ["customers"]);
    if (prior.leadId) await parent(db, actor, prior.leadId, ["leads"]);
    return {
      customerId: prior.customerId,
      contactId: prior.contactId,
      leadId: prior.leadId,
      replayed: true,
    };
  }
  const review = await importReview(db, actor, c.stageId, c.providerId);
  if (!c.customerId && review.customers.length && !c.createAnyway)
    throw new CommercialError(
      409,
      "Review the existing customer matches before creating another customer.",
    );
  const now = new Date(),
    at = now.toISOString(),
    receiptId = await requestIdentity(actor, "import", c.requestId);
  const customerId =
    c.customerId ||
    (await requestIdentity(
      { ...actor, id: `apollo:${stage.company}:${stage.branch}` },
      "customer",
      p.companyId || p.id,
    ));
  const current = c.customerId
    ? await parent(db, actor, c.customerId, ["customers"], true)
    : null;
  if (
    current &&
    (current.record.company !== stage.company ||
      current.record.branch !== stage.branch)
  )
    throw unavailable();
  if (!c.companyName.trim() || c.companyName.length > 160)
    throw new CommercialError(400, "Review the customer company name.");
  const customer: RecordItem = current?.record || {
    id: customerId,
    kind: "customers",
    company: stage.company,
    branch: stage.branch,
    title: c.companyName.trim(),
    contact: "",
    product: "",
    quantity: 0,
    unit: "",
    amount: 0,
    currency: "USD",
    status: "Active",
    ownerId: actor.id,
    owner: actor.name,
    due: "",
    detail: "",
    source: "Apollo",
    createdAt: at,
    updatedAt: at,
    attributes: {
      website: p.domain,
      country: p.country,
      apolloCompanyId: p.companyId || p.id,
      apolloImportedAt: at,
      apolloImportedBy: actor.id,
    },
  };
  if (!canWrite(actor, customer)) throw unavailable();
  let existingContact: ReturnType<typeof contactInput.parse> | null = null;
  let contactId: string | null = null,
    contactDetails: ReturnType<typeof contactInput.parse> | null = null;
  if (p.kind === "person" && c.createContact !== false) {
    if (!c.contactName?.trim())
      throw new CommercialError(
        400,
        "Review and enter the person's complete name before import.",
      );
    contactDetails = contactInput.parse({
      name: c.contactName,
      jobTitle: p.title,
      email: c.email || "",
      phone: c.phone || "",
      country: p.country,
    });
    const people = current ? await listContacts(db, actor, customerId) : [];
    if (c.contactId) {
      const found = people.find((x) => x.id === c.contactId && x.active);
      if (!found) throw unavailable();
      contactId = found.id;
      existingContact = {
        name: found.name,
        jobTitle: found.jobTitle,
        role: found.role,
        email: found.email,
        phone: found.phone,
        whatsapp: found.whatsapp,
        country: found.country,
        notes: found.notes,
        active: found.active,
      };
      contactDetails = null;
    } else {
      if (
        people.some((x) => duplicateReasons(contactDetails!, x).length) &&
        !c.createAnyway
      )
        throw new CommercialError(
          409,
          "Review the matching existing Contact before creating another person.",
        );
      contactId = await requestIdentity(actor, "import-contact", c.requestId);
    }
  }
  let product: RecordItem | null = null;
  if (c.productId) {
    product = (await parent(db, actor, c.productId, ["products"])).record;
    if (product.company !== stage.company || product.branch !== stage.branch)
      throw unavailable();
  }
  const leadId = c.createLead
    ? await requestIdentity(actor, "import-lead", c.requestId)
    : null;
  const lead: RecordItem | null = leadId
    ? {
        ...customer,
        id: leadId,
        kind: "leads",
        ownerId: actor.id,
        owner: actor.name,
        customerId,
        contactId,
        primaryContactId: null,
        productId: product?.id || null,
        title: customer.title,
        contact: contactDetails?.name || existingContact?.name || "",
        email: contactDetails?.email || existingContact?.email || "",
        phone: contactDetails?.phone || existingContact?.phone || "",
        status: "New",
        product: product?.title || "",
        source: "Apollo",
        attributes: { country: p.country },
        createdAt: at,
        updatedAt: at,
      }
    : null;
  if (lead && !canWrite(actor, lead)) throw unavailable();
  const dealId = leadId && c.createDeal !== false ? `DEAL-${leadId}` : null;
  const newRecord = (r: RecordItem) =>
    db.insert(businessRecords).values({
      id: r.id,
      kind: r.kind,
      company: r.company,
      branch: r.branch,
      ownerId: r.ownerId,
      status: r.status,
      payload: r,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  try {
    await db.batch([
      db
        .insert(auditEvents)
        .values(event(actor, customer, "Apollo reviewed import")),
      ...(current
        ? [
            db
              .update(businessRecords)
              .set({
                version: sql`CASE WHEN ${businessRecords.version}=${current.row.version} THEN ${current.row.version + 1} ELSE NULL END`,
              })
              .where(eq(businessRecords.id, customerId)),
          ]
        : [newRecord(customer)]),
      ...(contactDetails && contactId
        ? [
            db.insert(contacts).values({
              id: contactId,
              parentId: customerId,
              company: stage.company,
              branch: stage.branch,
              details: contactDetails,
              active: true,
              version: 1,
              createdAt: now,
              updatedAt: now,
            }),
          ]
        : []),
      ...(lead
        ? [
            newRecord(lead),
            ...(dealId
              ? [
                  db.insert(deals).values({
                    id: dealId!,
                    leadId: lead.id,
                    company: lead.company,
                    branch: lead.branch,
                    createdAt: now,
                  }),
                ]
              : []),
          ]
        : []),
      db.insert(apolloImports).values({
        id: receiptId,
        actorId: actor.id,
        company: stage.company,
        branch: stage.branch,
        providerId: p.id,
        providerKind: p.kind,
        customerId,
        contactId,
        leadId,
        createdAt: now,
      }),
      db
        .insert(auditEvents)
        .values(
          event(
            actor,
            customer,
            `Apollo prospect reviewed and imported${contactId ? " with Contact" : ""}${leadId ? (dealId ? "; Lead and Deal created" : "; Lead created") : ""}`,
          ),
        ),
    ]);
  } catch (e) {
    if (/constraint/i.test(String(e)))
      throw new CommercialError(
        409,
        "A matching import or customer changed. Refresh the prospect review before retrying.",
      );
    throw e;
  }
  return { customerId, contactId, leadId, dealId, replayed: false };
}
export async function enrichmentReview(
  db: Database,
  actor: Actor,
  stageId: string,
  providerId: string,
  targetId: string,
  kind: "customer" | "contact",
) {
  const { stage, prospect: p } = await staged(db, actor, stageId, providerId);
  if (
    (!stage.data.enriched || stage.fingerprint.startsWith("operation:")) &&
    !p.enrichedAt
  )
    throw new CommercialError(
      400,
      "Explicitly enrich the prospect before applying field suggestions.",
    );
  if (kind === "customer") {
    if (p.kind !== "company")
      throw new CommercialError(400, "Use company enrichment for a customer.");
    const target = await parent(db, actor, targetId, ["customers"], true);
    if (
      target.record.company !== stage.company ||
      target.record.branch !== stage.branch
    )
      throw unavailable();
    return {
      targetId,
      kind,
      version: target.row.version,
      current: {
        name: target.record.title,
        email: target.record.email || "",
        phone: target.record.phone || "",
        country: target.record.attributes?.country || "",
        website: target.record.attributes?.website || "",
      },
      suggested: {
        name: p.name,
        email: p.email,
        phone: p.phone,
        country: p.country,
        website: p.domain,
      },
    };
  }
  if (p.kind !== "person")
    throw new CommercialError(400, "Use person enrichment for a Contact.");
  const contact = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, targetId))
    .get();
  if (!contact) throw unavailable();
  const target = await parent(db, actor, contact.parentId, ["customers"], true);
  if (
    target.record.company !== stage.company ||
    target.record.branch !== stage.branch
  )
    throw unavailable();
  return {
    targetId,
    kind,
    version: contact.version,
    current: {
      name: contact.details.name,
      email: contact.details.email,
      phone: contact.details.phone,
      country: contact.details.country,
      jobTitle: contact.details.jobTitle,
    },
    suggested: {
      name: p.nameComplete ? p.name : "",
      email: p.email,
      phone: p.phone,
      country: p.country,
      jobTitle: p.title,
    },
  };
}
export async function applyEnrichment(
  db: Database,
  actor: Actor,
  c: {
    stageId: string;
    providerId: string;
    targetId: string;
    kind: "customer" | "contact";
    version: number;
    fields: string[];
  },
) {
  const review = await enrichmentReview(
    db,
    actor,
    c.stageId,
    c.providerId,
    c.targetId,
    c.kind,
  );
  if (c.version !== review.version)
    throw new CommercialError(
      409,
      "The current record changed. Review the fields again.",
    );
  const fields = [...new Set(c.fields)];
  if (!fields.length || fields.some((k) => !Object.hasOwn(review.suggested, k)))
    throw new CommercialError(400, "Select the suggested fields to apply.");
  const values: Record<string, string> = {};
  for (const k of fields) {
    const v = (review.suggested as Record<string, string | undefined>)[k];
    if (!v)
      throw new CommercialError(
        400,
        "Unavailable Apollo values cannot overwrite CRM fields.",
      );
    values[k] = v;
  }
  if (c.kind === "contact") {
    const contact = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, c.targetId))
      .get();
    if (!contact) throw unavailable();
    await saveContact(db, actor, {
      id: contact.id,
      parentId: contact.parentId,
      version: c.version,
      details: { ...contact.details, ...values },
      enrichmentAudit: true,
    });
  } else {
    const target = await parent(db, actor, c.targetId, ["customers"], true);
    const next = {
      ...target.record,
      updatedAt: new Date().toISOString(),
      attributes: { ...target.record.attributes },
    };
    for (const [k, v] of Object.entries(values)) {
      if (k === "name") next.title = v;
      else if (k === "email" || k === "phone") next[k] = v;
      else next.attributes[k] = v;
    }
    const ok = await updateRecordWithAudit(
      db,
      next.id,
      c.version,
      { status: next.status, payload: next },
      event(actor, next, "Reviewed Apollo enrichment applied"),
    );
    if (!ok)
      throw new CommercialError(409, "The record changed. Review again.");
  }
  return { ok: true };
}
