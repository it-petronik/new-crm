import { and, eq, inArray, desc, sql, type SQL } from "drizzle-orm";
import type { Database } from "../d1";
import {
  businessRecords,
  contacts,
  deals,
  supplierCapabilities,
  auditEvents,
} from "../schema";
import {
  allowedModules,
  canRead,
  canWrite,
  stages,
  type Actor,
  type Kind,
  type RecordItem,
} from "../domain";
import {
  findRecord,
  createRecordWithAudit,
  updateRecordWithAudit,
} from "../data";
import { visibleMeetings } from "../meeting-data";
import {
  capabilityInput,
  contactInput,
  CommercialError,
  duplicateReasons,
  normalizedName,
  unavailable,
  type Capability,
  type Contact,
} from "./model";

/** SQL counterpart of canRead. A second canRead check protects future rule changes. */
export function recordScope(actor: Actor): SQL {
  const kinds = allowedModules(actor).filter(
    (k) => !["overview", "approvals", "activity", "settings", "hr"].includes(k),
  );
  if (!actor.companies.length || !kinds.length) return sql`0`;
  return and(
    inArray(businessRecords.company, actor.companies),
    actor.branches.length
      ? inArray(businessRecords.branch, actor.branches)
      : undefined,
    inArray(businessRecords.kind, kinds),
    sql`json_extract(${businessRecords.payload}, '$.deletedAt') IS NULL`,
    ["Sales Executive", "Logistics Executive", "Employee"].includes(actor.role)
      ? sql`(${businessRecords.kind} IN ('products','customers') OR ${businessRecords.ownerId} = ${actor.id})`
      : undefined,
  )!;
}
export async function readRecords(
  db: Database,
  actor: Actor,
  predicate?: SQL,
  limit = 200,
) {
  const rows = await db
    .select()
    .from(businessRecords)
    .where(and(recordScope(actor), predicate))
    .orderBy(desc(businessRecords.updatedAt))
    .limit(Math.min(limit, 1000));
  return rows
    .map((r) => r.payload as RecordItem)
    .filter((r) => !r.deletedAt && canRead(actor, r));
}
export async function parent(
  db: Database,
  actor: Actor,
  id: string,
  kinds?: string[],
  write = false,
) {
  const row = await findRecord(db, id);
  const r = row?.payload as RecordItem | undefined;
  if (
    !row ||
    !r ||
    r.deletedAt ||
    !canRead(actor, r) ||
    (kinds && !kinds.includes(r.kind)) ||
    (write && !canWrite(actor, r))
  )
    throw unavailable();
  return { row, record: r };
}
function sameScope(a: RecordItem, b: { company: string; branch: string }) {
  if (a.company !== b.company || a.branch !== b.branch)
    throw new CommercialError(
      400,
      "The relationship must belong to the same company and branch.",
    );
}
function audit(actor: Actor, r: RecordItem, action: string) {
  return {
    id: crypto.randomUUID(),
    company: r.company,
    actor: actor.name,
    actorId: actor.id,
    action,
    recordId: r.id,
    at: new Date(),
  };
}
function guard(db: Database, id: string, version: number) {
  return db
    .update(businessRecords)
    .set({
      version: sql`CASE WHEN ${businessRecords.version}=${version} THEN ${version + 1} ELSE NULL END`,
      updatedAt: new Date(),
    })
    .where(eq(businessRecords.id, id));
}
function stale(error: unknown): never {
  if (/NOT NULL constraint failed: .*version/.test(String(error)))
    throw new CommercialError(
      409,
      "This record changed. Refresh and try again.",
    );
  throw error;
}
export async function resolveLinks(
  db: Database,
  actor: Actor,
  r: RecordItem,
  previous?: RecordItem,
) {
  const next = { ...r };
  if (next.customerId) {
    const { record: customer } = await parent(db, actor, next.customerId, [
      "customers",
    ]);
    sameScope(next, customer);
    if (
      !["leads", "quotations", "orders", "logistics", "accounts"].includes(
        next.kind,
      )
    )
      throw new CommercialError(400, "This record cannot link a customer.");
    next.title = customer.title;
  }
  if (next.contactId) {
    const c = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, next.contactId))
      .get();
    if (
      !c ||
      c.parentId !== next.customerId ||
      (!c.active && previous?.contactId !== c.id)
    )
      throw new CommercialError(
        400,
        "Choose an active contact belonging to this customer.",
      );
    sameScope(next, c);
    // Customer access was independently checked above.
    next.contact = c.details.name;
    next.email = c.details.email;
    next.phone = c.details.phone;
  }
  if (next.productId) {
    const { record: product } = await parent(db, actor, next.productId, [
      "products",
    ]);
    sameScope(next, product);
    next.product = product.title;
  }
  if (next.primaryContactId) {
    const c = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, next.primaryContactId))
      .get();
    if (!c || c.parentId !== next.id || !c.active)
      throw new CommercialError(
        400,
        "Choose an active contact belonging to this record.",
      );
  }
  if (next.dealId) {
    const deal = await db
      .select()
      .from(deals)
      .where(eq(deals.id, next.dealId))
      .get();
    if (!deal) throw unavailable();
    const { record: lead } = await parent(db, actor, deal.leadId, ["leads"]);
    sameScope(next, lead);
    if (
      next.id !== lead.id &&
      next.parentId !== lead.id &&
      previous?.dealId !== next.dealId
    )
      throw new CommercialError(
        400,
        "Deal must belong to the originating lead.",
      );
    if (
      (!previous || previous.dealId !== next.dealId) &&
      next.customerId !== lead.customerId
    )
      throw new CommercialError(400, "Deal and lead customer must agree.");
  }
  return next;
}

