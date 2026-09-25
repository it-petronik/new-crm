"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { collabFetch, useCollabEvents } from "./collab-client";
import type {
  GuestExpiry,
  JoinGrant,
  MeetingDetails,
  MeetingMedia,
  MeetingReport,
  MeetingView,
  RecordingView,
  RoomSession,
} from "./meetings";

/**
 * The browser side of meetings.
 *
 * One app-wide store holds where the person is in the meeting flow
 * (nothing → pre-join → in the meeting). The meeting UI renders above the
 * whole workspace from that store, so moving around the CRM never drops a
 * call, and leaving returns to exactly where they were. Nothing here
 * touches the camera or microphone; the pre-join screen does, and only
 * after the person has asked to join.
 */

export type JoinChoices = {
  audio: boolean;
  video: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
};

export type MeetingFlow =
  | { phase: "idle" }
  | { phase: "prejoin"; meetingId: string }
  | { phase: "room"; meetingId: string; session: RoomSession; choices: JoinChoices };

let flow: MeetingFlow = { phase: "idle" };
const listeners = new Set<() => void>();
const set = (next: MeetingFlow) => {
  flow = next;
  for (const l of listeners) l();
};

export function useMeetingFlow() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => flow,
    () => flow,
  );
}

/** Opens the pre-join screen. Never joins by itself. */
export function openPrejoin(meetingId: string) {
  // Already in a meeting: stay put until they leave.
  if (flow.phase === "room") return;
  set({ phase: "prejoin", meetingId });
}
export const closeMeeting = () => set({ phase: "idle" });

/** An employee's grant, in the shape the meeting room uses. */
export const sessionFromGrant = (grant: JoinGrant): RoomSession => ({
  meetingId: grant.meeting.id,
  conversationId: grant.meeting.conversationId,
  title: grant.meeting.title,
  startedAt: grant.meeting.startedAt,
  serverUrl: grant.serverUrl,
  token: grant.token,
  identity: grant.identity,
  host: grant.host,
  guest: false,
  canRecord: grant.canRecord,
});
export const enterRoom = (meetingId: string, grant: JoinGrant, choices: JoinChoices) =>
  set({ phase: "room", meetingId, session: sessionFromGrant(grant), choices });

/** Opens a CRM record's detail from anywhere (the workspace listens; normal access applies). */
export const openRecord = (kind: string, id: string) =>
  window.dispatchEvent(new CustomEvent("enercore:open-record", { detail: { kind, id } }));

/** Opens Collaboration → Meetings at a meeting's details or report (the workspace listens). */
export const openMeetingPage = (meetingId: string, view: "details" | "report" = "details") =>
  window.dispatchEvent(new CustomEvent("enercore:open-meeting-page", { detail: { meetingId, view } }));

/** Opens a meeting's details (the Meetings page listens for this). */
export const openMeetingDetails = (meetingId: string) =>
  window.dispatchEvent(new CustomEvent("enercore:meeting-details", { detail: { meetingId } }));

/* ------------------------------------------------------------------ API */

export const meetingsOf = (conversationId: string) =>
  collabFetch<{ meetings: MeetingView[]; available: boolean }>(`/conversations/${conversationId}/meetings`);
export const allMeetings = (recordId?: string) =>
  collabFetch<{ meetings: MeetingView[]; available: boolean }>(`/meetings${recordId ? `?recordId=${encodeURIComponent(recordId)}` : ""}`);

export const startMeeting = (conversationId: string, media: MeetingMedia) =>
  collabFetch<{ meeting: MeetingView; existing?: boolean }>(`/conversations/${conversationId}/meetings`, {
    method: "POST",
    body: { mode: "now", media },
  });

export const scheduleMeeting = (
  conversationId: string,
  body: { title: string; media: MeetingMedia; scheduledAt: string; durationMin: number | null },
) =>
  collabFetch<{ meeting: MeetingView }>(`/conversations/${conversationId}/meetings`, {
    method: "POST",
    body: { mode: "schedule", ...body },
  });

export type StandaloneInput = {
  mode: "now" | "schedule";
  media: MeetingMedia;
  title: string;
  scheduledAt?: string;
  durationMin?: number | null;
  inviteeIds: string[];
  guestAccess: "off" | "open" | "admit";
  relatedRecordId?: string | null;
};
export const createStandalone = (body: StandaloneInput) => collabFetch<{ meeting: MeetingView }>(`/meetings`, { method: "POST", body });

