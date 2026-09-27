import { inArray } from "drizzle-orm";
import { isId } from "@/lib/collab";
import { collabContext, handle, json, rateLimit } from "@/lib/collab-auth";
import { requireMeeting } from "@/lib/meeting-service";
import { addMeetingNote, listMeetingNotes, noteInput, removeMeetingNote, type MeetingNoteView } from "@/lib/meeting-notes";
import { users } from "@/lib/schema";
import { CollabError } from "@/lib/collab-access";

type Params = { params: Promise<{ id: string }> };

/**
 * Structured meeting notes (decision / action / requirement / note).
 * Employees with CURRENT access to the meeting only — guests have no
 * employee session and never reach this. Knowing a meeting or note id
 * grants nothing.
 */

async function views(db: Parameters<typeof listMeetingNotes>[0], rows: Awaited<ReturnType<typeof listMeetingNotes>>, meId: string): Promise<MeetingNoteView[]> {
  const ids = [...new Set(rows.map((r) => r.authorId))];
  const names = new Map((ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)).all() : []).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text, data: (r.data ?? {}) as Record<string, string>, author: { id: r.authorId, name: names.get(r.authorId) ?? "Former employee" }, createdAt: r.createdAt.toISOString(), mine: r.authorId === meId }));
}

export function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const { meeting } = await requireMeeting(db, actor, (await params).id);
    return json({ notes: await views(db, await listMeetingNotes(db, meeting.id), actor.id) });
  });
}

export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { meeting } = await requireMeeting(db, actor, (await params).id);
    if (meeting.status === "cancelled") throw new CollabError(409, "This meeting was cancelled.");
    const input = noteInput.parse(await request.json());
    await rateLimit(db, actor, "message");
    const row = await addMeetingNote(db, meeting.id, actor.id, input);
    const [view] = await views(db, [{ ...row, deletedAt: null, data: row.data }], actor.id);
    return json({ note: view }, 201);
  });
}

export function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { meeting } = await requireMeeting(db, actor, (await params).id);
    const noteId = new URL(request.url).searchParams.get("note");
    if (!isId(noteId)) throw new CollabError(404, "Note not found.");
    await removeMeetingNote(db, meeting.id, noteId, actor.id);
    return json({ ok: true });
  });
}

