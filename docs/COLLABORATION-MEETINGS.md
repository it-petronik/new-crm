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

## V3.1: meeting management, guests, attendance and recording

### Kinds of meeting

- **Room meeting** and **DM call** (linked to a conversation). Access is the
  conversation's. The database still allows one live meeting per
  conversation.
- **Standalone meeting** (`conversationId` NULL), from Collaboration →
  Meetings → New meeting. The organiser invites colleagues who share a
  company with them. Access is the organiser plus current invitees.
- **Guest link** on a room or standalone meeting, never a DM:
  - the link is `/meet/<token>`, a 256-bit token;
  - only its SHA-256 is stored;
  - expiry is 1 hour, 24 hours, 7 days, or until the meeting ends;
  - it can be regenerated, which revokes older links, or revoked;
  - admission is either "host must admit" (the default) or "anyone with
    the link".

### Guests

A guest uses only `/api/meet/*`. They never get a CRM session, and CRM APIs
refuse them.

1. `lookup` returns only the title, time and organiser's first name.
2. `join` takes a name. The guest either waits, and the hosts are told live
   and in their inbox, or is admitted.
3. `status` is polled with the guest's own random secret. It returns the
   decision, and a fresh meeting token once admitted.

The guest token can publish camera and microphone only, for this one meeting.
Guests never reach recordings, chat or anything else.

### Sharing a meeting: guest link versus internal link

- **Guest link** (`/meet/<token>`): for clients and anyone outside
  Enercore. Only people who manage the meeting (the organiser, or a room
  owner or admin) can see, create, regenerate or revoke it.
  - "Copy meeting link" copies it from the Meetings list, the details page,
    a record's meetings, and inside the meeting.
  - With no link yet, one confirmation ("Create guest link?" → Create & copy)
    makes one. It keeps the meeting's admission rule, "host must admit" by
    default, and lasts until the meeting ends.
- **Internal link** (`/workspace/…/collaboration?tab=meetings&meeting=<id>`):
  for people in Enercore. It always requires signing in, and afterwards
  returns to the meeting. Everyone else sees "Copy internal link".
- **The token.** It is HMAC-SHA256 of the invite's random id, keyed with
  `MEETING_LINK_SECRET` (falling back to `LIVEKIT_API_SECRET` under its own
  label). D1 stores only its SHA-256, so a database copy reveals nothing,
  yet the server can show the same link to a manager on any device.
- **Older links.** Links created before this change, or before a rotation of
  that secret, still work but can't be shown again. The UI offers to
  replace them.
- **Revocation.** Regenerating revokes earlier links, and ending or cancelling
  the meeting closes them.
- **In the meeting.** Next to the title are "Secure meeting",
  **Copy meeting link** and **Meeting info**. Meeting info is a popover, or a
  bottom sheet on phones.
  - Employees see the time, host, guest access, the link, and "Open meeting
    details" (in a new tab, so the call keeps running).
  - Guests see only the title, time, host's first name and the link they
    came with. They never see CRM data.

### Attendance and reports

- `MeetingSession` holds one row per connection, written from LiveKit
  webhooks. Reconnects add rows, and totals are summed.
- Migration 0007 carries the earlier `MeetingAttendance` rows across.
- `MeetingActivity` records started, ended, screen share start/stop and
  recording start/stop.
- The report shows participants (internal or guest, first joined, last left,
  total), invited versus attended, activity and recordings. It exports to CSV
  (formula-safe) or print/PDF.
- Scheduled meetings nobody started become "missed". History is never
  deleted when a provider room ends.

### Recording (LiveKit Egress)

A host starts and stops recording. Starting sets the room's metadata, so
every participant, guests included, sees "● Recording" and who started it.
The database allows one running recording per meeting. The file is written
by Egress to private S3-compatible storage (R2 via its S3 API); D1 keeps
metadata only. Downloads go through `/api/collab/recordings/:id` with the
meeting's normal access check.

