"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { collabFetch, useCollabEvents } from "./collab-client";
import type { JoinGrant, MeetingMedia, MeetingView } from "./meetings";

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
  | { phase: "room"; meetingId: string; grant: JoinGrant; choices: JoinChoices };

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
  // Already in this meeting: nothing to do; in another: stay put until they leave.
  if (flow.phase === "room") return;
  set({ phase: "prejoin", meetingId });
}
export const closeMeeting = () => set({ phase: "idle" });
export const enterRoom = (meetingId: string, grant: JoinGrant, choices: JoinChoices) =>
  set({ phase: "room", meetingId, grant, choices });

/* ------------------------------------------------------------------ API */

export const meetingsOf = (conversationId: string) =>
  collabFetch<{ meetings: MeetingView[]; available: boolean }>(`/conversations/${conversationId}/meetings`);

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

export const getMeeting = (id: string) => collabFetch<{ meeting: MeetingView; available: boolean }>(`/meetings/${id}`);
export const requestJoin = (id: string) => collabFetch<JoinGrant>(`/meetings/${id}/join`, { method: "POST", body: {} });
export const endMeetingForAll = (id: string) => collabFetch(`/meetings/${id}/end`, { method: "POST", body: {} });
export const reportLeft = (id: string) => collabFetch(`/meetings/${id}/leave`, { method: "POST", body: {} }).catch(() => {});
export const cancelMeeting = (id: string) => collabFetch(`/meetings/${id}`, { method: "PATCH", body: { cancel: true } });
export const hostAction = (id: string, body: { action: "mute"; identity: string; trackSid: string } | { action: "remove"; identity: string }) =>
  collabFetch(`/meetings/${id}/participants`, { method: "POST", body });

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

/** The live meeting among a conversation's meetings, if any. */
export const liveOf = (meetings: MeetingView[]) => meetings.find((m) => m.status === "live") ?? null;

/** Who may end or moderate, as the browser can tell (the server re-checks). */
export function canManageMeeting(m: MeetingView, me: string, conversation: { kind: string; myRole: string }) {
  return m.createdBy.id === me || conversation.kind === "direct" || conversation.myRole === "owner" || conversation.myRole === "admin";
}
