import { eq } from "drizzle-orm";
import type { Database } from "./d1";
import { findPeople } from "./collab-data";
import { activityOf, conversationAudience, listInvitees, meetingSessionsOf, recordingsOf } from "./meeting-data";
import { recordingView } from "./meeting-recordings";
import { meetingAttendance, type MeetingRow } from "./schema";
import type { MeetingReport, MeetingView, ReportParticipant } from "./meetings";

/**
 * A meeting's report, built only from what Enercore recorded: attendance
 * sessions summed per person (so a reconnect adds its time, never
 * double-counts or overwrites), who was invited and who came, the activity
 * log and recordings. No transcripts or summaries are invented. The caller
 * has already checked the reader may reach the meeting.
 */
export async function buildReport(db: Database, meeting: MeetingRow, view: MeetingView): Promise<MeetingReport> {
  const [sessions, legacy, activity, recordings] = await Promise.all([
    meetingSessionsOf(db, meeting.id),
    db.select().from(meetingAttendance).where(eq(meetingAttendance.meetingId, meeting.id)).all(),
    activityOf(db, meeting.id),
    recordingsOf(db, meeting.id),
  ]);
  const end = (meeting.endedAt ?? new Date()).getTime();
  const rows = [
    ...sessions.map((s) => ({ identity: s.participantIdentity, userId: s.userId, guestName: s.guestName, joinedAt: s.joinedAt, leftAt: s.leftAt })),
    // Meetings from before per-connection sessions: one row per person.
    ...legacy
      .filter((l) => !sessions.some((s) => s.userId === l.userId))
      .map((l) => ({ identity: l.userId, userId: l.userId as string | null, guestName: null as string | null, joinedAt: l.joinedAt, leftAt: l.leftAt })),
  ];
  const names = new Map((await findPeople(db, rows.map((r) => r.userId).filter((u): u is string => !!u))).map((p) => [p.id, p.name]));
  const byIdentity = new Map<string, ReportParticipant>();
  for (const r of rows) {
    const seconds = Math.max(0, Math.round(((r.leftAt?.getTime() ?? end) - r.joinedAt.getTime()) / 1000));
    const current = byIdentity.get(r.identity);
    if (!current)
      byIdentity.set(r.identity, {
        identity: r.identity,
        name: r.userId ? (names.get(r.userId) ?? "Former colleague") : (r.guestName ?? "Guest"),
        kind: r.userId ? "internal" : "guest",
        firstJoined: r.joinedAt.toISOString(),
        lastLeft: r.leftAt?.toISOString() ?? null,
        sessions: 1,
        totalSeconds: seconds,
      });
    else {
      current.sessions += 1;
      current.totalSeconds += seconds;
      if (r.joinedAt.toISOString() < current.firstJoined) current.firstJoined = r.joinedAt.toISOString();
      if (!r.leftAt) current.lastLeft = null;
      else if (current.lastLeft && r.leftAt.toISOString() > current.lastLeft) current.lastLeft = r.leftAt.toISOString();
    }
  }
  const invitedIds = meeting.conversationId
    ? await conversationAudience(db, meeting.conversationId)
    : [meeting.createdBy, ...(await listInvitees(db, meeting.id)).map((i) => i.id)];
  const invited = (await findPeople(db, invitedIds)).map((p) => ({ id: p.id, name: p.name, role: p.role }));
  const attendedIds = new Set(rows.map((r) => r.userId).filter((u): u is string => !!u));
  return {
    meeting: view,
    participants: [...byIdentity.values()].sort((a, b) => a.firstJoined.localeCompare(b.firstJoined)),
    invited,
    attended: [...attendedIds],
    absent: invited.filter((p) => !attendedIds.has(p.id)),
    activity: [
      ...activity.map((a) => ({ type: a.type, actorName: a.actorName, at: a.at.toISOString() })),
      ...rows.flatMap((r) => {
        const who = r.userId ? (names.get(r.userId) ?? "Former colleague") : `${r.guestName ?? "Guest"} (guest)`;
        return [{ type: "joined", actorName: who, at: r.joinedAt.toISOString() }, ...(r.leftAt ? [{ type: "left", actorName: who, at: r.leftAt.toISOString() }] : [])];
      }),
    ].sort((a, b) => a.at.localeCompare(b.at)),
    recordings: recordings.map(recordingView),
  };
}