Recording needs all of the following. Without them it reports "not set up".

- LiveKit Cloud with Egress available on the plan.
- R2 enabled, the private bucket `enercore-collab-files`, and the
  `COLLAB_FILES` binding restored in `wrangler.jsonc`, used for downloads.
- An R2 API token with write access to that bucket, set as Worker secrets:
  `RECORDING_S3_ENDPOINT` (`https://<account>.r2.cloudflarestorage.com`),
  `RECORDING_S3_BUCKET`, `RECORDING_S3_ACCESS_KEY`, `RECORDING_S3_SECRET`.
- The LiveKit webhook (already configured). It also delivers
  `egress_ended`, which marks recordings saved or failed.

Local recording ("save to this computer") is deliberately not offered.
Capturing everyone reliably in the browser would need a tab capture that
omits the recorder's own microphone and varies by browser, and a partial
recording must never pass for the meeting's record.

### Meetings and CRM records

A meeting may be about one lead, customer, quotation or order
(`relatedRecordId`, plus `relatedRecordKind`, which the server copies from
the record).

- **Creating one:** from the record's detail (Schedule meeting / Start now).
  This creates a standalone meeting titled "Meeting with …", with the record's
  owner invited and the record linked. No chat room is created.
- **Showing the link:** the meeting names its record only to readers who may
  read that record now (`attachRelated`). Other invitees see the meeting but
  not the record. Guests see neither.
- **Listing a record's meetings:** only meetings the reader could already
  reach. Reading a lead never opens its private meetings.
- **Log outcome:** after the meeting, this writes an ordinary audited note,
  an optional next follow-up and an optional status change through the
  records API, with the record's own permissions and workflow rules.
- **My Day** lists today's meetings.

### Migration 0007

0007 rebuilds `Meeting` to make `conversationId` nullable. The rebuild:

- copies every row column by column;
- keeps `MeetingAttendance` aside across the drop, because D1's foreign keys
  would otherwise cascade-delete it, and restores it;
- carries attendance into `MeetingSession`;
- recreates every index, including the one-live-meeting guard.

It was dry-run on SQLite with foreign keys enforced, then applied to local D1
with before/after comparisons.

**Recovery.** The release takes `npm run db:backup` immediately before
`db:migrate:remote`. If 0007 ever needed undoing:

1. Restore that backup into a scratch database with
   `scripts/restore-d1.sh <scratch-db> <backup.sql>`, and verify it.
2. Then either point the Worker at it, or restore production itself (see
   `docs/DEPLOYMENT.md`).
3. Redeploy the commit before 0007.

The migration never modifies conversations, messages or CRM records, so
nothing outside the meeting tables needs recovering.


## Media: quality and reliability

**One media path for everyone.** Employees and guests use the same code:
`device-setup.tsx` (pre-join), `use-local-media.ts` (in the meeting) and
`media-tile.tsx` (tiles).

**Pre-join hands over its tracks.**
- The preview creates LiveKit tracks: camera at the chosen quality, and
  microphone with echo cancellation, noise suppression and gain control.
- On Join those same tracks are published directly: the clean device track,
  with no processor in between.
- The devices are never released and re-opened, so there is no race for the
  camera and no black gap. `LiveKitRoom` is told not to open devices itself.
- After a rejoin the old tracks are gone, so fresh ones are created.

**State comes from LiveKit.**
- A control shows ON only for a live, unmuted publication.
- Turning a device on shows "Starting…" until LiveKit publishes it. If that
  fails, the control stays off and a plain message appears with an action:
  How to allow, Try again, or Use default microphone.
- A device that ends is restarted by LiveKit or marked off, and the person is
  told.
- Reconnects, waking up, returning to the tab and rotating a phone re-check
  the actual tracks.
- A chosen device that disappears falls back to the default, with a notice.
- If a working microphone produces digital silence for 12 seconds, a warning
  appears.