export async function listContacts(
  db: Database,
  actor: Actor,
  parentId: string,
): Promise<Contact[]> {
  await parent(db, actor, parentId, ["customers", "suppliers"]);
  const rows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.parentId, parentId))
    .limit(200);
  return rows.map((c) => ({
    ...c.details,
    active: c.active,
    id: c.id,
    parentId: c.parentId,
    version: c.version,
  }));
}
export async function saveContact(
  db: Database,
  actor: Actor,
  input: {
    parentId: string;
    id?: string;
    version?: number;
    details: unknown;
    requestId?: string;
    enrichmentAudit?: boolean;
  },
) {
  const { row, record } = await parent(
    db,
    actor,
    input.parentId,
    ["customers", "suppliers"],
    true,
  );
  const details = contactInput.parse(input.details);
  const existing = input.id
    ? await db.select().from(contacts).where(eq(contacts.id, input.id)).get()
    : undefined;
  if (input.id && (!existing || existing.parentId !== record.id))
    throw unavailable();
  if (existing && input.version !== existing.version)
    throw new CommercialError(
      409,
      "This contact changed. Refresh and try again.",
    );
  const id =
    existing?.id ||
    (input.requestId
      ? await stableId(actor.id, `contact:${record.id}:${input.requestId}`)
      : crypto.randomUUID());
  if (!existing) {
    const retry = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, id))
      .get();
    if (retry && retry.parentId === record.id) return retry.id;
  }
  const now = new Date();
  try {
    await db.batch([
      guard(db, record.id, row.version),
      existing
        ? db
            .update(contacts)
            .set({
              details,
              active: details.active,
              updatedAt: now,
              version: sql`CASE WHEN ${contacts.version}=${input.version!} THEN ${contacts.version}+1 ELSE NULL END`,
            })
            .where(eq(contacts.id, id))
        : db
            .insert(contacts)
            .values({
              id,
              parentId: record.id,
              company: record.company,
              branch: record.branch,
              details,
              active: details.active,
              createdAt: now,
              updatedAt: now,
            }),
      db
        .insert(auditEvents)
        .values(
          audit(
            actor,
            record,
            input.enrichmentAudit ? "Reviewed Apollo enrichment applied to Contact" : existing ? "Contact updated" : "Contact created",
          ),
        ),
    ]);
  } catch (e) {
    stale(e);
  }
  return id;
}
export async function saveCapability(
  db: Database,
  actor: Actor,
  input: {
    supplierId: string;
    productId: string;
    id?: string;
    version?: number;
    details: unknown;
  },
) {
  const { row, record } = await parent(
    db,
    actor,
    input.supplierId,
    ["suppliers"],
    true,
  );
  const { row: productRow, record: product } = await parent(
    db,
    actor,
    input.productId,
    ["products"],
  );
  sameScope(record, product);
  const details = capabilityInput.parse(input.details);
  const existing = input.id
    ? await db
        .select()
        .from(supplierCapabilities)
        .where(eq(supplierCapabilities.id, input.id))
        .get()
    : undefined;
  if (
    input.id &&
    (!existing ||
      existing.supplierId !== record.id ||
      existing.productId !== product.id)
  )
    throw unavailable();
  if (existing && input.version !== existing.version)
    throw new CommercialError(
      409,
      "This capability changed. Refresh and try again.",
    );
  const id = existing?.id || crypto.randomUUID();
  const now = new Date();
  try {
    await db.batch([
      guard(db, record.id, row.version),
      guard(db, product.id, productRow.version),
      existing
        ? db
            .update(supplierCapabilities)
            .set({
              details,
              active: details.active,
              updatedAt: now,
              version: sql`CASE WHEN ${supplierCapabilities.version}=${input.version!} THEN ${supplierCapabilities.version}+1 ELSE NULL END`,
            })
            .where(eq(supplierCapabilities.id, id))
        : db
            .insert(supplierCapabilities)
            .values({
              id,
              supplierId: record.id,
              productId: product.id,
              company: record.company,
              branch: record.branch,
              details,
              active: details.active,
              createdAt: now,
              updatedAt: now,
            }),
      db
        .insert(auditEvents)
        .values(audit(actor, record, "Supplier capability changed")),
    ]);
  } catch (e) {
    stale(e);
  }
  return id;
}
export async function openDeal(db: Database, actor: Actor, leadId: string) {
  const { row, record } = await parent(db, actor, leadId, ["leads"]);
  const found = await db
    .select()
    .from(deals)
    .where(eq(deals.leadId, leadId))
    .get();
  if (found) return found;
  if (!canWrite(actor, record)) throw unavailable();
  const id = crypto.randomUUID();
  const now = new Date();
  try {
    await db.batch([
      guard(db, leadId, row.version),
      db
        .insert(deals)
        .values({
          id,
          leadId,
          company: record.company,
          branch: record.branch,
          createdAt: now,
        }),
      db.insert(auditEvents).values(audit(actor, record, "Deal created")),
    ]);
  } catch (e) {
    const retry = await db
      .select()
      .from(deals)
      .where(eq(deals.leadId, leadId))
      .get();
    if (retry) return retry;
    stale(e);
  }
  return {
    id,
    leadId,
    company: record.company,
    branch: record.branch,
    createdAt: now,
  };
}

