# Enercore interface system

## Direction

The Studio redesign replaces the previous flat sidebar and dashboard layout.
It is a structural redesign, not another color preset:

- One grouped, permission-filtered sidebar exposes all available screens without
  a second area rail. It collapses to icons or becomes a drawer on phones.
- The executive dashboard uses a four-card metric row, an asymmetric sales and
  priorities composition, recent records, and a workspace activity feed.
- Record lists have status views, a compact filter bar, aligned data columns,
  icon actions, and a distinct card layout on phones.
- Record details have a compact identity header, an action row, task sections,
  and a dedicated context column. Long names no longer compete with actions.
- Email separates folders, messages, and reading on desktop, then uses one pane
  at a time on phones. Private/sandbox behavior is unchanged.
- My requests is history-first. New requests open the same shared form dialog.

One interface, not four competing skins. Fintora / Craftora and Kentra / Tenso
inform the modular dashboard composition; Attio informs readable record lists;
Linear informs the quiet navigation, predictable actions, and restrained chrome.
Supplied company artwork, financial meaning, and authorization remain unchanged.

References approved by the user:

- https://dribbble.com/shots/26355937-Fintora-Smart-CRM-Dashboard-UI
- https://www.behance.net/gallery/241217533/Kentra-CRM-SaaS-Dashboard-UXUI-Design
- https://attio.com/
- https://linear.app/now/behind-the-latest-design-refresh

## Ownership (change the owner, not a later override)

| Concern | Owner |
| --- | --- |
| Light/dark neutrals, company accents, selected palettes | `src/app/foundation.css` |
| Semantic colors, typography, spacing, radius, motion | `src/app/foundation.css` |
| Legacy variable aliases (`--ink`, `--teal`, `--f-*`, `--l-*`) | `src/app/foundation.css` |
| PageHeader, Surface, Toolbar, FormGrid | `src/components/ui/layout.tsx` and its CSS Module |
| Appearance settings and live component preview | `src/components/appearance-settings.tsx` and its CSS Module |
| Buttons, fields, inputs, selects, date controls, footer actions | `src/components/ui/controls.tsx`, `src/app/form-system.css` |
| Single grouped sidebar and mobile navigation drawer | `src/components/sidebar.tsx`, `studio/navigation.module.css` |
| Application frame, top bar, page composition | `src/components/studio/frame.module.css` |
| Executive dashboard, metrics, sales chart and priorities | `src/components/studio/dashboard.tsx` and its CSS Module |
| Business tables, status views and mobile record cards | `src/components/studio/records.module.css`, `RecordTable` in `workspace.tsx` |
| Record detail layout and commercial overview sections | `src/components/studio/detail.module.css` |
| Action Center queue and responsive task rows | `src/components/studio/action-center.module.css` |
| Prospecting search, examples and first-use instructions | `src/components/studio/prospecting.module.css` |
| Expanded dashboard analysis | `src/components/studio/analysis.module.css` |
| Company-shared field choices | `src/components/ui/shared-select.tsx` and its CSS Module |
| Email folders, message list and reader composition | `src/components/studio/communication.module.css` |
| Dialog viewport, heading, body and footer | `src/components/ui/controls.tsx`, `src/app/dialog-shell.css` |
| Domain-specific internals | The feature's own stylesheet, scoped to its root |
| Print / PDF | Quotation and reference-document styles, intentionally independent of app themes |

Older stylesheets still contain domain-specific implementations and compatibility
rules. This does not claim that every legacy selector has been removed.
The new shell deliberately does not use `.sidebar`, `.topbar`, or `.main-shell`;
the new business table does not use `.e-record-table`. Do not reintroduce those
legacy geometry classes into the Studio components.
Prospecting search uses module-owned classes instead of `.apollo-search-hero`
and `.apollo-query-form`; the old sticky search rules otherwise override its
padding. The frame must not redefine record header geometry. Nested dialogs
derive their overlay order from React context so a choice editor dims the
form behind it and returns focus when closed.
Global palette definitions and shared button roles have been removed from the
competing legacy files. Do not add a new “polish” sheet to fix an owned component.

## Compose a page

```tsx
<PageHeader title="Customers" description="People and companies you sell to."
  actions={<Button variant="primary" onClick={create}>Add customer</Button>} />
<Surface padding="none">
  <Toolbar aria-label="Customer filters">{/* search and filters */}</Toolbar>
  {/* accessible table, empty state, pagination */}
</Surface>
```

- Start with the user's task and one primary action, not an ornamental banner.
- Page guides are optional, compact, and keyboard accessible.
- `Surface` owns the boundary. Its `padding` is `normal`, `compact`, or `none`.
- `Toolbar` wraps naturally. It is not an ARIA toolbar: standard Tab navigation
  is preserved. Use an explicit search/group label where appropriate.
