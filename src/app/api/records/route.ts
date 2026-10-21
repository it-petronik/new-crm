import { resolveLinks, inheritLeadLinks, hasCommercialHistory, existingDealForQuote, resolveSnapshotEdit, newRecordContact } from "@/lib/commercial/store";
import { NextResponse } from "next/server";
import { contentError } from "@/lib/content-calendar";
import { CommercialError } from "@/lib/commercial/model";
import { z } from "zod";
import { getDb, isPreview } from "@/lib/db";
import {
  listRecordsForActor, listAuditEvents, findRecord, listRecordsForCompany,
  createRecordWithAudit, updateRecordWithAudit, RECORD_PAGE_LIMIT, type NewRecord,
} from "@/lib/data";
import { checkOrigin, currentActor } from "@/lib/auth";
import {
  canRead,
  canWrite,
  allowedModules,
  scopedWorkspace,
  stages,
  totalCents,
  isProforma,
  type RecordItem,
} from "@/lib/domain";
import { transition, addNote, recordPayment, assign } from "@/lib/workflow";
import { findUserById } from "@/lib/data";
import { mayOwn } from "@/lib/notification-rules";
import { toPerson } from "@/lib/notification-store";
import { notifyRecordChange, runAutomation } from "@/lib/notify";
import { automationOutbox } from "@/lib/tasks/automation";
import { quotationError } from "@/lib/quotation";
import { mutateRecord } from "@/lib/record-mutations";
import { isCashEntry, cashEntryError } from "@/lib/cashbook";
import { salaryAttributes } from "@/lib/salary";
import { employeeHasHrHistory } from "@/lib/hr/store";
import { proformaAttributeKeys, proformaError, proformaReference } from "@/lib/proforma";
import { applyLeadFeedback, initializeLead, leadFeedbackSchema, leadTypes } from "@/lib/lead-desk";
/**
 * Optional per-submission key. The browser generates one when a create form
 * opens, so a double-click, a retry or a flaky connection replays the same key
 * and resolves to the same record id instead of creating a second lead or
 * quotation. Absent, behaviour is unchanged.
 */
const requestIdField = {
  requestId: z.string().min(8).max(100).optional(),
  /**
   * Marks a creation as coming from a CSV import so the audit entry says so.
   * It never becomes part of the record and never carries file contents — only
   * a batch identifier, so a set of imported rows can be traced together.
   */
  importBatch: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
};

const sha256Hex = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/**
 * Field-level messages in plain words, keyed by field name, so the form can
 * show each beside its own field instead of one generic failure.
 */
const fieldLabels: Record<string, string> = {
  title: "Name", contact: "Contact", email: "Email", phone: "Phone", quantity: "Quantity",
  amount: "Value", due: "Date", product: "Product", destination: "Destination", unit: "Unit", currency: "Currency",
};
function fieldErrors(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".");
    if (!key || fields[key]) continue;
    const label = fieldLabels[key] || (key.startsWith("attributes.") ? "This field" : key);
    const numeric = "origin" in issue && issue.origin === "number";
    const minimum = "minimum" in issue ? Number(issue.minimum) : 0;
    fields[key] =
      key === "email" ? "Enter a valid email address, like name@company.com."
      : key === "due" ? "Choose a valid date."
      : issue.code === "too_small" && numeric ? `${label} must be ${minimum} or more.`
      : issue.code === "too_small" && minimum <= 1 ? `${label} is required.`
      : issue.code === "too_small" ? `${label} needs at least ${minimum} characters.`
      : issue.code === "too_big" && numeric ? `${label} is too large.`
      : issue.code === "too_big" ? `${label} is too long.`
      : `Check ${label.toLowerCase()}.`;
  }
  return fields;
}

