# Local testing: same application, isolated services

`npm run dev` now starts the production-mode local Worker at port 8788, not the
browser-only demo at port 3000. This fixes the misleading situation where a local
demo says a server feature requires the live workspace: the database-backed local
workspace uses those same application routes, sessions and business rules.

## What you can test

| Area | Local behaviour | Remaining limit |
| --- | --- | --- |
| Sign-in, roles, company/branch boundaries | Real sessions and server checks in local D1 | Fictional users; no production data |
| CRM, quotations, approvals, orders, payments | Same business rules and persistence as deployed code | Tax/legal documents and other unimplemented features are not added by changing mode |
| Tasks, automation, Action Center | Real local D1 writes, audit and deduplication | Hosted cron timing must still be verified on deployment |
| Operations | Real purchase approval, stock ledger, supplier invoice/payment paths | Phase 9 scope limits still apply |
| Chat and notifications | Local Durable Objects, sockets, D1 and independent signed-in users | Multi-machine network behaviour needs network/HTTPS setup |
| Voice/video calls | Real local LiveKit server and local webhook | Browser permissions required; remote-device calls need separately configured network/TLS |
| Email drafts, templates and review reminders | Real local D1, ownership and confirmation paths | Local submissions are captures, not real email delivery |
| cPanel IMAP | Per-user connection screen and real TLS adapter; fictional account fixture also available | Actual company mailbox sign-in and provider reachability remain unverified; see MAILBOX-CONNECTIONS.md |
| SMTP | Connected real addresses use real SMTP after explicit send confirmation; fictional accounts capture locally | Provider acceptance is not delivery proof; actual company account not tested |
| WhatsApp/social channels | Outbound draft/capture and clearly labelled conversation simulation | Provider onboarding, incoming replies and delivery webhooks are not complete |
| AI and Apollo | Local provider simulators exercise application integration paths | No real inference, external search accuracy, production quotas or paid credits tested |
| Files/recording storage | Isolated local fixture bindings only | Phase 4/production R2 remains on hold; testing does not activate it |

Some entries are incomplete features, not environment restrictions. They must
remain clearly labelled; removing their warning would not implement them.
External provider account approval, real delivery and real model output cannot
be proven with fake accounts. No production credentials are copied into the
local review environment.

## Saved local workspace

The ignored `.wrangler/local-review-current` file remembers the selected local
state directory. Restarting reuses it and applies only pending local migrations;
it does not reseed/overwrite edited CRM fixtures. `--fresh` explicitly creates
another saved workspace, without deleting an older one. `--resume` selects an
existing supported review directory. A missing/invalid remembered directory
fails safely instead of silently replacing data.

Open two independent browser profiles to test different people. A normal tab
and a private window can represent a caller and a receiver. Grant microphone
and camera access when testing calls. Launching only the Worker without LiveKit
can test CRM but cannot establish media calls; the normal `npm run dev` launcher
starts both services together.

For automated media checks against that running fictional workspace, use
`MAIL_REVIEW_SERVER=1 npx playwright test -c playwright.local-media.config.ts`.
The media checks use generated camera/microphone input, actual LiveKit streams
and the browser's normal content-security policy. They do not prove the quality
of a physical device or an internet connection.

## When connection details are available

Configure cPanel IMAP/SMTP privately and verify actual receiving/sending against
an approved test mailbox and recipient. Keep that separate from ordinary
offline/local review. WhatsApp requires its own approved test account and
template mapping. Do not paste passwords, tokens or verification codes into chat.

## Verification of this launch change

On 19 October 2026, the saved Phase 10 database was reopened through the normal
launcher, including local LiveKit. All 534 automated checks, type checking, the
OpenNext build and ten local media browser scenarios passed. The media suite
kept browser security enabled and checked ringing/decline/hangup, unanswered
expiry, host/guest publication, repeated device toggles, device failure/recovery,
screen sharing, network reconnection and responsive layouts. External providers
and physical devices were not represented as verified by these results.