export const getMeeting = (id: string) => collabFetch<MeetingDetails & { available: boolean }>(`/meetings/${id}`);
export const updateMeetingApi = (
  id: string,
  body: Partial<{ title: string; scheduledAt: string; durationMin: number | null; inviteeIds: string[]; guestAccess: "off" | "open" | "admit"; cancel: true }>,
) => collabFetch<{ meeting: MeetingView }>(`/meetings/${id}`, { method: "PATCH", body });
export const requestJoin = (id: string) => collabFetch<JoinGrant>(`/meetings/${id}/join`, { method: "POST", body: {} });
export const endMeetingForAll = (id: string) => collabFetch(`/meetings/${id}/end`, { method: "POST", body: {} });
export const reportLeft = (id: string) => collabFetch(`/meetings/${id}/leave`, { method: "POST", body: {} }).catch(() => {});
export const cancelMeeting = (id: string) => updateMeetingApi(id, { cancel: true });
export const hostAction = (id: string, body: { action: "mute"; identity: string; trackSid: string } | { action: "remove"; identity: string }) =>
  collabFetch(`/meetings/${id}/participants`, { method: "POST", body });
export const meetingReport = (id: string) => collabFetch<MeetingReport>(`/meetings/${id}/report`);
export const createGuestLink = (id: string, expiry: GuestExpiry, admission: "open" | "admit") =>
  collabFetch<{ url: string; expiresAt: string | null; untilMeetingEnd: boolean }>(`/meetings/${id}/guest-link`, { method: "POST", body: { expiry, admission } });
export const revokeGuestLink = (id: string) => collabFetch(`/meetings/${id}/guest-link`, { method: "DELETE" });
export const waitingGuestsOf = (id: string) => collabFetch<{ guests: { id: string; name: string; since: string }[] }>(`/meetings/${id}/guests`);
export const decideGuest = (id: string, guestId: string, decision: "admit" | "decline") =>
  collabFetch(`/meetings/${id}/guests/${guestId}`, { method: "POST", body: { decision } });
export const recordingAction = (id: string, action: "start" | "stop") =>
  collabFetch<{ recording: RecordingView }>(`/meetings/${id}/recording`, { method: "POST", body: { action } });

/**
 * The raw guest link exists only when it is created (the server keeps its
 * hash). The organiser's browser keeps it for this session so it can be
 * copied again; another device must regenerate it.
 */
const LINK_KEY = (id: string) => `enercore-guest-link:${id}`;
export function rememberGuestLink(id: string, url: string | null) {
  try {
    if (url) sessionStorage.setItem(LINK_KEY(id), url);
    else sessionStorage.removeItem(LINK_KEY(id));
  } catch {}
}
export function rememberedGuestLink(id: string) {
  try {
    return sessionStorage.getItem(LINK_KEY(id));
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- hooks */

/**
 * A conversation's meetings, kept current by meeting events for that
 * conversation (started, updated, ended). No polling.
 */
export function useConversationMeetings(conversationId: string | null, enabled = true) {
  const [state, setState] = useState<{ meetings: MeetingView[]; available: boolean; loaded: boolean }>({
    meetings: [],
    available: false,
    loaded: false,
  });
  const load = useCallback(() => {
    if (!conversationId) return;
    meetingsOf(conversationId)
      .then((r) => setState({ ...r, loaded: true }))
      .catch(() => setState((s) => ({ ...s, loaded: true })));
  }, [conversationId]);
  useEffect(() => {
    setState({ meetings: [], available: false, loaded: false });
    if (enabled) load();
  }, [load, enabled]);
  useCollabEvents(
    enabled && !!conversationId,
    (event) => {
      if (event.type.startsWith("meeting.") && event.conversationId === conversationId) load();
    },
    load,
  );
  return { ...state, reload: load };
}

/** Every meeting the person may see (or those about one record), kept current by events. */
export function useAllMeetings(enabled = true, recordId?: string) {
  const [state, setState] = useState<{ meetings: MeetingView[]; available: boolean; loaded: boolean; error: boolean }>({
    meetings: [],
    available: false,
    loaded: false,
    error: false,
  });
  const load = useCallback(() => {
    allMeetings(recordId)
      .then((r) => setState({ ...r, loaded: true, error: false }))
      .catch(() => setState((s) => ({ ...s, loaded: true, error: true })));
  }, [recordId]);
  useEffect(() => {
    if (enabled) load();
  }, [load, enabled]);
  useCollabEvents(enabled, (event) => event.type.startsWith("meeting.") && load(), load);
  return { ...state, reload: load };
}

/** The live meeting among a conversation's meetings, if any. */
export const liveOf = (meetings: MeetingView[]) => meetings.find((m) => m.status === "live") ?? null;

/** Who may end or moderate, as the browser can tell (the server re-checks). */
export function canManageMeeting(m: MeetingView, me: string, conversation: { kind: string; myRole: string }) {
  return m.createdBy.id === me || conversation.kind === "direct" || conversation.myRole === "owner" || conversation.myRole === "admin";
}
