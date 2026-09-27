import type { Database } from "../../d1";
import { canRead, canWrite, type Actor, type RecordItem } from "../../domain";
import { findRecord } from "../../data";
import { CollabError } from "../../collab-access";
import { requireRead } from "../../collab-access";
import { messagePage } from "../../collab-data";
import { meetingViews } from "../../meeting-data";
import { requireMeeting } from "../../meeting-service";
import { attachRelated } from "../../meeting-related";
import { buildReport } from "../../meeting-report-data";
import { durationLabel, statusLabel } from "../../meetings";
import { businessStamp, businessTime } from "../../gst";
import { AiContext } from "../context";
import { AiError } from "../gateway";

/**
 * Meeting intelligence and Collaboration summaries — from what Enercore
 * already has (meeting metadata, attendance, activity, Meeting Chat;
 * conversation messages). No transcripts or recordings are used. Access is
 * the person's CURRENT meeting / conversation access, checked here.
 */

const notFound = (e: unknown, what: string) => (e instanceof CollabError ? new AiError(404, `${what} not found.`) : e);

export async function meetingContext(db: Database, actor: Actor, id: unknown) {
  let found;
  try {
    found = await requireMeeting(db, actor, id);
  } catch (e) {
    throw notFound(e, "Meeting");
  }
  const { meeting } = found;
  const [view] = await attachRelated(db, actor, await meetingViews(db, [meeting]), [meeting]);
  const report = await buildReport(db, meeting, view);
  const ctx = new AiContext(`Meeting "${meeting.title}"`);
  const ref = ctx.ref(`Meeting: ${meeting.title}`, { type: "meeting", id: meeting.id, view: meeting.status === "ended" ? "report" : "details" });
  ctx.fact("Status", statusLabel[meeting.status], ref);
  ctx.fact("Organiser", view.createdBy.name, ref);
  if (meeting.scheduledAt) ctx.fact("Scheduled", businessStamp(meeting.scheduledAt), ref);
  if (meeting.startedAt) ctx.fact("Started", businessStamp(meeting.startedAt), ref);
  if (meeting.endedAt) ctx.fact("Ended", businessStamp(meeting.endedAt), ref);
  if (meeting.startedAt && meeting.endedAt) ctx.fact("Duration", durationLabel(meeting.endedAt.getTime() - meeting.startedAt.getTime()), ref);
  ctx.fact("Attended", report.participants.length ? report.participants.map((p) => `${p.name}${p.kind === "guest" ? " (guest)" : ""} — ${Math.round(p.totalSeconds / 60)} min`).join("; ") : "nobody joined", ref);
  if (report.absent.length) ctx.fact("Invited but did not attend", report.absent.map((p) => p.name).join(", "), ref);
  ctx.fact("Chat messages", report.chat.length, ref);
  ctx.fact("Not available", "no transcript or recording — only attendance, activity and the meeting chat");

  // The CRM record the meeting is about — only if this person may read it.
  let related: RecordItem | undefined;
  if (view.related) {
    related = (await findRecord(db, view.related.id))?.payload as RecordItem | undefined;
    if (related && !related.deletedAt && canRead(actor, related)) {
      const rref = ctx.ref(`${view.related.kind === "leads" ? "Lead" : "Record"}: ${related.title} (${related.id})`, { type: "record", kind: related.kind, id: related.id });
      ctx.record(rref, { kind: related.kind, title: related.title, status: related.status, owner: related.owner, due: related.due });
      if (canWrite(actor, related)) ctx.allowSuggestionsFor(rref, related.kind, related.id);
    }
  }
  for (const c of report.chat.slice(-80)) if (!c.deleted) ctx.text(c.guest ? "meeting_chat_guest" : "meeting_chat", `${businessTime(new Date(c.at))} ${c.name}${c.guest ? " (guest)" : ""}: ${c.body}`, ref);
  return {
    meeting,
    context: ctx,
    scope: `No transcript is available. This summary uses meeting details and Meeting Chat (${report.chat.length} message${report.chat.length === 1 ? "" : "s"}).`,
    instructions: `Summarise this meeting for people who couldn't attend: who took part and for how long (from FACTS), and what was discussed or agreed as far as the meeting chat shows. The summary MUST say plainly that no transcript or recording is available, so the spoken discussion isn't covered.
List decisions and action items ONLY if the chat states them (in "nextActions", with who if named). Never write that someone "said" or "discussed" anything unless it is in the meeting chat text, and then say it was in the chat. Never imply audio or video was analysed. Never invent what was said.
If the meeting is about a CRM record in CONTEXT, you may draft a short follow-up email (kind "email") and suggest up to 2 changes for that record: "add_note" (the meeting outcome, factual) or "set_follow_up" (YYYY-MM-DD)${related?.kind === "leads" ? ` or "change_status"` : ""}.`,
  };
}

export async function conversationContext(db: Database, actor: Actor, id: unknown) {
  let access;
  try {
    access = await requireRead(db, actor, id);
  } catch (e) {
    throw notFound(e, "Conversation");
  }
  const conversation = access.conversation;
  const title = conversation.kind === "direct" ? "Direct message" : `Room ${conversation.name ?? ""}`.trim();
  const ctx = new AiContext(title);
  const ref = ctx.ref(title, { type: "conversation", id: conversation.id });
  const page = await messagePage(db, conversation.id, {});
  const messages = page.messages.filter((m) => !m.deleted && m.body.trim());
  ctx.fact("Messages considered", `${messages.length} most recent${page.hasOlder ? " (older messages not included)" : ""}`, ref);
  if (messages.length) ctx.fact("Period", `${businessStamp(messages[0].createdAt)} to ${businessStamp(messages.at(-1)!.createdAt)}`, ref);
  const people = [...new Set(messages.map((m) => m.author.name))];
  ctx.fact("People in this discussion", people.join(", ") || "none", ref);
  for (const m of messages) {
    const mref = ctx.ref(`Message from ${m.author.name}, ${businessStamp(m.createdAt)}`, { type: "conversation", id: conversation.id, messageId: m.id });
    ctx.text("collaboration_message", `${businessStamp(m.createdAt)} ${m.author.name}: ${m.body}`, mref);
  }
  return {
    context: ctx,
    scope: page.hasOlder
      ? `Based on the ${messages.length} most recent messages only — older history wasn't included.`
      : `Based on all ${messages.length} message${messages.length === 1 ? "" : "s"} in this conversation.`,
    instructions: `Summarise this conversation for someone catching up: the main topics, what was decided, open questions, and action items (with who, if named) — citing the messages. Only what the messages say; never invent. No suggestions and no draft.
${page.hasOlder ? `Only the ${messages.length} most recent messages were provided (older history was not). Begin the summary with "Based on the ${messages.length} most recent messages available," and never imply the whole history was reviewed.` : `Begin the summary with "Based on the messages available,".`}`,
  };
}
