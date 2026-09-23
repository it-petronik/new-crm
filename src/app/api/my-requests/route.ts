import { NextResponse } from "next/server";
import { z } from "zod";
import { currentActor, checkOrigin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listAllRecords, createRecordWithAudit } from "@/lib/data";
import { type RecordItem } from "@/lib/domain";

// Employee self-service is separate from department access: no request can
// read another owner's records.
export async function GET() {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const db = await getDb();
  if (!db) return NextResponse.json({ records: [] }, { headers: { "Cache-Control": "no-store" } });
  const rows = await listAllRecords(db);
  const records = rows
    .filter(
      (r) =>
        r.ownerId === actor.id &&
        ["leave", "it"].includes(r.kind) &&
        actor.companies.includes(r.company) &&
        (!actor.branches.length || actor.branches.includes(r.branch)),
    )
    .map((r) => r.payload as RecordItem);
  return NextResponse.json({ records }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
    const input = z
      .object({
        kind: z.enum(["leave", "it"]),
        title: z.string().min(2).max(160),
        due: z.iso.date(),
        quantity: z.number().min(1).max(365),
        detail: z.string().max(5000),
        company: z.string(),
        branch: z.string(),
      })
      .parse(await request.json());
    if (
      !actor.companies.includes(input.company) ||
      (actor.branches.length && !actor.branches.includes(input.branch))
    )
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    const now = new Date().toISOString();
    const record: RecordItem = {
      ...input,
      id: crypto.randomUUID(),
      status: input.kind === "leave" ? "Pending Approval" : "Open",
      contact: actor.name,
      product: "",
      amount: 0,
      currency: "USD",
      unit: input.kind === "leave" ? "days" : "request",
      source: "Employee self-service",
      ownerId: actor.id,
      owner: actor.name,
      createdAt: now,
      updatedAt: now,
    };
    await createRecordWithAudit(
      db,
      {
        id: record.id, kind: record.kind, company: record.company,
        branch: record.branch, ownerId: actor.id, status: record.status, payload: record,
      },
      {
        id: crypto.randomUUID(), company: record.company, actorId: actor.id,
        actor: actor.name, action: `Submitted own ${record.kind} request`, recordId: record.id,
      },
    );
    return NextResponse.json({ record }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Check the required request details." }, { status: 400 });
  }
}