- `FormGrid` fits available width; it must not create undersized fields on phones.
- Button variants: `primary`, `secondary`, `ghost`, `danger`. Sizes: `normal`,
  `small`, `icon`. Give icon-only controls an accessible name.
- Existing `className="primary"` / `secondary` consumers are supported during
  migration. Navigation and whole-card buttons intentionally remain unstyled.
- DialogActions places contextual actions at the start and Cancel/Save together
  at the end. Do not create another competing action row inside the body.

## Visual rules

- Use semantic `--e-*` tokens; never hardcode a theme color inside a component.
- Accent follows company or selected palette. Status colors retain their meaning:
  delete/error is red, success is green, warning is amber. Chart series have their
  own coordinated, dark-aware palette; they should not all become one accent.
- Spacing follows 4/8/12/16/20/24/32. Desktop controls are 36px; phone controls
  are at least 44px and form text is 16px to avoid mobile input zoom.
- Numeric columns align right and use tabular numbers. Long names wrap or
  truncate with accessible full text. Actions remain reachable without page overflow.
- A card has one hover boundary; nested controls do not lift independently.
- Use subtle color/border transitions. Respect reduced motion. Do not animate
  every datum or use decorative charts for values that are clearer as text.
- Preserve empty/loading/error/disabled/read-only states and permission gates.
- Local test outbox is not sent email; calendar plans are not published posts.
- Dashboard totals are calculated from the permitted records and selected period.
  Money is filtered by currency, never combined across currencies. Priorities use
  current records independently of the reporting period. No invented growth rates.
- Never add a new navigation entry without applying the existing role, company,
  and preview/live gates. Showing a navigation group never grants screen access.

## Verification and extension

`npm test` includes source-level ownership checks. `npm run typecheck` and
`npm run cf:build` check the application and production CSS ordering.

Run the signed-in local browser matrix (never against production):

```sh
MAIL_REVIEW_SERVER=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npx playwright test -c playwright.layout.config.ts
```

The matrix covers routes at desktop/tablet/phone widths, populated records,
creation dialogs, light/dark themes, all accent palettes, and shared component
geometry. Inspect screenshots as well as assertions; passing an overflow check
alone does not establish good design. Add coverage when introducing a new page
type. Do not bypass tests by removing focus indicators, clipping the page, or
shrinking touch targets.

`studio-redesign.spec.ts` additionally checks grouped navigation, collapse/expand,
chart navigation, status views, mobile email navigation, and request dialogs.

## V2 inner pages and shared choices

The top bar includes **Ask AI** on desktop and an accessible icon on phones.
The obsolete second business-performance chart was removed; the Studio chart
owns company performance and handles an empty dataset without empty axes.

`SharedSelect` applies to business vocabulary: lead source, units, customer
segments, packaging, departments, work arrangements, ticket categories,
campaign channels and cash-entry categories/payment methods. Workflow statuses,
roles, company access, currencies, priority and Incoterms stay protected. Filter
menus and selections of existing people/records are not vocabulary catalogs.
Do not make authorization or workflow enums arbitrarily editable.

- `/api/shared-options` stores choices by company and catalog in D1.
- Authorized colleagues can select them; the creator or a company-authorized
  workspace manager can edit/delete. Every request checks access and origin.
- Names are capitalized, whitespace-normalized and deduplicated case-insensitively.
- Optimistic versions prevent silent overwrites. Built-in choices remain fixed.
- Renaming/deleting a choice affects future selections, not saved record values.
- Browser-only preview choices stay local and are explicitly labeled unshared.
- `drizzle/0016_shared_options.sql` is additive. It has been applied only to the
  isolated local review database, not any remote database.

## Populated local review

`npm run dev:review` creates isolated local D1/R2 state, seeds fictional records,
contacts, calendar posts, finance entries, own requests, chats, a scheduled
meeting, and captured email. `scripts/design-test-seed.ts` refuses to run without
`LOCAL_DESIGN_FIXTURE=1` and only prints SQL; the review runner applies it with
`--local`. Stable fixture IDs avoid duplication and preserve review edits.
Use `--resume .wrangler/manual-review.NAME` to keep working in a saved review.

The all-company fictional MD is `studio@collab.test`, with local-only password
`Collab-Test-Password-1`. The review runs at `http://localhost:8788/login`.
No real email is delivered; AI/Apollo responses are local test fixtures.
Do not apply these fixtures to production.

`playwright.v2.config.ts` checks populated inner pages at 1440/768/390 pixels,
theme screenshots, top-bar AI access, choice add/rename/save and company/role
isolation. It also allows the existing `meeting-media.spec.ts` tests to run
against the review server. Voice/video use the existing LiveKit pre-join flow;
no camera or microphone starts merely by opening a conversation. A local
two-party test verified media publications/subscriptions and video frames with
synthetic devices. Production connectivity and real-device quality are separate
deployment checks, not established by local tests.

