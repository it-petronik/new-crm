# Private cPanel email connections

## Complete folder headers and compact controls (latest)

The latest 40 headers appear first for fast startup. Older headers then load
automatically in read-only batches of up to 100, until the full folder is
available. Bodies and attachments are still fetched on demand. The same path
works for Inbox, Sent and server Drafts; messages stay only in tab memory.
Search, enquiry filtering and sorting operate over the progressively loaded
headers. The footer shows shown/folder totals and a loading indicator, not a
permanent 40-message limit. Temporary page failures retry and expose a retry
control; cursor references are bound to owner, connection, folder and validity.
Refreshing current headers merges without dropping already loaded older mail.

Sorting is a compact toggle beside Refresh, with accessible newest/oldest labels.
Desktop opens the newest available message instead of an empty reader; mobile
retains the list-first flow. Sender formatting, image privacy and bounded body
cache behavior remain unchanged. No provider mail is moved/deleted or copied
into D1. This supersedes the latest-40-only descriptions below.

## Connection recovery, accurate totals and original-image rendering (latest)

The Inbox badge is the provider's folder total, not the latest 40 downloaded
headers or the enquiry-filter count. The list distinguishes loaded messages,
search/enquiry matches and the folder total. **Newest first** is the default;
**Oldest first** is available and filter/sort changes reset list position.

Read requests have timeouts and bounded retries. Initial connection/status
failures retry without reloading; an online event resumes failed sync/reads.
Temporary errors retain the current header list. Message-body failures show
skeleton/error/retry states, never the stripped header snippet as a substitute
for the original HTML. Invalid credentials require reconnecting with the correct
password rather than repeated automatic sign-in attempts.

Original HTML now renders through authenticated POST `/api/mail/render`, not
`srcDoc` (which inherited the app CSP and silently blocked approved images).
Client sanitization and a second server HTMLRewriter boundary remove active
content. The frame has its own no-script CSP and SAMEORIGIN framing policy;
the rest of the app keeps its original CSP and DENY framing policy. Submitted
HTML exists only transiently, with `private, no-store` responses. There is no
server image proxy or downloaded-message database cache.

Embedded raster CID images load independently. Approved external images support
protocol-relative and common lazy-image URLs, with visible failures and **Retry
images**. External images still need explicit approval because they can report
opens. A sender's expired/deleted image URL, HTTP mixed-content restriction or
provider outage cannot be guaranteed to display. Cold IMAP reads still depend
on the provider; mounted-tab cached reads avoid repeating those downloads.

Implementation reference: [Cloudflare HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/).
This section supersedes earlier rendering, retry and count descriptions below.
No production deployment or migration was performed.

## Preview-only storage and enquiry filtering (current)

Downloaded INBOX/Sent/Drafts headers and bodies are no longer written to D1.
Authenticated sync responses go directly to the mounted tab's memory. Bodies use
the bounded in-memory reader cache; nothing is saved to localStorage, IndexedDB,
R2 or a shared server email cache. Reloading/closing the page drops previews;
another sync fetches them from the original mailbox. Cron/background mailbox
fetching is disabled. The app does not delete mail from the provider.

Message references contain only UID/UIDVALIDITY/folder information, signed and
bound to the owner and current connection. Another user, altered reference,
reconnected mailbox or changed UIDVALIDITY cannot reuse the reference. No email
subject, sender address, body or password is embedded in these URLs. Provider
folder counts and connection health remain operational database metadata.

Encrypted connection credentials, deliberately saved private drafts/submission
history and explicitly reviewed CRM lead records remain separate. Email analysis
reads the selected message on demand; provider AI remains explicit and its answer
cache is disabled for this endpoint. Usage logs contain operational metrics, not
email text. Headers and attachments still pass through the server transiently.

The old broad keyword flag is replaced by conservative, rule-based **Possible
enquiries**, not a claim of confirmed buyers or an AI probability. Automated
platform senders (including Facebook), notifications and promotions are excluded.
RFQs/explicit website enquiries qualify for review; body-based classification
requires a buying request plus product/quantity context. Header-only triage may
miss generic-subject enquiries: open and analyse those manually. AI sales output
is also gated by this evidence check; no shared lead is created automatically.