export async function changeLinks(
  db: Database,
  actor: Actor,
  input: {
    id: string;
    expectedUpdatedAt: string;
    customerId?: string | null;
    contactId?: string | null;
    productId?: string | null;
    primaryContactId?: string | null;
    confirmReassignment?: boolean;
  },
) {
  const { row, record } = await parent(db, actor, input.id, undefined, true);
  if (
    !["leads", "customers", "suppliers", "quotations"].includes(record.kind) ||
    (record.kind === "quotations" &&
      ["Approved", "Accepted"].includes(record.status))
  )
    throw new CommercialError(400, "Relationships on this record are locked.");
  if (record.updatedAt !== input.expectedUpdatedAt)
    throw new CommercialError(
      409,
      "This record changed. Refresh and try again.",
    );
  const changedCustomer =
    input.customerId !== undefined && input.customerId !== record.customerId;
  if (changedCustomer && record.customerId && !input.confirmReassignment)
    throw new CommercialError(
      409,
      "Confirm changing the customer and clearing the previous contact.",
    );
  const next: RecordItem = { ...record, updatedAt: new Date().toISOString() };
  for (const key of [
    "customerId",
    "contactId",
    "productId",
    "primaryContactId",
  ] as const)
    if (input[key] !== undefined) next[key] = input[key];
  if (changedCustomer) {
    next.contactId = input.contactId || null;
    next.contact = "";
    next.email = "";
    next.phone = "";
  }
  const resolved = await resolveLinks(db, actor, next, record);
  if (
    !(await updateRecordWithAudit(
      db,
      record.id,
      row.version,
      { payload: resolved, status: resolved.status },
      audit(actor, record, "Commercial relationships reviewed"),
    ))
  )
    throw new CommercialError(
      409,
      "This record changed. Refresh and try again.",
    );
  return resolved;
}
async function stableId(actor: string, key: string) {
  return (
    "COM-" +
    [
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(`${actor}:${key}`),
        ),
      ),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 40)
  );
}
export async function quickCustomer(
  db: Database,
  actor: Actor,
  input: {
    company: string;
    branch: string;
    title: string;
    country?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    requestId: string;
    createAnyway?: boolean;
  },
) {
  const now = new Date().toISOString();
  const id = await stableId(actor.id, `customer:${input.requestId}`);
  const record: RecordItem = {
    id,
    kind: "customers",
    company: input.company,
    branch: input.branch,
    title: input.title.trim(),
    contact: input.contactName || "",
    email: input.email || "",
    phone: input.phone || "",
    product: "",
    quantity: 0,
    unit: "",
    amount: 0,
    currency: "USD",
    status: stages.customers[0],
    ownerId: actor.id,
    owner: actor.name,
    due: "",
    detail: "",
    source: "Commercial quick create",
    createdAt: now,
    updatedAt: now,
    attributes: { country: input.country || "" },
  };
  if (!canWrite(actor, record)) throw unavailable();
  const retry = await findRecord(db, id);
  if (retry) {
    await parent(db, actor, id, ["customers"]);
    return { record: retry.payload as RecordItem };
  }
  const possible = await duplicates(db, actor, input);
  if (possible.length && !input.createAnyway) return { duplicates: possible };
  const contact = input.contactName
    ? contactInput.parse({
        name: input.contactName,
        email: input.email || "",
        phone: input.phone || "",
      })
    : null;
  const contactId = contact
    ? await stableId(actor.id, `primary:${input.requestId}`)
    : null;
  try {
    if (!contact)
      await createRecordWithAudit(
        db,
        {
          id,
          kind: record.kind,
          company: record.company,
          branch: record.branch,
          ownerId: actor.id,
          status: record.status,
          payload: record,
        },
        audit(actor, record, "Customer created"),
      );
    else
      await db.batch([
        db
          .insert(businessRecords)
          .values({
            id,
            kind: record.kind,
            company: record.company,
            branch: record.branch,
            ownerId: actor.id,
            status: record.status,
            payload: record,
            createdAt: new Date(now),
            updatedAt: new Date(now),
          }),
        db
          .insert(contacts)
          .values({
            id: contactId!,
            parentId: id,
            company: record.company,
            branch: record.branch,
            details: contact,
            active: true,
            createdAt: new Date(now),
            updatedAt: new Date(now),
          }),
        db
          .update(businessRecords)
          .set({ payload: { ...record, primaryContactId: contactId } })
          .where(eq(businessRecords.id, id)),
        db
          .insert(auditEvents)
          .values(audit(actor, record, "Customer and contact created")),
      ]);
  } catch (e) {
    const concurrent = await findRecord(db, id);
    if (concurrent && canRead(actor, concurrent.payload as RecordItem))
      return { record: concurrent.payload as RecordItem };
    throw e;
  }
  return { record: { ...record, primaryContactId: contactId } };
}
export async function duplicates(
  db: Database,
  actor: Actor,
  input: {
    company: string;
    branch: string;
    title?: string;
    email?: string;
    phone?: string;
  },
) {
  // Deliberately deterministic and bounded. No disclosure outside parent permissions.
  const rows = await readRecords(
    db,
    actor,
    and(
      eq(businessRecords.kind, "customers"),
      eq(businessRecords.company, input.company),
      eq(businessRecords.branch, input.branch),
    ),
    1000,
  );
  return rows
    .map((r) => ({
      id: r.id,
      title: r.title,
      reasons: duplicateReasons(input, r),
    }))
    .filter((r) => r.reasons.length)
    .slice(0, 20);
}

