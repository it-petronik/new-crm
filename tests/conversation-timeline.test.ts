import { test } from "node:test";
import assert from "node:assert/strict";
import { meetingHistory } from "../src/lib/conversation-timeline";
import { joinable, type MeetingView } from "../src/lib/meetings";

const call = (patch: Partial<MeetingView> = {}): MeetingView => ({ id: "call-1", conversationId: "c-1", scope: "direct", conversationTitle: "Colleague", guestAccess: "off", inviteeCount: 2, attendeeCount: 2, recording: { active: false, available: 0 }, related: null, title: "Voice call", kind: "instant", media: "voice", status: "ended", createdBy: { id: "u-1", name: "A" }, scheduledAt: null, durationMin: null, startedAt: "2026-10-04T10:00:00.000Z", endedAt: "2026-10-04T10:01:05.000Z", participants: [], canManage: true, ...patch });

test("call history derives duration from saved times and never offers an ended call to join", () => {
  const [event] = meetingHistory([call()]);
  assert.equal(event.duration, "01:05");
  assert.equal(event.outcome, "Ended");
  assert.equal(joinable(event.meeting), false);
});
test("unanswered attempts are not presented as connected conversations", () => {
  const [event] = meetingHistory([call({ attendeeCount: 1 })]);
  assert.equal(event.outcome, "No answer");
  assert.equal(event.durationLabel, "Attempt duration");
});
test("live and upcoming meetings do not generate premature history entries", () => {
  assert.deepEqual(meetingHistory([call({ status: "live" }), call({ status: "scheduled" })]), []);
});
test("history does not invent durations for missing or invalid times", () => {
  assert.equal(meetingHistory([call({ startedAt: null })])[0].duration, null);
  assert.equal(meetingHistory([call({ startedAt: "invalid" })])[0].duration, null);
  assert.equal(meetingHistory([call({ startedAt: "2026-10-04T11:00:00Z" })])[0].duration, null);
  assert.equal(meetingHistory([call({ endedAt: null, scheduledAt: null, startedAt: null })]).length, 0);
});