With the user's approval, the saved local workspace's 40 INBOX and 40 remote-folder
cache rows were cleared. Connection count remained one; drafts/history were zero
before and after. Re-fetch from the provider restores previews, not stored copies.
This was logical cache removal, not secure erasure of backups or SQLite history.
No production cleanup, migration or deployment occurred. Legacy tables/recovery
profiles remain for compatibility, but runtime code no longer reads/writes them.

557 automated checks, TypeScript, OpenNext build and three mailbox browser flows
verify transient previews, original formatting, read flags, privacy, attachments,
manual analysis and notification exclusion. D1 cache counts stayed zero after
browser tests. Earlier storage/filtering descriptions below are superseded.

## Original sender-format reader (latest)

HTML messages now use an isolated, no-script iframe instead of applying the
CRM's typography/table rules. Inline styles, embedded style blocks, classes,
colours, fonts, table widths/spacing and legacy email presentation attributes
are retained after HTML sanitization. The original design stays light even when
the surrounding app is dark. This preserves supported sender formatting, not a
promise of pixel identity with every Outlook rendering engine or remote font.

The frame has `sandbox="allow-same-origin"` without script/form/navigation
privileges, a restrictive CSP, no-referrer policy, and click-only safe link
handling. Scripts, event handlers, forms, nested frames, remote stylesheets,
remote fonts and active embeds remain blocked. Sender CSS cannot style the CRM.
Remote image/background loads are blocked initially; **Load external images**
opts in for this mounted message with an explicit tracking warning. Blocking
again cannot undo a request already made. The preference is not stored globally.

MIME Content-ID references resolve to privately fetched raster-image blobs:
up to six inline images, at most 2 MB each. Larger/non-raster embedded files
remain attachments. Existing attachment cards, previews, skeletons, bounded
in-memory caching and independent reader scrolling remain. The frame resizes
with content; very tall content is capped at 24,000 px with frame scrolling.
No raw sender HTML is injected into the parent app.

Verified locally: 554 automated checks, TypeScript, OpenNext build and the three
mailbox browser flows, including sender colour/width retention, Content-ID logo,
script isolation, external-image consent, repeated selection and long scrolling.
No real mailbox was used for test assertions, no migration or deployment, and
the existing connection is retained. Sections below describe earlier iterations;
their claims about stripping all sender styles/images are superseded here.

## Loading, links and attachment-preview follow-up

The latest local reader hides uncached body excerpts behind a themed skeleton,
but keeps the subject/sender visible. Attachment metadata loads separately from
the body, so cards can appear first. At most two small raster-image attachments
(up to 256 KB each) get automatic private blob thumbnails. Larger attachments and
PDFs remain explicit previews/downloads; the preview dialog opens with its own
loading placeholder. The reader toolbar no longer overlaps scrolled content,
and layout tables do not receive decorative nested borders.

Safe `https`, `http` and `mailto` links are retained. HTML links open only on a
user click with opener/referrer isolation; unsafe schemes, scripts, event
handlers, sender styles and remote image loads remain blocked. Plain-text URLs
and email addresses are clickable too. Mail content remains untrusted data.

Bodies use one preferred MIME representation instead of downloading both plain
text and HTML. A mailbox-instance-only, 20-message/five-minute in-memory cache
deduplicates requests and makes repeat selection immediate without localStorage
or a shared server cache. Disconnect and mailbox unmount clear it; late responses
cannot repopulate it after clearing. First opens still depend on provider/network
latency; this is not a claim of zero-latency synchronization or full offline mail.

Verified locally: 554 automated checks, TypeScript, production-mode OpenNext
build and all three mailbox browser scenarios passed. A deliberately held body
response verified skeleton-only body loading plus early attachment cards/image
thumbnail, safe link retention, and repeat selection without another body fetch.
Long-message/short-screen scrolling and responsive light/dark checks still pass.
No migration, production deployment or real-account test was performed.

## Outlook-style layout and provider folders (latest local candidate)

The reader now uses a compact folder rail, message list and reading pane on
desktop, with responsive tablet/phone layouts and independent scrolling. Sender
and subject are fetched as headers first; opening a message loads its body and
attachments separately. Safe semantic HTML preserves tables and paragraphs;
sender styles, scripts and external images are removed. Safe links are retained. Plain-text
fallbacks normalize excessive blank lines without changing prices or numbers.