export async function capabilities(
  db: Database,
  actor: Actor,
  root: RecordItem,
  activeOnly = false,
): Promise<Capability[]> {
  const predicate =
    root.kind === "suppliers"
      ? eq(supplierCapabilities.supplierId, root.id)
      : eq(supplierCapabilities.productId, root.productId || root.id);
  const rows = await db
    .select()
    .from(supplierCapabilities)
    .where(
      and(
        predicate,
        activeOnly ? eq(supplierCapabilities.active, true) : undefined,
        eq(supplierCapabilities.company, root.company),
        eq(supplierCapabilities.branch, root.branch),
      ),
    )
    .limit(200);
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.supplierId, r.productId]))];
  const visible: RecordItem[] = [];
  for (let i = 0; i < ids.length; i += 80)
    visible.push(
      ...(await readRecords(
        db,
        actor,
        inArray(businessRecords.id, ids.slice(i, i + 80)),
        200,
      )),
    );
  const map = new Map(visible.map((r) => [r.id, r]));
  return rows
    .filter(
      (r) =>
        map.has(r.supplierId) &&
        map.has(r.productId) &&
        (!activeOnly || map.get(r.supplierId)!.status !== "Inactive"),
    )
    .map((r) => ({
      ...r.details,
      active: r.active,
      id: r.id,
      supplierId: r.supplierId,
      productId: r.productId,
      version: r.version,
      supplier: map.get(r.supplierId)!.title,
      product: map.get(r.productId)!.title,
    }));
}
export async function commercialView(
  db: Database,
  actor: Actor,
  id: string,
  isDeal = false,
) {
  const deal = isDeal
    ? await db.select().from(deals).where(eq(deals.id, id)).get()
    : undefined;
  if (isDeal && !deal) throw unavailable();
  const { record: root } = await parent(db, actor, deal?.leadId || id, [
    "customers",
    "suppliers",
    "products",
    "leads",
  ]);
  const linkKey = root.kind === "products" ? "productId" : "customerId";
  let linked =
    root.kind === "suppliers"
      ? []
      : await readRecords(
          db,
          actor,
          root.kind === "leads"
            ? sql`(json_extract(${businessRecords.payload},'$.parentId')=${root.id} OR json_extract(${businessRecords.payload},'$.dealId')=${deal?.id || ""})`
            : root.kind === "products"
              ? sql`json_extract(${businessRecords.payload},'$.productId')=${root.id}`
              : sql`json_extract(${businessRecords.payload},'$.customerId')=${root.id}`,
        );
  // Deals can be opened after a legacy quotation was accepted. Follow existing
  // parent IDs in bounded batches, without backfilling or traversing hidden rows.
  if (root.kind === "leads") {
    const seen = new Map(linked.map(r => [r.id, r]));
    let frontier = linked.map(r => r.id);
    for (let depth = 0; depth < 3 && frontier.length && seen.size < 200; depth++) {
      const next: string[] = [];
      for (let start = 0; start < frontier.length && seen.size < 200; start += 80) {
        const children = await readRecords(db, actor, and(
          eq(businessRecords.company, root.company),
          eq(businessRecords.branch, root.branch),
          inArray(sql`json_extract(${businessRecords.payload},'$.parentId')`, frontier.slice(start, start + 80)),
        ), 200 - seen.size);
        for (const child of children) if (!seen.has(child.id)) {
          seen.set(child.id, child);
          next.push(child.id);
        }
      }
      frontier = next;
    }
    linked = [...seen.values()];
  }
  // Direct relational lookup is indexed and never scans the workspace's first page.
  linked = linked.filter(
    (r) => r.company === root.company && r.branch === root.branch,
  );
  let legacy: RecordItem[] = [];
  if (root.kind === "customers") {
    const names = await readRecords(
      db,
      actor,
      and(
        eq(businessRecords.company, root.company),
        eq(businessRecords.branch, root.branch),
        sql`json_extract(${businessRecords.payload},'$.customerId') IS NULL`,
        inArray(businessRecords.kind, [
          "leads",
          "quotations",
          "orders",
          "logistics",
          "accounts",
        ]),
      ),
      1000,
    );
    legacy = names
      .filter((r) => normalizedName(r.title) === normalizedName(root.title))
      .slice(0, 50);
  }
  const master = root.customerId
    ? await readRecords(db, actor, eq(businessRecords.id, root.customerId), 1)
    : [];
  const contactParent = ["customers", "suppliers"].includes(root.kind)
    ? root.id
    : master[0]?.id;
  const people = contactParent
    ? await listContacts(db, actor, contactParent)
    : [];
  const caps =
    ["suppliers", "products"].includes(root.kind) ||
    (root.kind === "leads" && root.productId)
      ? await capabilities(db, actor, root, root.kind === "leads")
      : [];
  if (root.kind === "suppliers" && caps.some((c) => c.active)) {
    const products = [
      ...new Set(caps.filter((c) => c.active).map((c) => c.productId)),
    ];
    linked = await readRecords(
      db,
      actor,
      and(
        eq(businessRecords.kind, "leads"),
        inArray(
          sql`json_extract(${businessRecords.payload},'$.productId')`,
          products,
        ),
      ),
    );
  }
  const matches =
    root.kind === "leads"
      ? caps.filter(
          (c) =>
            !root.attributes?.grade ||
            !c.grade ||
            normalizedName(c.grade) === normalizedName(root.attributes.grade),
        )
      : caps;
  const ids = [root.id, ...master.map((r) => r.id), ...linked.map((r) => r.id)];
  const meetings = (await visibleMeetings(db, actor))
    .filter((m) => m.relatedRecordId && ids.includes(m.relatedRecordId))
    .map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      scheduledAt: m.scheduledAt?.toISOString() || null,
    }))
    .slice(0, 20);
  const leadIds =
    root.kind === "leads"
      ? [root.id]
      : linked.filter((r) => r.kind === "leads").map((r) => r.id);
  const rooms = leadIds.length
    ? await db
        .select()
        .from(deals)
        .where(inArray(deals.leadId, leadIds))
        .limit(200)
    : [];
  return {
    root,
    deal: deal || rooms.find((d) => d.leadId === root.id) || null,
    customer: master[0] || null,
    contacts: people,
    capabilities: matches,
    linked,
    legacy,
    deals: rooms,
    meetings,
    coverage:
      "Up to 200 authorized linked records, contacts and capabilities; possible legacy matches are separate and never counted as linked history.",
  };
}
export type CommercialView = Awaited<ReturnType<typeof commercialView>>;

