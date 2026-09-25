/**
 * Collaboration Meetings: shared types and pure rules for the server and the
 * browser. Nothing here touches the database, the provider or the DOM.
 *
 * A meeting is either linked to a conversation (a room or a direct message),
 * whose readers may see and join it, or standalone, where its organiser and
 * invitees may. Guests (no account) join only through a guest link, and only
 * that one meeting. The media is carried by LiveKit, never by Enercore.
 */

export type MeetingKind = "instant" | "scheduled";
export type MeetingMedia = "video" | "voice";
// "missed": scheduled, never started, and its window has passed.
export type MeetingStatus = "scheduled" | "live" | "ended" | "cancelled" | "missed";
/** Where a meeting lives: a room, a direct message, or on its own. */
export type MeetingScope = "room" | "direct" | "standalone";
export type GuestAccess = "off" | "open" | "admit";
export type GuestExpiry = "1h" | "24h" | "7d" | "meeting_end";

export type MeetingView = {
  id: string;
  /** Null for a standalone meeting. */
  conversationId: string | null;
  scope: MeetingScope;
  /** The linked room's name or the DM's other person, for lists. */
  conversationTitle: string | null;
  guestAccess: GuestAccess;
  /** Internal people invited (a standalone meeting's invitees; a room's members). */
  inviteeCount: number;
  /** Distinct people (and guests) who actually connected. */
  attendeeCount: number;
  recording: { active: boolean; available: number };
  /**
   * The CRM record this meeting is about — present only when THIS reader
   * may read that record right now. Never sent to guests.
   */
  related: RelatedRecord | null;
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

/** Realtime meeting signalling. `conversationId` is "" for a standalone meeting. */
export type MeetingEvent =
  | { type: "meeting.started"; conversationId: string; meeting: MeetingView }
  | { type: "meeting.updated"; conversationId: string; meeting: MeetingView }
  | { type: "meeting.ended"; conversationId: string; meeting: MeetingView }
  // Sent only to the invited person (a direct call); carries who is calling.
  | { type: "meeting.invited"; conversationId: string; meeting: MeetingView; from: { id: string; name: string } }
  // Hosts only: a guest is waiting, or a guest was admitted/declined.
  | { type: "meeting.guest_waiting"; conversationId: string; meetingId: string; guest: { id: string; name: string } }
  | { type: "meeting.guest_decided"; conversationId: string; meetingId: string; guestId: string; decision: "admitted" | "declined" };

export type GuestLinkStatus = { active: boolean; expiresAt: string | null; untilMeetingEnd: boolean; createdAt: string } | null;

export type InviteeView = { id: string; name: string; role: string };

export type MeetingDetails = {
  meeting: MeetingView;
  invitees: InviteeView[];
  /** Managers only. */
  guestLink: GuestLinkStatus;
  recordings: RecordingView[];
  canRecord: boolean;
};

export type RecordingView = {
  id: string;
  startedBy: string;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
  status: "starting" | "recording" | "processing" | "saved" | "failed";
  /** Authorised download URL when saved. */
  url: string | null;
};

export type ReportParticipant = {
  identity: string;
  name: string;
  kind: "internal" | "guest";
  firstJoined: string;
  lastLeft: string | null;
  sessions: number;
  totalSeconds: number;
};

export type MeetingReport = {
  meeting: MeetingView;
  participants: ReportParticipant[];
  invited: InviteeView[];
  attended: string[];
  absent: InviteeView[];
  activity: { type: string; actorName: string | null; at: string }[];
  recordings: RecordingView[];
};

/** A guest's view of the meeting behind their link: title and time only. */
export type GuestMeetingInfo = {
  title: string;
  status: MeetingStatus;
  scheduledAt: string | null;
  organiser: string;
  admission: "open" | "admit";
};

export const MEETING_TITLE_MAX = 120;
export const DURATIONS = [15, 30, 45, 60, 90, 120];
/** A join token is only good for connecting within this window. */
export const JOIN_TOKEN_TTL_S = 10 * 60;
export const GUEST_NAME_MAX = 60;
export const INVITEE_MAX = 100;
export const GUEST_EXPIRY_MS: Record<Exclude<GuestExpiry, "meeting_end">, number> = {
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
};
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

export const scopeLabel = (m: Pick<MeetingView, "scope" | "media">) =>
  m.scope === "direct" ? (m.media === "voice" ? "Voice call" : "Video call") : `${m.media === "voice" ? "Voice" : "Video"} meeting`;

export const statusLabel: Record<MeetingStatus, string> = {
  scheduled: "Upcoming",
  live: "In progress",
  ended: "Ended",
  cancelled: "Cancelled",
  missed: "Didn't start",
};

/** Guest identities are namespaced so they can never collide with a user id. */
export const guestIdentity = (guestId: string) => `guest:${guestId}`;
export const isGuestIdentity = (identity: string) => identity.startsWith("guest:");

/** What a guest's browser needs to connect — nothing about the CRM. */
export type GuestGrant = { serverUrl: string; token: string; expiresIn: number; identity: string; title: string };

/** The one shape the meeting room needs, for employees and guests alike. */
export type RoomSession = {
  meetingId: string;
  conversationId: string | null;
  title: string;
  startedAt: string | null;
  serverUrl: string;
  token: string;
  identity: string;
  host: boolean;
  guest: boolean;
};

export const RELATED_KINDS = ["leads", "customers", "quotations", "orders"] as const;
export type RelatedKind = (typeof RELATED_KINDS)[number];
export type RelatedRecord = { id: string; kind: RelatedKind; title: string };
export const RELATED_NOUN: Record<RelatedKind, string> = { leads: "Lead", customers: "Customer", quotations: "Quotation", orders: "Order" };