Sent and Drafts now discover the provider's IMAP folders using special-use flags
or conventional folder names. Counts show provider totals, while each cached
folder lists its latest 40 messages. Folder checks run independently every minute
while visible and on folder selection, with a five-second minimum interval.
Unavailable folders are identified explicitly; the application does not create
server folders. Copying a server draft creates a private Enercore draft and does
not edit the original. Activity separately records Enercore submissions: SMTP
acceptance is not delivery proof or evidence of an IMAP Sent copy.

Migration `0021_mail_remote_folders.sql` and recovery profile `mail-folders` add
owner-scoped provider-folder metadata. Applied only to the saved local review
workspace. No production migration or deployment. Earlier verification sections
below describe preceding iterations, not the latest feature limits.

Latest verification: 551 automated checks, TypeScript, OpenNext build, 33 recovery
unit cases and the isolated D1 recovery rehearsal through 0021 passed. Three
browser scenarios passed, including headers shown before a delayed body response,
server-folder fixture counts, sanitized tables, stale-body isolation, attachment
controls, long-message scrolling and responsive light/dark layouts. Fictional
accounts were used; the existing real connection was retained without reading
its mail for test assertions. Real-provider folder discovery remains unverified
by these fixture checks. No external message was sent or production state changed.

## Compact reader upgrade

### Long-message scrolling follow-up

The earlier short-message layout checks did not reproduce the reported embedded
browser issue. A new 40-message/160-paragraph fixture verifies actual wheel
movement and independent pane offsets, with collapsed desktop navigation and
phone layouts. Visible pane scrollbars, keyboard-focusable readers and explicit
up/down controls now provide alternatives when an embedded host captures wheel
input. The page is no longer overflow-locked: short viewports can scroll the
outer page as well. Attachments appear above long correspondence, not beneath
it, and raw CID references receive a readable inline-image label. MIME discovery
also handles uppercase types, unnamed inline images and root attachments.

Verified locally: 547 automated checks, type checking, the OpenNext build and
both mailbox browser scenarios passed. Checks cover 1080/1440/390-pixel widths,
short-screen outer scrolling, independent wheel scrolling, scroll buttons,
attachment previews/downloads and privacy isolation. This is Chromium evidence,
not a claim that the ChatGPT embedded host itself was directly controlled.
The existing real connection was preserved; no deployment was performed.

The local reader now fills the available viewport. The folder controls and
message-search area stay visible, with independent scrolling for the message
list and reader; on phones selecting a message switches to its reader with a
Back control. Lead review is inside the reader rather than below the whole page.
Background checks do not reset the selected message, close a compose dialog or
re-download cached bodies. Manual actions are serialized behind an in-flight
check, not silently discarded. No reconnection or new database migration is
required for this upgrade.

Verified locally: 546 automated checks, TypeScript and OpenNext build passed.
The expanded browser flow passed full-text loading, image preview, attachment
download, foreign-owner rejection, lead review and internal-scroll/full-height
checks at 390/768/1440 pixels in both themes. These tests used dedicated fictional
accounts. Native PDF preview depends on browser sandbox/viewer support; download
remains available if the embedded viewer is blocked. Attachments are not malware
scanned. No deployment or production migration was performed.

Local implementation candidate, 19 October 2026. Not deployed or verified against
the real company mailbox. Never paste mailbox passwords into source files or chat.

## Connect

Open Email in the full local workspace (`http://localhost:8788`), choose
**Connect email**, and enter your own email address and mailbox password. Consent
is required. Server defaults: `mail.petronik.ae`, IMAP 993 and SMTP 465, both
implicit TLS with certificate verification. Sign-in verifies IMAP; SMTP is tested
only when you deliberately confirm a send. Real addresses use the actual adapter
even locally. Connecting does not send any email.

Only the signed-in owner can access the connection, cached messages, analysis and
private drafts. MD access does not grant access to other users' mailboxes.
Passwords use AES-256-GCM, random nonces and authenticated owner/connection IDs.
They are never returned by an API or saved in browser storage. Synced mail stays
in temporary previews. Database exports can contain deliberately saved drafts,
submission history or uncleared legacy rows; secure access accordingly.

## Fetching and lead review