export async function searchCommercial(
  db: Database,
  actor: Actor,
  query: string,
  kind?: Kind,
  company?: string,
  branch?: string,
) {
  const needle = query.trim().slice(0, 100);
  if (needle.length < 2) return [];
  const escaped = `%${needle.replace(/[!%_]/g, (c) => `!${c}`)}%`;
  const records = await readRecords(
    db,
    actor,
    and(
      kind
        ? eq(businessRecords.kind, kind)
        : inArray(businessRecords.kind, [
            "customers",
            "suppliers",
            "products",
            "leads",
          ]),
      company ? eq(businessRecords.company, company) : undefined,
      branch ? eq(businessRecords.branch, branch) : undefined,
      sql`json_extract(${businessRecords.payload},'$.title') LIKE ${escaped} ESCAPE '!'`,
    ),
    30,
  );
  const out: {
    id: string;
    parentId: string;
    kind: string;
    label: string;
    detail: string;
  }[] = records.map((r) => ({
    id: r.id,
    parentId: r.id,
    kind: r.kind,
    label: r.title,
    detail: `${r.kind} · ${r.company} · ${r.branch}`,
  }));
  if (!kind) {
    const people = await db
      .select({ contact: contacts, parent: businessRecords })
      .from(contacts)
      .innerJoin(businessRecords, eq(contacts.parentId, businessRecords.id))
      .where(
        and(
          recordScope(actor),
          eq(contacts.active, true),
          sql`json_extract(${contacts.details},'$.name') LIKE ${escaped} ESCAPE '!'`,
        ),
      )
      .limit(20);
    out.push(
      ...people
        .filter((p) => canRead(actor, p.parent.payload as RecordItem))
        .map((p) => ({
          id: p.contact.id,
          parentId: p.contact.parentId,
          kind: "contacts",
          label: p.contact.details.name,
          detail: `Contact · ${(p.parent.payload as RecordItem).title}`,
          targetKind: p.parent.kind,
        })),
    );
    const rooms = await db
      .select({ deal: deals, lead: businessRecords })
      .from(deals)
      .innerJoin(businessRecords, eq(deals.leadId, businessRecords.id))
      .where(
        and(
          recordScope(actor),
          sql`json_extract(${businessRecords.payload},'$.title') LIKE ${escaped} ESCAPE '!'`,
        ),
      )
      .limit(20);
    out.push(
      ...rooms
        .filter((p) => canRead(actor, p.lead.payload as RecordItem))
        .map((p) => ({
          id: p.deal.id,
          parentId: p.deal.leadId,
          kind: "deals",
          label: (p.lead.payload as RecordItem).title,
          detail: "Deal Room",
          targetKind: "leads",
        })),
    );
  }
  return out.slice(0, 40);
}

