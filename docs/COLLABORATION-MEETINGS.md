# Meetings (V3) — recommended architecture

Not implemented. This records the design so V3 needs no redesign of V2.

## Requirements

- 1-to-1 audio and video calls, and group meetings;
- screen sharing, mute and camera controls, a participant list;
- join and leave, and meeting links;
- possibly recording later.

It must work on desktop and mobile browsers, and be reliable across
corporate NATs and firewalls.

## Why not mesh WebRTC

Peer-to-peer mesh sends every participant's media to every other participant.
It breaks down beyond three or four people, drains mobile devices, and fails
behind symmetric NAT without TURN. Production group meetings need three parts:

- **SFU:** a selective forwarding unit, so each client uploads once and the
  server forwards the streams;
- **TURN:** relay for restrictive networks;
- **signalling:** room state, offers and answers, and presence.

## Options

| Option | Fit | Notes |
| --- | --- | --- |
| **Cloudflare Realtime (Calls/SFU + TURN)** | Best infrastructure fit | Runs where the CRM already runs. SFU and TURN are managed; we'd build the meeting UI and signalling (our Durable Objects already do realtime). Check the current free allowance and pricing before committing. |
| **LiveKit (Cloud or self-hosted)** | Best developer experience | Open-source SFU with good React SDKs, screen share, recording (Egress) and server-issued access tokens. There's a free Cloud tier to start, and it can be self-hosted later. |
| Daily | Fastest to ship | Hosted, with a prebuilt UI available, and a generous free tier. Less control, and a third party processes the media. |
| Jitsi | Self-hosted, free | Heavy to operate well; access control is harder to integrate. |

**Recommendation:**

1. Prototype with **LiveKit Cloud** for speed and SDK quality, keeping its token
   server inside our Worker.
2. Evaluate **Cloudflare Realtime** in parallel. If its SDK and pricing hold up,
   prefer it for the single-vendor footprint.
3. Either way, provider-specific code stays behind one small module, so the
   choice can be reversed.

## Access control (non-negotiable)

- Meetings belong to a conversation: `/api/collab/conversations/:id/meeting`.
- The Worker issues a short-lived join token (at most 10 minutes, single room,
  identity equal to the user id) **only** after the same `conversationAccess`
  check every Collaboration route uses. That means an active account, current
  membership, and company/branch scope.
- Meeting links carry no power by themselves: opening one still requires sign-in
  and the access check. Removed members can't obtain new tokens; kicking a
  participant also revokes them at the SFU.
- "Meeting started" and "ended" events use the existing realtime audience.
- The provider sees media and display names only, never CRM data.

## UI slot

- The thread header's `.collab-thread-actions` group is where [voice call] and
  [video meeting] go, before the focus and details toggles. No layout change is
  needed.
- A meeting opens as its own full-viewport surface, like focus mode, with the
  thread available alongside it.
