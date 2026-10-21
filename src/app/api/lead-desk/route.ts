import { NextResponse } from "next/server";
import { z } from "zod";
import { currentActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listLeadDeskPage } from "@/lib/data";
import { allowedModules, canRead, type RecordItem } from "@/lib/domain";

export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor)
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!allowedModules(actor).includes("leads"))
    return NextResponse.json(
      { error: "Lead Desk access is not available for your role." },
      { status: 403 },
    );
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = z
    .object({
      after: z.string().max(100).default(""),
      asOf: z.iso.datetime().optional(),
    })
    .strict()
    .safeParse(params);
  if (!query.success)
    return NextResponse.json(
      { error: "Refresh the Lead Desk to load its latest records." },
      { status: 400 },
    );
  const db = await getDb();
  if (!db)
    return NextResponse.json(
      { error: "The Lead Desk could not connect. Please try again." },
      { status: 503 },
    );
  const asOf = query.data.asOf || new Date().toISOString();
  try {
    const rows = await listLeadDeskPage(
      db,
      actor,
      query.data.after,
      new Date(asOf),
    );
    const records = rows
      .map((row) => row.payload as RecordItem)
      .filter((r) => !r.deletedAt && canRead(actor, r));
    return NextResponse.json(
      { records, asOf, next: rows.length === 500 ? rows.at(-1)!.id : null },
      { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
    );
  } catch {
    return NextResponse.json(
      { error: "The Lead Desk could not refresh. Please try again." },
      { status: 503 },
    );
  }
}
