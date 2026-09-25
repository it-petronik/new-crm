/**
 * Collaboration Meetings: shared types and pure rules for the server and the
 * browser. Nothing here touches the database, the provider or the DOM.
 *
 * A meeting always belongs to one conversation (a room or a direct message)
 * and has no access rules of its own: whoever may read the conversation
 * right now may see and join its meetings; nobody else may. The media
 * itself is carried by the managed provider (LiveKit), never by Enercore.
 */

export type MeetingKind = "instant" | "scheduled";
export type MeetingMedia = "video" | "voice";
export type MeetingStatus = "scheduled" | "live" | "ended" | "cancelled";

export type MeetingView = {
  id: string;
  conversationId: string;
  title: string;
  kind: MeetingKind;
  media: MeetingMedia;
  status: MeetingStatus;
  createdBy: { id: string; name: string };
  scheduledAt: string | null;
  durationMin: number | null;
  startedAt: string | null;
  endedAt: string | null;
  /** People who took part (history), only for readers of the conversation. */
  participants: { id: string; name: string }[];
  /** The reader may end it for everyone (its starter, or a room admin). */
  canManage: boolean;
};

/** Everything a signed-in browser needs to join: never a provider secret. */
export type JoinGrant = {
  serverUrl: string;
  token: string;
  /** Seconds the token may be used to connect. */
  expiresIn: number;
  meeting: MeetingView;
  identity: string;
  host: boolean;
};

export type MeetingEvent =
  | { type: "meeting.started"; conversationId: string; meeting: MeetingView }
  | { type: "meeting.updated"; conversationId: string; meeting: MeetingView }
  | { type: "meeting.ended"; conversationId: string; meeting: MeetingView }
  // Sent only to the invited person (a direct call); carries who is calling.
  | { type: "meeting.invited"; conversationId: string; meeting: MeetingView; from: { id: string; name: string } };

export const MEETING_TITLE_MAX = 120;
export const DURATIONS = [15, 30, 45, 60, 90, 120];
/** A join token is only good for connecting within this window. */
export const JOIN_TOKEN_TTL_S = 10 * 60;
/** Reminder lead time for scheduled meetings. */
export const REMINDER_LEAD_MS = 10 * 60_000;
/** A scheduled meeting may be joined this early. */
export const EARLY_JOIN_MS = 15 * 60_000;
/** A scheduled meeting nobody started stops being "upcoming" after this. */
export const STALE_AFTER_MS = 2 * 60 * 60_000;

/** Provider room names: random and unrelated to any id a user can see. */
export function providerRoomName() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return "enc-" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function defaultTitle(media: MeetingMedia, direct: boolean, roomName: string | null) {
  if (direct) return media === "voice" ? "Voice call" : "Video call";
  return `${roomName ?? "Room"} meeting`;
}

/** Whether a meeting can be joined at `now` (live, or a scheduled one about to start). */
export function joinable(m: { status: MeetingStatus; scheduledAt: string | Date | null }, now = Date.now()) {
  if (m.status === "live") return true;
  if (m.status !== "scheduled" || !m.scheduledAt) return false;
  const at = new Date(m.scheduledAt).getTime();
  return now >= at - EARLY_JOIN_MS && now <= at + STALE_AFTER_MS;
}

/** "42 min", "1 h 5 min". */
export function durationLabel(ms: number) {
  const min = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(min / 60);
  return h ? `${h} h${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`;
}
