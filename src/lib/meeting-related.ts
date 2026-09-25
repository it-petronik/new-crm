import { inArray } from "drizzle-orm";
import type { Database } from "./d1";
import { canRead, type Actor, type RecordItem } from "./domain";
import { CollabError } from "./collab-access";
import { businessRecords, type MeetingRow } from "./schema";
import { RELATED_KINDS, type MeetingView, type RelatedKind } from "./meetings";

/**
 * Meetings ↔ CRM records, in both directions without granting anything.
 *
 * - Linking: a meeting may only be linked to a record its organiser can
 *   read now; its kind is taken from the record, never from the client.
 * - Showing: a meeting view names its record only to a reader who may read
 *   that record now. An invitee without CRM access sees the meeting, not
 *   the lead; a guest never sees either.
 * - Listing a record's meetings shows only meetings the reader may already
 *   reach (see visibleMeetings) — reading a lead never opens its meetings.
 */

/** Validates a record to link to; returns its trusted id and kind. */
export async function linkableRecord(db: Database, actor: Actor, id: unknown): Promise<{ id: string; kind: RelatedKind } | null> {
  if (id === undefined || id === null) return null;
  if (typeof id !== "string" || id.length > 100) throw new CollabError(400, "That record can't be linked.");
  const row = (await db.select().from(businessRecords).where(inArray(businessRecords.id, [id])).all())[0];
  const record = row?.payload as RecordItem | undefined;
  if (!record || record.deletedAt || !canRead(actor, record) || !(RELATED_KINDS as readonly string[]).includes(record.kind))
    throw new CollabError(400, "That record can't be linked.");
  return { id: record.id, kind: record.kind as RelatedKind };
}

/** Adds `related` to each view, only where this reader may read the record. */
export async function attachRelated(db: Database, actor: Actor, views: MeetingView[], rows: MeetingRow[]) {
  const ids = [...new Set(rows.map((r) => r.relatedRecordId).filter((x): x is string => !!x))];
  if (!ids.length) return views;
  const records = new Map<string, RecordItem>();
  for (let i = 0; i < ids.length; i += 90)
    for (const row of await db.select().from(businessRecords).where(inArray(businessRecords.id, ids.slice(i, i + 90))).all())
      records.set(row.id, row.payload as RecordItem);
  const byMeeting = new Map(rows.map((r) => [r.id, r.relatedRecordId]));
  return views.map((v) => {
    const record = byMeeting.get(v.id) ? records.get(byMeeting.get(v.id)!) : undefined;
    const readable = record && !record.deletedAt && canRead(actor, record) && (RELATED_KINDS as readonly string[]).includes(record.kind);
    return { ...v, related: readable ? { id: record.id, kind: record.kind as RelatedKind, title: record.title } : null };
  });
}

/** Whether this reader may see a record at all (for listing its meetings). */
export async function readableRecord(db: Database, actor: Actor, id: string) {
  if (id.length > 100) return null;
  const row = (await db.select().from(businessRecords).where(inArray(businessRecords.id, [id])).all())[0];
  const record = row?.payload as RecordItem | undefined;
  return record && !record.deletedAt && canRead(actor, record) ? record : null;
}