/** A new quotation inherits authoritative links from its authorized Lead. */
export async function inheritLeadLinks(
  db: Database,
  actor: Actor,
  record: RecordItem,
) {
  if (record.kind !== "quotations" || !record.parentId) return record;
  const { record: lead } = await parent(db, actor, record.parentId, ["leads"]);
  sameScope(record, lead);
  const deal = await db
    .select()
    .from(deals)
    .where(eq(deals.leadId, lead.id))
    .get();
  for (const key of ["customerId", "contactId", "productId"] as const)
    if (record[key] && lead[key] && record[key] !== lead[key])
      throw new CommercialError(
        400,
        "Quotation relationships must match the originating Lead.",
      );
  return {
    ...record,
    customerId: lead.customerId || record.customerId || null,
    contactId: lead.contactId || record.contactId || null,
    productId: lead.productId || record.productId || null,
    dealId: deal?.id || null,
  };
}
export async function hasCommercialHistory(db: Database, id: string) {
  const found = await db.get<{ linked: number }>(
    sql`SELECT EXISTS(SELECT 1 FROM Contact WHERE parentId=${id}) OR EXISTS(SELECT 1 FROM Deal WHERE leadId=${id}) OR EXISTS(SELECT 1 FROM SupplierProductCapability WHERE supplierId=${id} OR productId=${id}) OR EXISTS(SELECT 1 FROM BusinessRecord WHERE json_extract(payload,'$.customerId')=${id} OR json_extract(payload,'$.productId')=${id}) AS linked`,
  );
  return !!found?.linked;
}