- If the browser blocks playback: "Tap to enable meeting audio" (one tap).

**Tiles are never blank.** Each tile shows one of: video (only once real
frames arrive), off, starting, connecting, paused (network), recovering,
unavailable, or reconnecting.
- Remote video that stalls is resubscribed once.
- Your own camera is never restarted from a tile.

**Quality.**
- Auto (default), Data saver or High quality, remembered per device. Guests
  keep theirs for the visit only.
- Adaptive stream, dynacast and simulcast (two layers) are always on.
- Camera capture is 720p/30 in Auto; nobody is forced to 1080p.
- Guests use exactly the same presets as employees.
- Screens are encoded for readability.

**Settings.**
- More: Devices (microphone, camera), Video quality, Layout (Grid or Speaker),
  Recording (hosts) and Troubleshooting.
- Pre-join: preview, mic and camera toggles, Microphone, Camera, Video quality,
  and Join.
- There are no background effects. They were removed, together with their
  processor dependency and assets.

**Diagnostics.**
- **More → Troubleshooting → Copy diagnostics** copies: browser and platform,
  connection state and quality, the quality mode, whether the camera is
  processed (always false), each participant's publication and subscription
  state, the reconnect count and recent event names.
- It never includes device ids, frames or audio.
- The same snapshot is `window.__enercoreMeetingDiagnostics()`, which the
  media E2E tests read.


## Meeting chat (migration 0009)

Every meeting has usable chat, and the Chat button always opens it.

**Which chat is used**
- **Room and DM meetings.** Employees chat in the conversation, as before.
  Messages stay there, and nothing is copied anywhere else.
- **Standalone meetings, and every guest.** They use the meeting's own chat:
  the `MeetingMessage` table, tied to `meetingId`. No Collaboration room is
  created.
- **Room meetings with guests.** Once guests have been in the call, employees
  see two tabs: *Meeting chat* (includes guests) and *Room chat* (Enercore
  only).

**Who may use it**
- **Employees** need their current meeting access (`requireMeeting`), so a
  removed or deactivated person loses it at once.
  - `GET/POST /api/collab/meetings/:id/messages` checks the session, origin
    and message rate limit.
  - Reading works during and after the meeting; posting only while it is live.
- **Guests** use `POST /api/meet/chat` and `POST /api/meet/chat/send`, with
  the admission secret.
  - They get access only while admitted and while the meeting is live, and
    see only messages from their admission onwards.
  - A declined, removed or departed guest, or any guest once the meeting has
    ended, gets 404.
  - Limits: the per-IP guest limit plus 20 messages a minute per guest.
  - Guests never receive a CRM session.

**Messages**
- Plain text, cleaned like Collaboration messages, up to 4,000 characters,
  never rendered as HTML.
- The sender's name comes from the account or the admission, never from the
  client.
- `clientKey` makes a retried send land once.
- The database enforces exactly one sender (`MeetingMessage_one_sender`).
- The read cursor is commit order (`rowid`), so messages sent in the same
  millisecond are never skipped or reordered.

**Real time, without polling**
- After storing a message, the server sends a content-free signal (the
  message id only) into the call through LiveKit's server `SendData`, on topic
  `enercore-meeting-chat`. This reaches guests too.
- Employees elsewhere, such as on Meeting Details, get a `meeting.message`
  event on Collaboration's live channel.
- Each reader then fetches the new messages with their own access.

**Afterwards**
- **Meeting Details → Chat** (read-only once ended) is for employees who may
  open the meeting.
- Room and DM meetings show this section only when guests chatted.
- Guests have no access after the meeting.
- Nothing is copied into lead notes. Messages are plain rows, so a future
  summary can read them with the same access rules.

**Migration 0009** (additive) creates `MeetingMessage` with one CHECK
constraint, an index on `(meetingId, id)`, and a unique index on
`(meetingId, clientKey)`. Existing tables are untouched.
