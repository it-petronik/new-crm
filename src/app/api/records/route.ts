import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, isPreview } from "@/lib/db";
import {
  listAllRecords, listAuditEvents, findRecord, listRecordsForCompany,
  createRecordWithAudit, updateRecordWithAudit, type NewRecord,
} from "@/lib/data";
import { checkOrigin, currentActor } from "@/lib/auth";
import {
  canWrite,
  scopedWorkspace,
  stages,
  totalCents,
  type RecordItem,
} from "@/lib/domain";
import { transition, addNote, recordPayment } from "@/lib/workflow";
import { quotationError } from "@/lib/quotation";
import { mutateRecord } from "@/lib/record-mutations";
import { isCashEntry, cashEntryError } from "@/lib/cashbook";
import { salaryAttributes } from "@/lib/salary";
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
        packaging: z.string().max(100).optional(),
        quantity: z.number().positive().max(1000000),
        unitPriceCents: z.number().int().min(0).max(100000000),
      }),
    )
    .max(100)
    .optional(),
  parentId: z.string().max(100).optional(),
  email: z.union([z.email(), z.literal("")]).optional(),
  phone: z.string().max(50).optional(),
  destination: z.string().max(160).optional(),
  attributes: z
    .partialRecord(
      z.enum([
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
        "customerAddress",
        "customerTaxNumber",
        "signatoryName",
        "signatoryTitle",
        "amountWords",
      ]),
      z.string().max(300),
    )
    .optional(),
});
export async function GET() {
  const actor = await currentActor();
  if (!actor)
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const db = await getDb();
  if (!db)
    return NextResponse.json(
      scopedWorkspace(actor, { records: [], audit: [] }),
      { headers: { "Cache-Control": "no-store" } },
    );
  const rows = await listAllRecords(db);
  const events = await listAuditEvents(db, 100);
  const visible = rows.filter(
    (r) =>
      actor.companies.includes(r.company) &&
      (!actor.branches.length || actor.branches.includes(r.branch)),
  );
  return NextResponse.json(
    scopedWorkspace(actor, {
      records: visible.map((r) => r.payload as RecordItem),
      audit: events
        .filter((a) => actor.companies.includes(a.company))
        .map((a) => ({
          id: a.id, actor: a.actor, action: a.action,
          recordId: a.recordId, company: a.company, at: a.at.toISOString(),
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
    const body = input.parse(await request.json());
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
    const record: RecordItem = {
      ...body,
      id: crypto.randomUUID(),
      status: isCashEntry(body) ? "Recorded" : stages[body.kind][0],
      ownerId: actor.id,
      owner: actor.name,
      createdAt: now,
      updatedAt: now,
    };
    if (!canWrite(actor, record))
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    if (record.lines?.length) record.amount = totalCents(record.lines) / 100;
    if (record.parentId) {
      const parent = await findRecord(db, record.parentId);
      if (
        !parent ||
        parent.company !== record.company ||
        parent.branch !== record.branch ||
        !canWrite(actor, parent.payload as RecordItem)
      )
        return NextResponse.json(
          { error: "Invalid linked record." },
          { status: 400 },
        );
    }
    // Finance and operational records must originate from an approved quote.
    if (isCashEntry(record)) {
      const error = cashEntryError(record);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }
    if (["accounts", "orders", "logistics"].includes(body.kind) && !isCashEntry(record))
      return NextResponse.json(
        { error: "Create this record through quotation acceptance." },
        { status: 400 },
      );
    await createRecordWithAudit(
      db,
      {
        id: record.id, kind: record.kind, company: record.company,
        branch: record.branch, ownerId: actor.id, status: record.status, payload: record,
      },
      {
        id: crypto.randomUUID(), actor: actor.name, actorId: actor.id,
        company: record.company, action: `Created ${record.kind}`,
        recordId: record.id, after: record,
      },
    );
    return NextResponse.json({ record }, { status: 201 });
  } catch {
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
      z.object({ action: z.literal("edit"), id: z.string().max(100), expectedUpdatedAt: z.string(), values: input }),
      z.object({ action: z.literal("delete"), id: z.string().max(100), expectedUpdatedAt: z.string() }),
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
    const before = { records: [record], audit: [] };
    if (c.action === "delete") {
      const peers = await listRecordsForCompany(db, record.company);
      before.records = peers.map((peer) => peer.payload as RecordItem);
    }
    const result =
      c.action === "edit" || c.action === "delete"
        ? mutateRecord(before, actor, id, c.expectedUpdatedAt, c.action === "edit" ? c.values : undefined)
        : c.action === "status"
          ? transition(before, actor, id, c.status)
          : c.action === "note"
            ? addNote(before, actor, id, c.text, c.due)
            : recordPayment(before, actor, id, c.amountCents, c.reference);
    if (result.audit.length) {
      const changed = result.records.find((r) => r.id === id)!;
      const created: NewRecord[] = result.records
        .filter((r) => !before.records.some((old) => old.id === r.id))
        .map((r) => ({
          id: r.id, kind: r.kind, company: r.company, branch: r.branch,
          ownerId: r.ownerId, status: r.status, payload: r,
        }));
      const event = result.audit[0];
      // The version guard preserves the original optimistic-concurrency check.
      const applied = await updateRecordWithAudit(
        db,
        id,
        row.version,
        { status: changed.status, payload: changed },
        {
          id: event.id, company: event.company, actor: event.actor, actorId: actor.id,
          action: event.action, recordId: event.recordId,
          before: record, after: changed, at: new Date(event.at),
        },
        created,
      );
      if (!applied)
        throw new Error("Another user updated this record. Refresh and retry.");
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        // Business-rule messages are shown; driver errors are not surfaced.
        error:
          error instanceof Error && !/D1_|SQLITE|no such table/i.test(error.message)
            ? error.message
            : "Unable to update record. Contact IT if this continues.",
      },
      { status: 400 },
    );
  }
}
