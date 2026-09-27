# Meeting Intelligence — zero-cost mode (Phase 3)

**Decision:** no paid transcription. Phase 3 adds **$0** of transcription, egress, recording or agent-hosting cost.

- **Workers AI:** reports use the existing account allocation. When the daily free capacity is used up, report generation stops with "AI capacity has been reached for today", and meetings and the CRM are unaffected.
- **LiveKit:** normal meeting usage stays on the existing plan. Phase 3 adds no egress, transcription, recording or agents.

The earlier paid proposal (LiveKit Track Egress → Workers AI Nova-3, about $0.01 per participant-minute) is **not** used. It stays below for reference only, in case paid transcription is ever approved.

## What Meeting Intelligence uses

Only what Enercore already has, and it says so:

- meeting details and attendance (from meeting events — never derived from text);
- **Meeting Chat** (guests are the customer side, everyone else is Enercore staff);
- **structured meeting notes**: Decision, Action item (optional owner and due date), Customer requirement (typed fields plus "what was said about it": requested, preferred, discussed, proposed or agreed), and Note. Notes are for employees only, added from the room's More → Meeting notes, or on the meeting report;
- the related lead, **per viewer**, only if that viewer may read it (for suggestions and quotation prep — never inside the stored report).

Every report states: *"No transcript is available. This report uses meeting details, attendance and Meeting Chat."* It never claims anyone "said" something they didn't write, and never implies that audio or video was analysed.

## Generation, storage and cost

- **On request only.** A report is created when an employee clicks **Generate AI report** after the meeting has ended. It is never generated automatically.
- **Stored** in `MeetingReport`, one current version per meeting, with a fingerprint of the written record. Opening the report again makes **0 AI calls**.
- **Stale reports are flagged.** If the chat or notes change later, the report shows a notice and waits for someone to regenerate it, rather than regenerating silently.
- **Regenerate** creates a new version and keeps the metadata of earlier versions (the last 10).
- **The organiser can edit the executive summary.** The report then shows "Edited by {name}", and the AI text is kept.

**Calls per report:**

| Case | AI calls |
| --- | --- |
| Typical meeting (the written record fits one chunk of about 6,000 characters) | **1 fast-model call** (`llama-3.1-8b-instruct-fast`), extracting everything including the summary |
| Long meeting | 1 fast call per chunk (at most 6, newest kept; truncation is disclosed) + **1 primary-model synthesis** over the merged, already-verified facts (not the raw text) |
| No chat and no notes | **0 calls** (a deterministic "nothing to summarise") |
| Requirement notes | Added exactly as typed — no AI |

All calls go through the Phase 1 gateway: sanitiser, untrusted fencing, schema validation, rate limits, quota handling, and `AiUsage` metadata only.

## What the server checks (whatever the model says)

- **Citations:** each one must be a chat message or note of *this* meeting. Invented references are dropped.
- **Decisions:** need a Decision note, or supporting text with no hedging ("maybe", "should we", "consider"…).
- **Action items:** an owner is kept only if the cited text names them; a due date only if the text gives it.
- **Requirements:** use the Phase 2 rules. The quoted evidence must be in the cited message, and the status is capped by that sentence, so a customer's question or request never becomes "agreed". Typed requirement notes keep the status the employee chose.
- **Changed values:** a value that changed during the meeting ("500 MT/month", later "800 MT") is shown as *changed during the meeting*, earlier then later. The latest value is only a candidate for review.
- **No false completion claims:** nothing may state an event the record doesn't contain ("email sent", "customer agreed").

## CRM suggestions (per viewer, deterministic, no AI)

The suggestions only appear for someone who may read the related lead. They are applied through the ordinary records API:

- **Outcome note** — pre-ticked.
- **Follow-up** — pre-ticked. Only if the record names a date; validated with the GST calendar-year rule.
- **Requirement update** — pre-ticked. The latest value, labelled; a commercial term only if agreed.
- **Status change** — never pre-ticked. Only if a decision names the stage and the CRM workflow allows it.

**Prepare quotation** reuses Phase 2, and requirement notes from the lead's meetings feed the same four buckets.

## Security

- Notes and reports need the viewer's **current** meeting access. Guests have no employee session, so no notes, report or history reaches them.
- Knowing a meeting or note id grants nothing, and a deactivated user is refused.
- The stored report contains meeting sources only, so an invitee who can't read the related lead sees the report but nothing about the lead.

## Optional browser transcription — feasibility (not built)

- **How it would work:** the Web Speech API in each participant's own browser, which gives speaker attribution per browser.
- **Zero cost** only in on-device mode (`processLocally = true`). Chrome's default engine sends audio to Google's servers, which is not acceptable here. On-device mode needs a language pack download (Chrome, Safari).
- **Coverage:** Firefox doesn't support the API at all, so coverage would be incomplete (only people whose browsers support local recognition, and only after consent).
- **Recommendation:** not offered in V1. If it's added later as a Beta, it plugs into `TranscriptionProvider` (`src/lib/transcription.ts`, provider id `browser-beta`). It would be labelled "Browser transcription (Beta)", need explicit consent and a visible indicator, and its text would be just another untrusted source that never changes the CRM without review.

The V1 provider is **none**.

## Retention (recommendation, not policy)

Notes and reports are kept until an authorised person deletes them. A configurable retention period is recommended later; Enercore decides the period.

## Reference: paid option (not used)

LiveKit Track Egress (one audio stream per participant over WebSocket) → a Durable Object → Workers AI `@cf/deepgram/nova-3` streaming. Speaker attribution is exact per track.

- Cost: about $0.001/min egress plus $0.0092/min STT per participant.
- Sources:
  - LiveKit Track Egress: https://docs.livekit.io/home/egress/track/
  - LiveKit pricing: https://livekit.com/pricing
  - Workers AI Nova-3: https://developers.cloudflare.com/workers-ai/models/nova-3/
  - Web Speech API `processLocally`: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally
