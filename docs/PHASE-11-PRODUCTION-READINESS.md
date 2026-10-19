# Phase 11 — production readiness and team launch

Release date: 19 October 2026. This is the release evidence and handover for the
existing CRM, not a new business-feature phase. Live verification is recorded
below only after the deployment completes.

## Live release result

Deployed successfully to https://crm.enercore.ae as Worker version
`0ff1b582-277f-4f6a-9b40-1ea0713aa2b2` (100% traffic verified). Migrations
0017–0021 are applied, with none pending. The mailbox encryption secret was
generated directly into Cloudflare's secret store; its value was not logged,
committed or copied from local mail. R2 remains unbound and outbound/WhatsApp
activation settings were not installed.

Validated private backup files are retained locally:
`backups/enercore-crm-20261019T101205Z.sql` (before) and
`backups/enercore-crm-20261019T101420Z.sql` (after), with validation manifests.
Comparison confirmed every pre-existing application table retained identical
rows; only migration metadata and 16 new tables were added. No off-device mirror
or separate encryption-key recovery copy has been established by this release.

Read-only live smoke passed: login renders at 390/1440 px without browser errors
or horizontal overflow, eight protected APIs deny anonymous access (401, or 403
for user administration), both local test endpoints return 404, and login retains
the app CSP/framing protection. No live users or records were created for tests;
no real email was submitted. Authenticated live team/provider acceptance remains
the handover step below, not a claimed completed test.

The user's original local review workspace was restored after isolated testing;
its existing mailbox connection and saved database were not reseeded or removed.

## Scope and evidence

- Fixed empty inbox after reload/concurrent tabs: a bootstrap/manual header read
  no longer depends on another tab releasing the shared metadata lease. Routine
  polling stays coalesced. Credentials/connection changes still invalidate reads.
- Non-empty server folders with no loaded headers show loading/retry, not an
  incorrect empty-folder claim. A simulated skipped first sync recovers without
  refresh, loads all 456 fictional headers, and opens the newest email.
- 564 automated checks, TypeScript and the production OpenNext build passed.
- All 16 roles passed permitted-page loading and server record scope checks;
  user administration and Operations authorization were checked per role.
  The MD additionally opened all shared workspace views. These are local
  fictional-account checks, not a claim of logging into every live team account.
- Collaboration authorization/IDOR scenarios, five mailbox flows, purchase and
  finance workflow, outbound capture and responsive checks passed. All four Tasks
  scenarios passed, including preview-only automation and deduplicated triage.
  Two initial failures were test setup problems (a streamed-page selector and a
  stale fixture control-token path); both were corrected and the affected matrix
  and task scenarios rerun successfully.
- With no R2 binding, file controls were hidden, uploads refused, private file
  URLs unavailable, and text chat still worked.
- The isolated D1 rehearsal upgraded/restored through migration 0021 and compared
  complete table contents. The live target was verified as `enercore-crm-live`,
  `crm.enercore.ae`, D1 `71f8d380-5c3c-478b-822c-7fcd47b102d2`, company Cloudflare
  account `b0f89a960fe31a60eeed084dd7e0db96`. Preview stays a separate Worker.
- A user-approved private, Git-ignored local pre-release export validated under
  the `shared-options` schema profile (0016). No off-device mirror was available.
  Database contents and credentials must never be committed or shared in tickets.

## Held or separately configured

Phase 4 remains on HOLD: collaboration uploads, voice-note files, room images and
meeting recording storage require R2. Text chat and configured LiveKit calls do
not require R2. Email attachments are fetched directly from a user's mailbox and
are a separate on-demand preview path, not persistent CRM uploads.

WhatsApp is not ready for live use: provider setup, consent/suppression and delivery
webhooks remain pending. Company-owned outbound campaigns remain disabled until
separately configured. Do not enable `OUTBOUND_ENABLED` during this rollout.

Private email users connect their own authorized mailbox in live Email. The
encryption key is installed as a Worker secret; local mailbox passwords are not
copied. Cached email previews remain tab-local; saved drafts/submission history
are separate. Test fixtures demonstrate behavior but do not prove real provider
authentication, SMTP acceptance or recipient delivery. The team must verify its
actual accounts; never interpret SMTP acceptance as delivery/read confirmation.

## Team handover

1. An existing MD/IT administrator signs in at the live URL and checks team roles,
   assigned companies, branch scope and overrides. Do not share administrator
   accounts. Provision only actual staff through Access control.
2. Each staff member signs in, changes any temporary password, checks the pages
   available to their role and confirms that unrelated companies are not shown.
3. Connect email separately per user. Confirm inbox count and original HTML,
   attachment preview and reconnect behavior. Only send a reviewed message to an
   agreed test recipient; no bulk sending or automatic lead creation.
4. Automation rules are not enabled by the release. Managers review the read-only
   preview and explicitly enable only the rules and assignments they approve.
5. Verify a call between two consenting team members and allow microphone access.
   File/recording controls remain unavailable while Phase 4 is held.
6. Keep the backup and this evidence private. After 0021 use `mail-folders` for
   backup validation. Existing scheduled backup configuration must use that
   profile; the script default is updated as part of the release.

## Rollback and remaining verification

Keep additive tables and new records. An older Worker can stop serving the new
features but is not permission to restore an old database over new activity.
Disable automation and pause affected business writes before rollback. A database
restore requires an isolated target, reconciliation and explicit approval.

Production smoke checks must verify the actual new version, login/public assets,
anonymous API denial, production mode, no test endpoints and no R2 binding.
Authenticated live acceptance still needs the existing administrator/team; no
fictional users or records are seeded into production for testing.
