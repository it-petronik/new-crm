import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db, isPreview } from "@/lib/db";
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
  const records = await db.businessRecord.findMany({
    where: {
      company: { in: actor.companies },
      ...(actor.branches.length ? { branch: { in: actor.branches } } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  const audit = await db.auditEvent.findMany({
    where: { company: { in: actor.companies } },
    orderBy: { at: "desc" },
    take: 100,
  });
  return NextResponse.json(
    scopedWorkspace(actor, {
      records: records.map((r) => r.payload as unknown as RecordItem),
      audit: audit.map((a) => ({
        id: a.id,
        actor: a.actor,
        action: a.action,
        recordId: a.recordId,
        company: a.company,
        at: a.at.toISOString(),
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
      const parent = await db.businessRecord.findUnique({
        where: { id: record.parentId },
      });
      if (
        !parent ||
        parent.company !== record.company ||
        parent.branch !== record.branch ||
        !canWrite(actor, parent.payload as unknown as RecordItem)
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
    await db.$transaction(async (tx) => {
      await tx.businessRecord.create({
        data: {
          id: record.id,
          kind: record.kind,
          company: record.company,
          branch: record.branch,
          ownerId: actor.id,
          status: record.status,
          payload: record as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.auditEvent.create({
        data: {
          id: crypto.randomUUID(),
          actor: actor.name,
          actorId: actor.id,
          company: record.company,
          action: `Created ${record.kind}`,
          recordId: record.id,
          after: record as unknown as Prisma.InputJsonValue,
        },
      });
    });
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
    await db.$transaction(async (tx) => {
      const row = await tx.businessRecord.findUnique({ where: { id } });
      if (!row) throw new Error("Record not found.");
      const record = row.payload as unknown as RecordItem;
      const before = { records: [record], audit: [] };
      if (c.action === "delete") {
        const peers = await tx.businessRecord.findMany({ where: { company: record.company } });
        before.records = peers.map(peer => peer.payload as unknown as RecordItem);
      }
      const result =
        c.action === "edit" || c.action === "delete"
          ? mutateRecord(before, actor, id, c.expectedUpdatedAt, c.action === "edit" ? c.values : undefined)
          : c.action === "status"
          ? transition(before, actor, id, c.status)
          : c.action === "note"
            ? addNote(before, actor, id, c.text, c.due)
            : recordPayment(before, actor, id, c.amountCents, c.reference);
      if (!result.audit.length) return;
      const changed = result.records.find(r => r.id === id)!;
      const updated = await tx.businessRecord.updateMany({
        where: { id, version: row.version },
        data: {
          status: changed.status,
          payload: changed as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new Error("Another user updated this record. Refresh and retry.");
      for (const r of result.records.filter(r => !before.records.some(old => old.id === r.id)))
        await tx.businessRecord.create({
          data: {
            id: r.id,
            kind: r.kind,
            company: r.company,
            branch: r.branch,
            ownerId: r.ownerId,
            status: r.status,
            payload: r as unknown as Prisma.InputJsonValue,
          },
        });
      const event = result.audit[0];
      await tx.auditEvent.create({
        data: {
          ...event,
          actorId: actor.id,
          at: new Date(event.at),
          before: record as unknown as Prisma.InputJsonValue,
          after: changed as unknown as Prisma.InputJsonValue,
        },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error &&
          !(error instanceof Prisma.PrismaClientKnownRequestError) &&
          !(error instanceof Prisma.PrismaClientInitializationError)
            ? error.message
            : "Unable to update record. Contact IT if this continues.",
      },
      { status: 400 },
    );
  }
}