The latest 40 INBOX headers are returned per sync into temporary tab memory.
There is no complete historical backfill. A visible Email page checks
every five seconds, immediately on connection/focus and on manual refresh;
this is near-live polling, not a persistent IMAP IDLE/push connection. Previously
fetched bodies are not downloaded during polling; bodies load on opening. Failed automatic checks
back off for a minute. The mailbox background sweep is now a no-op: mail is
fetched only for an authenticated open tab. Locks avoid
overlapping checks. UID/UIDVALIDITY prevent duplicate or mismatched messages.

Large email/attachment size no longer blocks the text body: IMAP body parts are
fetched independently, with a 512 KB text-part budget and 200,000-character reader
limit. Attachment metadata is loaded when a message is opened. Image and PDF
previews and downloads are on demand, capped at 25 MB decoded per attachment;
files are not cached in D1/R2 or scanned for malware. HTML/SVG/unknown files are
download-only; images are blob-backed and PDFs use a sandboxed frame. Remote
images and executable email HTML are never loaded. Old size-blocked cache rows
are repaired when opened. Very long text remains clearly labelled.
Email text is untrusted source material, never application instructions.

Potential leads are classified locally from available subjects/text and placed behind a filter, **not silently
created as shared CRM records**. Choose Analyse email, review extracted details,
and confirm the normal lead form. External AI, when configured, is invoked only
through the explicit analysis action. Local AI fixtures are labelled simulations.

## Email management

Read/search cached inbox mail, mark read/unread on the server, compose, reply and
save private drafts. Real sending requires a separate review and confirmation.
Submission history distinguishes accepted by SMTP (not delivery proof), rejected,
uncertain and locally captured. Submitted messages cannot be edited or retried
automatically. Investigate uncertain/sending status before composing a replacement.
There is a 20-submission hourly safety check, not a bulk-mail facility.

This is not yet a complete IMAP client: arbitrary folder management, attachment upload,
delete/move, sent-folder append, full backfill, delivery receipts and provider
webhooks are not implemented. Activity is Enercore history, separate from IMAP Sent.
Disconnect deletes the stored credentials, cache and private drafts/history;
it never deletes server email or CRM records already created from it.

## Server setup and recovery

Apply migrations `0020_private_mailboxes.sql` and `0021_mail_remote_folders.sql` only to the intended environment.
Set `MAILBOX_ENCRYPTION_KEY` as a secret containing 32 cryptographically random
bytes encoded as base64. Keep that key securely backed up separately from D1;
losing/changing it requires mailbox reconnection. `MAILBOX_ALLOWED_HOSTS` optionally
sets an administrator-managed comma-separated hostname allowlist. Arbitrary user
hosts/IPs are forbidden. Never disable certificate checks to fix a provider error.

The local config generator creates a persistent ignored `.dev.vars` encryption
key in the saved review directory, not in tracked config. A bound local fixture
accepts only `one@local-mail.invalid` with `Local-Mailbox-Test-Only-1`; these are
fictional and never delivered. Real addresses never use the fixture. Preview
port 3000 cannot connect; use the full Worker at port 8788.

Recovery schema profile: `mail-folders` (0021), preserving `mailboxes` (0020) and previous profiles. Export
contains ciphertext, not the encryption key. Phase 4/production storage remains
on hold. This work does not enable WhatsApp or alter company outbound adapters.

## Verification

Earlier verification on 19 October 2026: 543 automated checks, TypeScript checking and the rebuilt
OpenNext Worker passed. The connected-mailbox browser scenario passed sign-in,
fetch, privacy isolation, lead-review gating, read flags, explicit send capture,
disconnect and layout checks at 390/768/1440 pixels in light/dark themes. Three
existing email/content browser scenarios also passed. All 32 recovery unit cases
and a real isolated local D1 export/restore rehearsal through migration 0020
passed, including exact table snapshots and retained ciphertext.

The real supplied password was not used. No company mailbox was read or sent
from, and no deployment or remote migration occurred. Provider authentication,
network/certificate behaviour and recipient delivery still need an authorised
real-account test. Existing production dependency advisories for Next.js, sharp
and source-map-js were found by the dependency audit; no imapflow/postal-mime
advisory was reported. This is not a production security sign-off.