## Compact interactions

- Dashboard priorities have a keyboard-focusable, internally scrolling region:
  380px maximum on desktop and 300px on phones. The neighboring focus card
  sizes independently; counts do not stretch either card to the whole list.
- `collaboration.css` owns incoming/own message bubbles, grouped messages,
  mobile in-flow actions and the bounded transcript. Mobile shows one
  conversation at a time with a persistent composer, not a scaled desktop grid.
- Instant direct conversations use `direct-call-stage.tsx` and its CSS module.
  Voice calls center the person's identity; video uses the peer's stage with
  a small self-preview. Microphone, camera, devices and end-call remain visible.
  Scheduled, group and standalone meetings keep the meeting workspace.
  Both layouts use the same authorized LiveKit transport and media lifecycle.
- Direct-call controls use separate circular surfaces and labels, with 64px
  desktop / 56px phone targets. Phones place Mute, Camera and End call above
  Record and Devices; landscape uses a single compact dock. Destructive End
  call stays red in every theme and closes the provider room server-side,
  including any active recording.
- Call recording uses the existing private recording API, never a silent
  browser capture. Starting requires a joined peer and an explicit consent
  acknowledgement. Provider metadata/recording events show a persistent notice
  to both people. Missing service/storage setup and failed requests are shown
  honestly; files are not called saved while they are processing.
- Dialog portals use `--dialog-layer-base` for their stacking context. Active
  calls raise it to 220, above the call surface, while nested dialogs retain
  their own layer. Call recording confirmations are bounded to 480px.
- `AiResultHeading` and `ai.css` unify assistant, record, conversation, meeting
  intelligence and email-intake results. Summaries, evidence and reviewable
  actions are distinct. Long results scroll internally and remain keyboard
  reachable. Suggested changes still require explicit review/confirmation.
- Compact phone spacing does not shrink input text below the existing mobile
  input size or remove action labels. Call controls retain large touch targets.

`playwright.compact.config.ts` exercises priorities, message alignment, AI
results and two-party direct-call media at desktop and 360/390px widths. The
test-only worker allows its loopback LiveKit endpoint in CSP, so these checks
do not bypass browser security. The production CSP is unchanged.
`call-recording.spec.ts` also checks consent, failure/retry, notices on both
clients, private access and missing setup. Recording responses are simulated
only in that browser test; metadata travels through the real local provider.
It does not establish actual egress/file capture, which needs configured
recording service plus private storage. Layout coverage includes 320px phones,
dark mode and short landscape screens.

## Interaction and consistency fixes — October 4

- The single sidebar keeps all authorized groups in one scrollable list with
  pinned personal shortcuts. Collapsing retains icon access; phones use a drawer.
- Ended, cancelled and missed invitations have an expired pre-join state with
  no Join action or device preview. Live meeting events update an open pre-join
  screen. The server remains authoritative and rejects terminal joins with 410.
- Conversation transcripts merge recent terminal calls with messages by saved
  timestamps. Duration comes from persisted start/end times. Unanswered direct
  calls show "No answer" and "Attempt duration", not a claimed talk duration.
  The existing conversation endpoint returns the ten most recent past meetings;
  this is recent history, not unlimited call-history pagination.
- Mention options keep circular avatars fixed-size and put names above roles.
  Chat filters wrap instead of hiding Unread/Mentions. Room details use compact
  facts and member rows. The image viewer has its own opaque, high-contrast
  surface; single-image thumbnails preserve the full image in a bounded box.
- Status-update failures never emit a success/follow-up prompt. Successful lead
  changes alone can suggest a follow-up; leave approval authorization is unchanged.
  Requests use distinct semantic badges and kind-specific units (days, not MT).
- Active and hovered tab counts inherit readable foregrounds. Quick-add tabs
  divide the actual available choices evenly. Sticky record tabs have an opaque
  themed background, and pipeline menus sit beside the owner avatar.
- Charts support hover/focus previews and pinned keyboard selection without
  growing their cards. Entrance animations respect reduced motion. Theme/palette
  changes temporarily disable color transitions for one atomic visual update.

`playwright.polish.config.ts` covers expired notification links, persisted recent
call history, mentions/media/details, failed self-approval, dynamic tabs, compact
cards, theme changes and interactive charts at desktop and 320/390px widths.
Use it with the same local review environment as the layout matrix. These checks
and fixtures do not deploy changes or modify production data.

Local verification for this pass: 465 unit tests, type checking, and the OpenNext
build passed. Eleven browser scenarios passed across the polish (3), layout and
navigation (5), and compact/call (3) suites, including a retry of one check after
repeated test logins reached the local demo account's rate limit. The layout
matrix visits 23 routes at 1440/768/390px; targeted controls also cover 320px.
Desktop and phone screenshots were inspected, not only overflow assertions.

