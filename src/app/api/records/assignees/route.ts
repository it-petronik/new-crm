import { NextResponse } from "next/server";
import { getDb, isPreview } from "@/lib/db";
import { currentActor } from "@/lib/auth";
import { findRecord } from "@/lib/data";
import { canWrite, type RecordItem } from "@/lib/domain";
import { canAssign } from "@/lib/workflow";
import { mayOwn } from "@/lib/notification-rules";
import { activePeople } from "@/lib/notification-store";

/**
 * GET ?id=: who this record may be assigned to. Only someone allowed to
 * assign it gets an answer, and the list is exactly the people who could
 * read the record once it is theirs — the same rule the assign action
 * enforces — so the picker never offers a choice the server would refuse.
 */
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (isPreview()) return NextResponse.json({ people: [] });
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  const query = new URL(request.url).searchParams;
  const id = query.get("id") ?? "";
  const row = id && id.length <= 100 ? await findRecord(db, id) : undefined;
  const draft = !id ? { id: "draft", kind: "leads", company: query.get("company") || "", branch: actor.branches[0] || "Main", ownerId: actor.id } as RecordItem : undefined;
  const record = row?.payload as RecordItem | undefined || draft;
  if (!record || record.deletedAt || !(draft ? canWrite(actor, draft) : canAssign(actor, record)))
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  const people = (await activePeople(db))
    .filter((p) => mayOwn(p, record))
    .map((p) => ({ id: p.id, name: p.name, role: p.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ people }, { headers: { "Cache-Control": "no-store" } });
}