const input = z.object({
  kind: z.enum([
    "leads",
    "quotations",
    "orders",
    "logistics",
    "accounts",
    "customers",
    "suppliers",
    "products",
    "hr",
    "marketing",
    "it",
    "leave",
  ]),
  company: z.string().max(80),
  branch: z.string().min(1).max(80),
  title: z.string().min(2).max(160),
  contact: z.string().max(160),
  product: z.string().max(160),
  quantity: z.number().min(0).max(100000000),
  unit: z.string().max(20),
  amount: z.number().min(0).max(1000000000),
  currency: z.enum(["USD", "AED", "EUR", "SGD"]),
  due: z.iso.date(),
  detail: z.string().max(5000),
  source: z.string().max(80),
  lines: z
    .array(
      z.object({
        description: z.string().min(1).max(200),
        itemName: z.string().max(160).optional(),
        packaging: z.string().max(100).optional(),
        quantity: z.number().positive().max(1000000),
        unitPriceCents: z.number().int().min(0).max(100000000),
      }),
    )
    .max(100)
    .optional(),
  customerId: z.string().max(100).nullable().optional(),
  contactId: z.string().max(100).nullable().optional(),
  productId: z.string().max(100).nullable().optional(),
  dealId: z.string().max(100).nullable().optional(),
  parentId: z.string().max(100).optional(),
  assigneeId: z.string().min(1).max(100).optional(),
  email: z.union([z.email(), z.literal("")]).optional(),
  phone: z.string().max(50).optional(),
  destination: z.string().max(160).optional(),
  attributes: z
    .partialRecord(
      z.enum([
        "leadType", "grade",
        "contentType", "contentStage", "contentFormat", "contentTime", "contentTimezone", "contentAsset",
        "incoterm",
        "entryType",
        "paymentMethod",
        "reference",
        "paymentTerms",
        "segment",
        "sku",
        "packaging",
        "department",
        "employeeId",
        "employeeRole",
        "workArrangement",
        "monthlySalary",
        "basicSalary",
        "allowance",
        "salaryCurrency",
        "category",
        "priority",
        "audience",
        "country",
        "address",
        "taxNumber",
        "website",
        "supplierCode",
        "leadTime",
        "issuedDate",
        "quoteReference",
        "senderName",
        "senderAddress",
        "senderTaxNumber",
        "senderPhone",
        "senderWebsite",
        "senderEmail",
        "footerMessage",
        "signaturePlan",
        "customerAddress",
        "customerTaxNumber",
        "signatoryName",
        "signatoryTitle",
        "amountWords",
        ...proformaAttributeKeys,
      ]),
      z.string().max(300),
    )
    .optional(),
  ...requestIdField,
});
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor)
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const db = await getDb();
  if (!db)
    return NextResponse.json(
      scopedWorkspace(actor, { records: [], audit: [] }),
      { headers: { "Cache-Control": "no-store" } },
    );
  const url = new URL(request.url);
  // One record by id, for a notification's deep link to something outside
  // the loaded page. The normal read rule applies: a notification never
  // grants access to what it points at.
  const single = url.searchParams.get("id");
  if (single) {
    const row = single.length <= 100 ? await findRecord(db, single) : undefined;
    const record = row?.payload as RecordItem | undefined;
    if (!record || record.deletedAt || !canRead(actor, record))
      return NextResponse.json({ error: "This record is not available to you." }, { status: 404 });
    return NextResponse.json({ record }, { headers: { "Cache-Control": "no-store" } });
  }
  // Company and branch scope are applied by the database, not by filtering a
  // full table read in memory; the page bound keeps one request inside the
  // Workers CPU budget however large the table grows.
  const limit = Number(url.searchParams.get("limit")) || RECORD_PAGE_LIMIT;
  const offset = Number(url.searchParams.get("offset")) || 0;
  const kindParam = url.searchParams.get("kind");
  const parsedKind = kindParam ? input.shape.kind.safeParse(kindParam) : null;
  if (parsedKind && !parsedKind.success) return NextResponse.json({ error:"Choose an available workspace page." }, { status:400 });
  const kind = parsedKind?.success ? parsedKind.data : undefined;
  if (kind && !allowedModules(actor).includes(kind === "leave" ? "hr" : kind)) return NextResponse.json({ error:"This page is not included in your access." }, { status:403 });
  const rows = await listRecordsForActor(
    db,
    actor.companies,
    actor.branches,
    Number.isFinite(limit) && limit > 0 ? limit : RECORD_PAGE_LIMIT,
    Number.isFinite(offset) && offset > 0 ? offset : 0,
    actor,
    kind,
  );
  const events = await listAuditEvents(db, 200);
  return NextResponse.json(
    scopedWorkspace(actor, {
      records: rows.map((r) => r.payload as RecordItem),
      audit: events.map((a) => ({
        id: a.id, actor: a.actor, action: a.action,
        recordId: a.recordId, company: a.company, at: a.at.toISOString(),
        subject: a.subject, branch: a.branch,
      })),
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (isPreview())
      return NextResponse.json(
        { error: "Preview uses local fictional data." },
        { status: 409 },
      );
    const actor = await currentActor();
    if (!actor)
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
    const parsed = input.safeParse(await request.json());
    if (!parsed.success) {
      const fields = fieldErrors(parsed.error);
      return NextResponse.json({ error: Object.values(fields)[0] || "Check the highlighted fields.", fields }, { status: 400 });
    }
    const body = parsed.data;
    // A quote must not smuggle a proforma marker into the invoice created
    // by quotation acceptance. Only Accounts may create this document type.
    if (body.attributes?.documentType && !isProforma(body))
      return NextResponse.json({ error: "Customer proformas must be created from Accounts." }, { status: 400 });
    const contentProblem = contentError(body);
    if (contentProblem) return NextResponse.json({error:contentProblem},{status:400});
    if(body.kind === "hr") body.attributes = salaryAttributes(body.attributes);
    const quoteError =
      body.kind === "quotations"
        ? quotationError(
            body.lines || [],
            body.attributes?.issuedDate || "",
            body.due,
          )
        : "";
    if (quoteError)
      return NextResponse.json({ error: quoteError }, { status: 400 });
    const now = new Date().toISOString();
    // A deterministic id turns a repeated submission into the same row, which
    // the primary key then rejects as a duplicate rather than duplicating the
    // record. Scoped to the actor so one user's key cannot collide with or
    // overwrite another's.
    const id = body.requestId
      ? "REQ-" + (await sha256Hex(`${actor.id}:${body.requestId}`)).slice(0, 40)
      : crypto.randomUUID();
    if (body.requestId) {
      const existing = await findRecord(db, id);
      if (existing && canWrite(actor, existing.payload as RecordItem))
        return NextResponse.json(
          { record: existing.payload as RecordItem, duplicate: true },
          { status: 200 },
        );
    }
    // Both keys are transport metadata, not part of the record.
    const { requestId: _requestId, importBatch, assigneeId, ...fields } = body;
    let record: RecordItem = {
      ...fields,
      id,
      status: isCashEntry(body) ? "Recorded" : stages[body.kind][0],
      ownerId: actor.id,
      owner: actor.name,
      createdAt: now,
      updatedAt: now,
    };
    if (!canWrite(actor, record))
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    if (record.kind === "leads") {
      if (record.attributes?.leadType && ![...leadTypes, "Unclassified"].includes(record.attributes.leadType)) return NextResponse.json({ error: "Choose an available lead type." }, { status: 400 });
      record = initializeLead(record, actor, { imported: Boolean(importBatch) });
      if (assigneeId && assigneeId !== actor.id) {
        const user = await findUserById(db, assigneeId);
        if (!user || !mayOwn(toPerson(user), record))
          return NextResponse.json({ error: "Choose an active salesperson with access to this brand." }, { status: 400 });
        record = { ...record, ownerId: user.id, owner: user.name, attributes: { ...record.attributes, leadOwnerRole: user.role } };
      }
    }
    if (assigneeId && record.kind !== "leads") return NextResponse.json({ error: "Sales assignment is available for leads only." }, { status: 400 });
    if (isProforma(record)) {
      const problem = proformaError(record);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      record.attributes = { ...record.attributes, quoteReference: proformaReference(id, record.attributes!.issuedDate) };
    }
    record = await inheritLeadLinks(db, actor, record);
    record = await resolveLinks(db, actor, record);
    if (record.lines?.length) record.amount = totalCents(record.lines) / 100;
    if (record.parentId) {
      const parent = await findRecord(db, record.parentId);
      if (
        !parent ||
        parent.company !== record.company ||
        parent.branch !== record.branch ||
        !(isProforma(record)
          ? (parent.kind === "orders" && canRead(actor, parent.payload as RecordItem) && !["Cancelled"].includes(parent.status))
          : canWrite(actor, parent.payload as RecordItem))
      )
        return NextResponse.json(
          { error: "Invalid linked record." },
          { status: 400 },
        );
      if (isProforma(record) && record.customerId !== (parent.payload as RecordItem).customerId)
        return NextResponse.json({ error: "Choose the customer linked to this order." }, { status: 400 });
    }
    // Finance and operational records must originate from an approved quote.
    if (isCashEntry(record)) {
      const error = cashEntryError(record);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }
    if (["accounts", "orders", "logistics"].includes(body.kind) && !isCashEntry(record) && !isProforma(record))
      return NextResponse.json(
        { error: "Create this record through quotation acceptance." },
        { status: 400 },
      );
    // One business action: a new customer or supplier with a main contact
    // is written together with that contact, as its primary contact.
    const mainContact = body.requestId && !importBatch ? await newRecordContact(db, actor, record, body.requestId) : null;
    const created = mainContact ? mainContact.record : record;
    // An IT ticket's triage automation is enqueued in the same batch.
    const outbox = await automationOutbox(db, { after: created });
    try {
      await createRecordWithAudit(
        db,
        {
          id: record.id, kind: record.kind, company: record.company,
          branch: record.branch, ownerId: record.ownerId, status: record.status, payload: record,
        },
        {
          id: crypto.randomUUID(), actor: actor.name, actorId: actor.id,
          company: record.company,
          action: `Created ${record.kind}${importBatch ? ` (CSV import ${importBatch})` : ""}`,
          recordId: record.id, after: created,
        },
        [...(mainContact ? mainContact.statements : []), ...outbox.statements],
      );
    } catch (error) {
      // Two simultaneous submissions of the same key race past the read above;
      // the primary key is the last line of defence, as it is for intake.
      if (body.requestId && /UNIQUE|constraint/i.test(String(error))) {
        const existing = await findRecord(db, record.id);
        if (existing && canWrite(actor, existing.payload as RecordItem))
          return NextResponse.json(
            { record: existing.payload as RecordItem, duplicate: true },
            { status: 200 },
          );
      }
      throw error;
    }
    await notifyRecordChange(db, { actor, after: created, version: 1 });
    await runAutomation(db, outbox.ids);
    return NextResponse.json({ record: created, duplicate: false }, { status: 201 });
  } catch (error) {
    // The commercial rules already speak plainly ("Choose an active contact
    // belonging to this customer."); anything else stays generic.
    if (error instanceof CommercialError)
      return NextResponse.json(
        {
          // Not found and not permitted read the same, so nothing is revealed.
          error: error.status === 404 ? "That customer, contact or product isn't available to you." : error.message,
        },
        { status: error.status },
      );
    return NextResponse.json(
      { error: "Could not save. Check required fields and permissions." },
      { status: 400 },
    );
  }
}
export async function PATCH(request: Request) {
  try {
    checkOrigin(request);
    if (isPreview()) return NextResponse.json({ error: "Preview uses local fictional data." }, { status: 409 });
    const actor = await currentActor();
    if (!actor)
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const command = z.discriminatedUnion("action", [
      leadFeedbackSchema,
      z.object({ action: z.literal("edit"), id: z.string().max(100), expectedUpdatedAt: z.string(), values: input }),
      z.object({ action: z.literal("delete"), id: z.string().max(100), expectedUpdatedAt: z.string() }),
      // Quick Complete: fill in missing details only. Same checks as an edit
      // (permission, allow-listed fields, version guard, audit) — and nothing
      // that isn't sent changes (no default due date is ever added).
      z.object({
        action: z.literal("complete"),
        id: z.string().max(100),
        expectedUpdatedAt: z.string(),
        values: z
          .object({
            contact: z.string().trim().min(1).max(160).optional(),
            email: z.email().optional(),
            phone: z.string().trim().min(3).max(50).optional(),
            product: z.string().trim().min(1).max(160).optional(),
            quantity: z.number().positive().max(100000000).optional(),
            unit: z.string().trim().min(1).max(20).optional(),
            destination: z.string().trim().min(1).max(160).optional(),
            due: z.iso.date().optional(),
            attributes: z.object({ country: z.string().trim().min(1).max(80) }).strict().optional(),
          })
          .strict()
          .refine((v) => Object.keys(v).length > 0, "Enter at least one detail."),
      }),
      z.object({
        action: z.literal("status"),
        id: z.string().max(100),
        status: z.string().max(50),
      }),
      z.object({
        action: z.literal("note"),
        id: z.string().max(100),
        text: z.string().min(1).max(5000),
        due: z.iso.date().optional(),
      }),
      z.object({
        action: z.literal("assign"),
        id: z.string().max(100),
        assigneeId: z.string().max(100),
      }),
      z.object({
        action: z.literal("payment"),
        id: z.string().max(100),
        amountCents: z.number().int().positive(),
        reference: z.string().min(1).max(160),
      }),
    ]);
    const raw = await request.json();
    const c = command.parse({ ...raw, action: raw.action || "status" });
    const id = c.id;
    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });

    // D1 has no interactive transactions, so the reads and the business rules
    // run here and the resulting writes are committed as one guarded batch.
    const row = await findRecord(db, id);
    if (!row) throw new Error("Record not found.");
    const record = row.payload as RecordItem;
    if (record.kind === "hr" && (c.action === "delete" || (c.action === "edit" && ((c.values.company !== undefined && c.values.company !== record.company) || (c.values.branch !== undefined && c.values.branch !== record.branch)))) && await employeeHasHrHistory(db, record.id))
      throw new Error("This employee has retained HR history. Keep the employee record and its company; set the profile inactive instead of deleting it.");
    // Quick Complete never touches a quotation, order, shipment or invoice.
    if (c.action === "complete" && !["leads", "customers", "suppliers"].includes(record.kind))
      throw new Error("Only missing lead, customer or supplier details can be completed here.");
    if (c.action === "edit") {
      for (const key of ["customerId", "contactId", "productId", "dealId"] as const)
        if (c.values[key] !== undefined && c.values[key] !== (record[key] ?? null)) throw new Error("Use Review relationships to change a stable link.");
    }
    if (c.action === "delete" && await hasCommercialHistory(db, id)) throw new Error("Commercial history is linked. Set the record inactive instead of deleting it.");
    if (c.action === "status" && c.status === "Accepted" && record.kind === "quotations" && !record.dealId)
      record.dealId = await existingDealForQuote(db, actor, record);
    const before = { records: [record], audit: [] };
    if (c.action === "delete") {
      const peers = await listRecordsForCompany(db, record.company);
      before.records = peers.map((peer) => peer.payload as RecordItem);
    }
    let assignee: { id: string; name: string; role: string } | undefined;
    if (c.action === "assign") {
      const target = await findUserById(db, c.assigneeId);
      // One message whether the person is absent, inactive or out of scope.
      if (!target || !mayOwn(toPerson(target), record))
        throw new Error("That person can't be given this record.");
      assignee = { id: target.id, name: target.name, role: target.role };
    }
    const result =
      c.action === "lead-feedback"
        ? applyLeadFeedback(before, actor, c)
        : c.action === "assign"
        ? assign(before, actor, id, assignee!)
        : c.action === "edit" || c.action === "delete" || c.action === "complete"
        ? mutateRecord(before, actor, id, c.expectedUpdatedAt, c.action === "delete" ? undefined : (c.values as Partial<RecordItem>))
        : c.action === "status"
          ? transition(before, actor, id, c.status)
          : c.action === "note"
            ? addNote(before, actor, id, c.text, c.due)
            : recordPayment(before, actor, id, c.amountCents, c.reference);
    if (result.audit.length) {
      let changed = result.records.find((r) => r.id === id)!;
      if (["edit", "complete"].includes(c.action) && (changed.customerId || changed.contactId || changed.productId)) changed = await resolveSnapshotEdit(db, actor, changed, record);
      const created: NewRecord[] = result.records
        .filter((r) => !before.records.some((old) => old.id === r.id))
        .map((r) => ({
          id: r.id, kind: r.kind, company: r.company, branch: r.branch,
          ownerId: r.ownerId, status: r.status, payload: r,
        }));
      const event = result.audit[0];
      // A quotation's acceptance enqueues its handoff automation in the same
      // batch as the order, shipment and invoice, after they are created.
      const outbox = await automationOutbox(db, { before: record, after: changed, created: created.map((r) => r.payload as RecordItem) });
      // The version guard preserves the original optimistic-concurrency check.
      const applied = await updateRecordWithAudit(
        db,
        id,
        row.version,
        { status: changed.status, payload: changed, ownerId: changed.ownerId },
        {
          id: event.id, company: event.company, actor: event.actor, actorId: actor.id,
          action: event.action, recordId: event.recordId,
          before: record, after: changed, at: new Date(event.at),
        },
        created,
        outbox.statements,
      );
      if (!applied)
        throw new Error("Another user updated this record. Refresh and retry.");
      await notifyRecordChange(db, {
        actor,
        before: record,
        after: changed,
        version: row.version + 1,
        created: created.map((r) => r.payload as RecordItem),
      });
      await runAutomation(db, outbox.ids);
    }
    return NextResponse.json({ ok: true, record: result.records.find(r => r.id === id) });
  } catch (error) {
    return NextResponse.json(
      {
        // Business-rule messages are shown; driver errors are not surfaced.
        error:
          error instanceof z.ZodError ? "Check your update, select an available outcome and choose a valid follow-up date." : error instanceof Error && !/D1_|SQLITE|no such table/i.test(error.message)
            ? error.message
            : "Unable to update record. Contact IT if this continues.",
      },
      { status: 400 },
    );
  }
}
