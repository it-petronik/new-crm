# Collaboration Meetings (V3)

Voice calls, video meetings and screen sharing inside Collaboration, on a
managed SFU with TURN (LiveKit Cloud). Enercore never carries audio or
video; it decides **who may join**, issues short-lived join tokens, and
shows the experience.

## Provider

LiveKit Cloud. It gives Enercore:

- a managed SFU with TURN;
- simulcast and adaptive streams;
- screen share;
- browser SDK and React hooks;
- server-signed JWTs that Workers can mint with WebCrypto;
- webhooks;
- optional recording (Egress) later.

Raw mesh WebRTC is not used.

## Access

A meeting belongs to one conversation (room or DM) and has no rules of its
own. Every endpoint resolves the meeting, then runs `requireRead` on its
conversation. That checks:

- a session for an active account;
- current membership;
- company/branch scope.

Anything else is a 404. `POST /api/collab/meetings/:id/join` issues a
10-minute, single-room, single-person token (identity = user id) only after
those checks. Removing someone from a room, deactivating them or moving
them out of scope also disconnects them from a live meeting
(`evictFromMeetings`), and they cannot obtain a new token.

## Data (migration 0006, additive)

- `Meeting`: conversation, organiser, title, instant/scheduled, video/voice,
  status (scheduled/live/ended/cancelled), times, a random provider room
  name, `reminderSentAt`.
- `MeetingAttendance`: who joined and left. It drives history and
  "In a meeting".

No media state is stored.

## Flow

1. **Start.** Room → Start meeting (video / voice / schedule). DM → Voice call
   / Video call. One live meeting per conversation: starting while one
   runs opens that one.
2. **Signal.** `meeting.started` / `.updated` / `.ended` go to readers of the
   conversation. `meeting.invited` rings the other side of a DM call.
   Notifications cover:
   - started;
   - scheduled;
   - calling you;
   - starts in 10 minutes (cron `*/5`).

   None of them go to the person who acted.
3. **Pre-join.** Camera preview, device choice, mic level, on/off toggles.
   Nothing connects until **Join**.
4. **In the meeting.**
   - stage (screen share, or the active speaker in speaker view) and a
     responsive grid;
   - controls: mic, camera, flip (phones), share, people, chat, more
     (layout, devices, end for everyone), leave;
   - chat is the conversation itself;
   - host mute/remove goes through the server.
5. **End.**
   - the organiser, a room admin or either side of a call can end it for
     everyone;
   - LiveKit's `room_finished` webhook also ends it;
   - the sweep closes meetings idle for 10 minutes or running over 12 hours.

## Setup (production)

1. Create a LiveKit Cloud project and note its URL (`wss://<project>.livekit.cloud`).
2. Create an API key and secret for it.
3. Set the Worker secrets. They never go in git, D1, `NEXT_PUBLIC_*` or the
   client:

   ```
   npx wrangler secret put LIVEKIT_URL --env live
   npx wrangler secret put LIVEKIT_API_KEY --env live
   npx wrangler secret put LIVEKIT_API_SECRET --env live
   ```

4. In the LiveKit project, add the webhook
   `https://crm.enercore.ae/api/meetings/webhook`. It is signed with the
   same key, and Enercore verifies the signature and body hash.
5. Apply migration 0006 and deploy (this adds the `*/5` cron).

Without these settings, meetings show "Meetings aren't set up yet". Preview
never has meetings.

## Recording (not implemented)

Add it later through LiveKit Egress. It must have:

- an explicit on-screen recording indicator for everyone;
- a start/stop limited to managers;
- a storage decision (for example the private R2 bucket);
- a retention policy;
- recordings served only through the same conversation access check.