export async function existingDealForQuote(db:Database, actor:Actor, quote:RecordItem) {
  if(!quote.parentId)return null;
  const lead=(await readRecords(db,actor,and(eq(businessRecords.id,quote.parentId),eq(businessRecords.kind,"leads")),1))[0];
  if(!lead || lead.company!==quote.company || lead.branch!==quote.branch || (lead.customerId??null)!==(quote.customerId??null))return null;
  return (await db.select().from(deals).where(eq(deals.leadId,lead.id)).get())?.id || null;
}

/** Operational readers may edit a shipment without gaining its Customer module. */
export async function resolveSnapshotEdit(db: Database, actor: Actor, changed: RecordItem, previous: RecordItem) {
  try { return await resolveLinks(db,actor,changed,previous); }
  catch(error) {
    const unchanged = (["customerId","contactId","productId","dealId"] as const).every(key=>(changed[key]??null)===(previous[key]??null));
    if (!(error instanceof CommercialError) || error.status!==404 || !unchanged) throw error;
    // Do not resolve or expose a newly inaccessible parent's current details.
    // Preserve already-authorized historical snapshots; unrelated edits proceed.
    return {...changed,
      ...(previous.customerId ? {title:previous.title}:{}),
      ...(previous.contactId ? {contact:previous.contact,email:previous.email,phone:previous.phone}:{}),
      ...(previous.productId ? {product:previous.product}:{}),
    };
  }
}