## Call theme and sound follow-up — October 4

- Direct-call device pickers use the workspace palette for the whole control,
  not a light select inside a dark wrapper. Loading and terminal call states
  follow the selected light/dark theme; call controls do not cross-fade through
  light backgrounds when the theme changes. Group video stages remain dark.
- Incoming direct calls use an original two-note ringtone. Outgoing callers
  hear a separate ringback while connected and waiting for the other person.
  A single Web Audio output channel owns the loop, without opening any input
  device or downloading a third-party sound. Silence controls affect ringing,
  not the microphone or conversation audio.
- Normal trusted workspace interaction primes audio. If browser policy suspends
  it, the incoming card offers Enable sound (and the outgoing screen offers
  Enable ringing sound). Unlock handlers run after button actions to avoid
  replacing Enable with Silence in the middle of the same pointer gesture.
  Browser/OS mute and background restrictions still apply; this is not a
  background push-call service for closed browser tabs.
- Answering stops the incoming tone; peer connection stops ringback. Decline,
  hangup, cancellation before joining, expiration and unmount release sound.
  Ringing has a 45-second maximum with both audio-clock and wall-clock cutoffs.
  This ring timeout alone does not terminate the still-joinable waiting room.
  Decline/cancel use the existing permission-checked end endpoint; a failed
  request shows an error instead of pretending everyone was disconnected.

`tests/call-audio.test.ts` covers signal samples, autoplay suspension, teardown,
replacement, unavailable output and expiry. `call-feedback.spec.ts` checks the
enable/silence actions, failed decline retry, pre-join cancellation, unanswered
hangup and expiry. The blocked-audio state is simulated because headless Chrome
may allow autoplay without a gesture; tone generation and its output graph are
real. The compact call test additionally verifies actual local two-party media,
incoming/outgoing audio nodes and their teardown, plus theme/device screenshots
at desktop and 320–390px. No production accounts or live calls are used.

Final local verification: 470 unit tests, five browser scenarios, type checking
and the OpenNext build passed. Light/dark desktop and phone captures were
visually inspected. Recording capture remains subject to the setup limitation
documented above; nothing was deployed.

## Shared motion and controls — October 4

- `foundation.css` owns the motion durations. `interaction-system.css` applies
  short entrance, hover, press and focus feedback to pages, controls, tables,
  popovers and charts. Navigation owns its width/drawer transitions. Never use
  `transition: all` or transform the page container: that breaks sticky/fixed
  positioning. Mobile breakpoint changes do not animate the desktop margin.
- Reduced motion follows the device preference. Theme/palette changes remain
  atomic and bypass color transitions, avoiding cross-fades through light UI.
  Chart entrances run once when they enter the viewport; keyboard selection and
  hover previews retain the same layout height.
- All shared `Input type="time"` consumers use `TimePicker`: themed, bounded
  hour/minute/period columns, keyboard navigation, draft/commit separation,
  optional clearing, required and interval validation. Existing forms continue
  receiving HH:mm, with no timezone conversion. Both scheduled meetings and
  content planning use this component. Do not add new native time popups.
- Guide uses the shared dismissible popover: outside click, Escape and a close
  button work, with focus restored to the trigger. Tooltips use the same surface,
  border, typography and motion vocabulary, including dark mode.
- The AI page uses the full available content width. Workspace settings expose
  scoped companies, account access, actual browser theme preferences and factual
  setup guidance. Connection configuration is not presented as a health check.
- Action Center metrics use a responsive grid. Long task groups have bounded,
  keyboard-focusable scroll areas, with layout/paint containment to prevent
  offscreen row content from extending the document. Mobile actions wrap into
  compact rows. Empty groups do not reserve an unused fourth column.
- Shared legacy form, calendar, text and badge colors now resolve through
  semantic tokens. Approved document/brand colors, identity colors and palette
  preview swatches remain intentional exceptions. New component styles must
  use tokens; the foundation tests guard the new time/settings/action surfaces.

Verification uses `playwright.motion.config.ts` alongside the layout and polish
suites. It covers outside-click/keyboard Guide dismissal, HH:mm preservation,
five-minute meeting constraints, light/dark time controls at 320–1440px,
workspace preferences, AI width, tooltip appearance, bounded task scrolling,
theme colors and reduced-motion behavior. No production data or deployment is
part of this work.

Local verification for this follow-up: 477 unit tests, type checking and the
OpenNext build passed. Nineteen browser scenarios passed: motion/controls (4),
layout/foundation/navigation (12) and workflow polish (3). The layout matrix
covers 23 routes at 1440/768/390px; the meeting time control also covers 320px.
Light/dark and phone screenshots were visually reviewed. The refreshed preview
remains local; nothing was committed, pushed or deployed.
