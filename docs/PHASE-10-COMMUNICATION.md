# Phase 10 — controlled outbound communication

Local candidate only. No production migration, deployment, mailbox login, paid
provider action or real delivery is authorized by this implementation.
Phase 4/R2, attachments, voice notes and recording storage remain on hold.

## Delivered locally

The existing Email page now has **Outbound & templates**, alongside the unchanged
private test inbox and Social channels. The new area supports:

- Private, record-linked email/WhatsApp drafts. Recipients come from the selected
  record; email validation and explicit international phone numbers are required.
- Company templates with the fields `contact`, `record`, `company`, `product`,
  `sender`. No invented prices, quantities, commitments or calculated totals.
- Immutable template revisions; archive and replace rather than silently change
  an existing message's source. Message bodies are saved snapshots.
- Edit, cancel, mark ready, and schedule a **review** using shared date/time controls
  in Dubai time. Due reminders appear in Review reminders. Opening the workspace
  refreshes their state; this is not a background notification or auto-send job.
- Explicit recipient/content confirmation and permission/opt-in evidence before
  one submission. Evidence is a user attestation, not independently verified consent.
- Private immutable message history, optimistic versions, exact-create replay
  checks, and atomic claim-before-network submission. Twenty submissions per
  sender per hour, enforced in both service and database.
- Distinct captured, accepted, rejected, uncertain and submitting states. No state
  claims delivery/read confirmation. No automatic retry or bulk outreach.
- Theme-aware compact mobile cards and bounded scrolling (latest 200 messages,
  at most 100 templates per company, bounded history; older records stay stored).

## Access and data

Every message is private to its creator, including from MDs. Live record read
permission is rechecked before showing message/history; live write permission is
required for creating and changing drafts or sending. Company, branch, record
ownership, module restrictions and soft deletion are independently checked. Linked
HR/leave, employee IT and marketing records cannot be used as contact targets.
Revocation hides existing messages; it does not delete their audit history.

Shared templates are visible to commercial roles in their company. Company-wide
MD, Group Manager, Sales Manager and Marketing Manager roles can create/archive
them if their commercial module grants permit it. Branch-limited users cannot
manage company-wide templates. Templates never grant record access.

Migration `0019_outbound.sql` adds CommunicationTemplate, OutboundMessage and
OutboundEvent. Existing business records and previous tables are preserved.
SQL guards retain immutable identity, final message content, event history and
legal state transitions. A cancellation is not a deletion.

## cPanel email — settings pending

The user confirmed cPanel IMAP and will provide server details later. **The live
IMAP inbox is not implemented or connected in this candidate.** The original
Email workspace remains explicitly disconnected outside the local test inbox.
IMAP sync, MIME parsing, per-user account mapping, mailbox folders and Sent-folder
filing require the mailbox details and a follow-up connection/verification step.

An outbound SMTP adapter is implemented for authenticated implicit TLS on port
465, certificate verification enabled, AUTH PLAIN, one recipient and plain-text
UTF-8 MIME. It waits for the SMTP server's final DATA acceptance. No insecure
fallback or port 25 is used. Protocol tests use a fake socket. **The actual
cPanel server, certificate, authentication and Cloudflare reachability have not
been verified.** Some hosts may need a separately approved relay if they block
Worker connections. SMTP acceptance is not delivery confirmation.

Server-only secret `OUTBOUND_CONFIG` is a JSON object keyed by exact CRM company
name. Its optional `email` object has `host`, `username`, `password`, `from`,
`replyTo`. This is a company-owned sending account, not a private user's IMAP
mailbox. A separate `OUTBOUND_ENABLED` value must be exactly `true`. Neither
binding was installed. Do not paste credentials into chat or put them in source,
public environment variables, browser storage or fixtures. Configure them through
the approved secret-management flow when connection work is authorized.

The adapter uses the installed Worker's Node TLS compatibility; see
[Cloudflare TLS documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/tls/)
and [cPanel Email Accounts](https://docs.cpanel.net/cpanel/email/email-accounts/).
Server credentials/settings must come from cPanel's actual Connect Devices page,
not from assumptions about the hostname.

## WhatsApp — provider setup pending

No WhatsApp account was connected. The optional Meta Cloud API adapter accepts
only a server-configured approved template, never unrestricted free-text sends.
Under a company's optional `whatsapp` configuration: `token`, `phoneId`, `version`,
and `templates` keyed by CRM template ID. Each mapping needs the Meta-approved
`name`, `language` and exact local placeholder `body`. Placeholder occurrences map
to positional body parameters in order. Header/button/media template components
are not supported. An administrator must verify the approved Meta template text,
parameter order and language before enabling any mapping. Archived CRM templates
cannot be submitted. Changes to rendered facts require a fresh reviewed draft.

Meta account approval, opt-in process, provider limits/fees, webhook delivery/read
events, incoming replies and an opt-out suppression registry are **not completed**.
Do not enable production WhatsApp before those compliance/operational gaps are
addressed. API reference: [Meta's official Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

## Failure handling

A network timeout, malformed success response or server error is uncertain, not
failed-to-send. Such a message is locked. A process interruption after the atomic
claim can leave `sending` indefinitely; investigate with the provider and the
message ID. The UI offers no resend for either case. Even a rejected message
requires inspection before deliberately creating a replacement. No automated
retry exists, because SMTP/Meta cannot guarantee duplicate suppression here.

If a mutation succeeds but refreshing fails, the form closes and the workspace
shows the refresh error; refresh before creating anything again. Failed optimistic
updates do not write success history. Provider errors and credential-bearing data
are not logged or returned to the browser.

## Local verification and release

Verified on 19 October 2026: 532 automated checks, TypeScript, the OpenNext Worker
build, 31 recovery unit cases and the real isolated D1 export/restore rehearsal
passed. Thirteen final browser scenarios passed: three outbound, three Operations,
four Tasks and three existing Email/content scenarios. Outbound layouts were
checked at 1440, 768 and 390 pixels in light/dark themes, with no horizontal
overflow. This verifies the local preparation workflow, not a real cPanel or
Meta connection. Initial browser runs exposed test navigation/selector issues
and a real phone-width navigation overflow; those were corrected and the final
scenarios rerun. No acceptance assertions were removed.

Run the unit suite, type checking, OpenNext build, `playwright.outbound.config.ts`
against an isolated review Worker, and `tests/recovery_rehearsal.py`. The recovery
schema profile is `communication` (0019), with the previous profiles retained.
Do not change the scheduled production backup profile before an authorized release
has verified live migration history. Migrations 0017, 0018 and 0019 are local
candidates, not a statement that production has any of them.

Release remains a separate decision. The later per-user mailbox implementation
is documented in [MAILBOX-CONNECTIONS.md](MAILBOX-CONNECTIONS.md). It adds a real
IMAP/SMTP connection screen locally; actual company provider authentication and
delivery have not been verified. This section describes the earlier record-linked
outbound preparation workflow, which remains separately configured.
