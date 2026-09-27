import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./d1";
import { messageId } from "./collab";
import { CollabError } from "./collab-access";
import { meetingNotes } from "./schema";
import { STATED_STATUSES } from "./sales/requirements";

/**
 * Structured meeting notes: decision, action item, customer requirement,
 * general note. Employees only (guests never read or write them); access is
 * the caller's current meeting access, checked by the route.
 *
 * Requirement notes carry typed fields and the status the employee chose
 * ("requested" by default) — the same semantics as Phase 2, so a customer's
 * ask typed into a note is never treated as agreed.
 */

export const NOTE_KINDS = ["decision", "action", "requirement", "note"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** Requirement fields a note may record (the same names as the requirement profile). */
export const NOTE_REQUIREMENT_FIELDS = ["product", "grade", "quantity", "destination", "incoterm", "packaging", "targetPrice", "paymentTerms", "deliveryTimeline"] as const;

const short = (max: number) => z.string().trim().max(max);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const noteInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("decision"), text: short(1000).min(1) }).strict(),
  z.object({ kind: z.literal("note"), text: short(2000).min(1) }).strict(),
  z.object({ kind: z.literal("action"), text: short(500).min(1), owner: short(80).optional(), due: date.optional() }).strict(),
  z
    .object({
      kind: z.literal("requirement"),
      text: short(500).optional(),
      status: z.enum(STATED_STATUSES).default("requested"),
      fields: z.partialRecord(z.enum(NOTE_REQUIREMENT_FIELDS), short(160)),
    })
    .strict()
    .refine((n) => Object.values(n.fields).some((v) => v && v.trim()), "Enter at least one requirement."),
]);
export type NoteInput = z.infer<typeof noteInput>;

export type MeetingNoteView = {
  id: string;
  kind: NoteKind;
  text: string;
  data: Record<string, string>;
  author: { id: string; name: string };
  createdAt: string;
  mine: boolean;
};

export async function listMeetingNotes(db: Database, meetingId: string) {
  return db
    .select()
    .from(meetingNotes)
    .where(and(eq(meetingNotes.meetingId, meetingId), isNull(meetingNotes.deletedAt)))
    .orderBy(asc(meetingNotes.createdAt), asc(meetingNotes.id))
    .limit(500)
    .all();
}

/** One line for a requirement note, e.g. "Product: SN500 · Quantity: 500 MT". */
export const requirementText = (fields: Record<string, string | undefined>) =>
  Object.entries(fields)
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `${REQ_LABELS[k] ?? k}: ${v!.trim()}`)
    .join(" · ");

const REQ_LABELS: Record<string, string> = {
  product: "Product",
  grade: "Grade",
  quantity: "Quantity",
  destination: "Destination",
  incoterm: "Incoterm",
  packaging: "Packaging",
  targetPrice: "Target price",
  paymentTerms: "Payment terms",
  deliveryTimeline: "Delivery",
};

export async function addMeetingNote(db: Database, meetingId: string, authorId: string, input: NoteInput) {
  const row = {
    id: messageId(),
    meetingId,
    authorId,
    kind: input.kind,
    text: input.kind === "requirement" ? (input.text?.trim() || requirementText(input.fields)) : input.text.trim(),
    data:
      input.kind === "requirement"
        ? { ...Object.fromEntries(Object.entries(input.fields).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, v!.trim()])), status: input.status }
        : input.kind === "action"
          ? { ...(input.owner ? { owner: input.owner } : {}), ...(input.due ? { due: input.due } : {}) }
          : {},
    createdAt: new Date(),
  };
  await db.insert(meetingNotes).values(row).run();
  return row;
}

/** Soft delete — by its author only. */
export async function removeMeetingNote(db: Database, meetingId: string, noteId: string, actorId: string) {
  const row = await db.select().from(meetingNotes).where(and(eq(meetingNotes.id, noteId), eq(meetingNotes.meetingId, meetingId), isNull(meetingNotes.deletedAt))).get();
  if (!row) throw new CollabError(404, "Note not found.");
  if (row.authorId !== actorId) throw new CollabError(403, "Only the person who wrote a note can remove it.");
  await db.update(meetingNotes).set({ deletedAt: new Date() }).where(eq(meetingNotes.id, noteId)).run();
}
