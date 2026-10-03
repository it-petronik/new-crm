# Enercore interface system

The workspace uses shared React controls rather than independently styled native controls on each screen. `src/components/ui/controls.tsx` provides Button, Input, Textarea, Field, Select, DatePicker, Dialog and Tooltip. Radix primitives handle dropdown/modal focus, keyboard navigation and portals; React DayPicker supplies the calendar.

`src/app/design.css` owns typography, spacing, color, radius, shadow and motion tokens, shared component styles, and responsive layouts. Avoid page-specific resets and global table selectors: these can affect embedded calendars. The Inter variable font is bundled locally.

`src/components/sidebar.tsx` provides the expandable desktop navigation, icon-rail tooltips, collapsible groups and accessible mobile drawer. The user's desktop collapse preference is stored locally. Company and role access rules are unchanged.

Department collections share card/list presentation. Tables and pipeline boards scroll inside their panels on narrow screens. Forms use one consistent label/control/validation treatment, with custom dropdowns, calendar pickers and password visibility controls. Reduced-motion preferences disable decorative transitions.

Verification: production build and 13 existing tests passed. Browser checks covered company filtering, calendar selection, saving a fictional lead with selected company/date, desktop collapse/expand, mobile drawer, department cards, and accounts/settings layouts. At measured 388px and 582px CSS viewport widths, the checked department page had no horizontal page overflow. Browser regression specifications were updated for the custom controls; they are separate from the unit-test suite.

This is an interface update, not completion of production integrations. Database, email and external-service readiness remains described in STATUS.md and DEPLOYMENT.md.

## Dialog and theme refinement

`refinements.css` adds wide desktop dialogs (1040px, increasing to 1160px on large screens), three-column forms and four-column detail summaries. Long content and small screens retain accessible scrolling. `DialogPresence` retains closing content long enough for the Radix exit animation to finish; reduced-motion preferences remain respected.

The header's light/dark toggle saves a local preference, initially following the operating-system theme. An early theme initializer avoids a light flash during navigation. The palette covers form controls, calendars, tables, cards, dialogs, login and self-service. My Requests now renders inside the persistent `Workspace` shell with the same Sidebar, content width, preview banner, header, metrics and footer. Client-side history navigation preserves workspace filters and supports Back/Forward; direct authenticated entry at `/my-requests` uses the same shell. Navigation back to a department respects the actor's allowed modules.

Department form and detail content is defined in `record-profiles.ts` and rendered by `RecordForm`. Shared dialog styling does not imply shared business fields. IT/HR/customer screens deliberately omit sales value/quantity fields. `sales-prefill.ts` restricts saved customer and product suggestions before copying details into a quotation draft.

## Design hardening pass (presentation only)

A design, responsive and visual pass over the Priority 1 screens. No schema, migration, permission, scope, workflow, calculation, provider, AI, meeting-media or R2 change: every figure shown comes from the same server view or the same `quotationData()` / `calculateScenario()` output as before, and every action calls the same endpoint with the same body.

### What changed

| Area | Before | After |
| --- | --- | --- |
| Buttons | The base `.ui-button` is unstyled, so bare `<Button>`s in the Deal Room, Prospecting and Apollo dialogs (Prepare RFQ, Add candidate, Create scenario, Record response, Mark reviewed, Run search…) rendered as plain text. `.compact` had no styles, so "compact" buttons were full 42px primaries' height. | Every action has a variant. `.compact` is the small control height; a new quiet `.ghost` variant takes second and third actions (commercial.css). |
| Deal Room | ~20 stacked bordered cards in an 820px dialog; the lead summary repeated inside the Deal Room; two "Log activity" and two quotation buttons; status changes as rows of 4–5 equal buttons; an inert one-option status select per candidate; 7,761px tall at 390px. | 1,180px dialog on desktop. One Customer/Contact summary, a one-line sourcing progress strip (candidates, RFQs sent, offers, scenarios, quotation), then compact rows for candidates and RFQs with one main action and a "More" menu for the rest. Offers are aligned comparison cards per currency/unit/Incoterm group, side by side; previous revisions collapse. Scenarios read BUY → additional costs → landed total → landed/unit → SELL → margin, with "Negative margin" in words and manual FX shown inline. 5,989px at 390px. |
| Customer / Supplier / Product 360 | A bordered "360" card inside the record dialog; email/phone/city repeated under the field grid; two Meetings sections; "Open Deal Room · e419fee7"; linked records labelled with raw kinds ("leads"). | Sections in priority order per record type, separated by space and hairlines. Contacts are rows with Primary / Selected tags and quiet Edit / Make primary. Capabilities ("can potentially supply — not an offer") and Offers received stay visibly separate. Deal links use the Lead's title; linked records show their noun, status badge and value; related meetings only appear when there are any. |
| Record header | "Opportunity · 4024eeb3-12a8-…" | Noun only; the full reference moves to the quiet created/updated line (still selectable). Quantities use thousands separators. |
| Record footer on phones | Three stacked rows (Delete + status, Close + Edit, primary) taking ~210px of an 800px screen. | Delete and status share a row; the redundant Close hides beside two other actions (the header X remains); nothing clips at 320px. |
| Quotation on phones | Only a 0.45× A4 preview. | A readable summary (customer, products, total, validity, Incoterm, reference) above the preview, from the same data as the document; hidden in print. |
| Action Center | A card per item, a filled primary button on every item, empty groups as full cards above the work, a card around one AI button. | Items are rows; the main action is secondary and Tomorrow / Dismiss are quiet; "Normal" severity no longer shows a badge; "2 details missing: Contact, Country" on one line; groups with work come first at full width and empty groups shrink to one line each. |
| Prospecting | Section tabs and Companies / People as filled primaries beside the primary Search button. | Both are segmented controls, so Search Apollo is the one primary action; Save search and secondary card actions are quiet. |
| App shell | Filled "Quick add" and a "Prospecting" button in the top bar squeezed the breadcrumb ("Workspa… › Overvi…" at 1440px). | Prospecting is a sidebar item (same `canProspect` gate). Quick add is outlined on desktop and icon-only at 721–1100px (label kept for screen readers); it stays the floating button on phones. |
| Dashboard | Pipeline health's five fixed columns overflowed its panel at 1440px; four full-width KPI cards on phones. | Flexible columns plus a container query that drops the least important column when the panel is narrow; KPIs stay 2 × 2 on phones. |
| Dark theme | Success / warning / danger / info were light-theme values in both themes, so badges and the negative margin were dark text on dark surfaces. | Dark-theme values for the four semantic tones; tints derive from them. |

Also: the Phase 6/7 one-line rules at the end of `globals.css` are replaced by a readable, token-based `commercial.css`; sourcing statuses (Candidate, Sent externally, Received, Selected…) join the single status-tone map; `MoreActions` is extracted from `RowActions` so every overflow menu is the same component.

### How it was checked

Local, fictional data only: the preview (`APP_MODE=preview`) for the dashboard, lists and quotations, and an isolated built Worker on a throwaway local D1 with the fake AI and fake Apollo bindings (no real Apollo call or credit, no R2) for the Deal Room, 360 views, Prospecting and the Action Center. Screenshots were inspected at 320, 390, 768, 1024 and 1440px, light and dark; an automated sweep at 26 widths from 320 to 1920px checked page overflow, dialog overflow, clipped buttons and console errors on eight screens.

Results: typecheck clean; 426/426 unit tests; 147/147 preview browser tests; against the local Worker, `commercial.spec` (all widths), `apollo-workspace.spec` (all widths), `proactive-ui.spec`, `ui-polish.spec` and six `phase7.spec` tests including the keyboard RFQ / offer / scenario editor flow. One assertion changed: `commercial.spec` now checks only footer buttons that are rendered, because the phone footer deliberately omits the duplicate Close. Not caused by this pass and left as found: `phase7.spec`'s "…fit Npx with zero passive AI" waits for an "Apollo credit review" dialog that no longer exists since the search-first Prospecting change, and `responsive-a11y.spec`'s voice-message check needs R2, which a no-R2 runtime (like live) does not offer.

Not in this pass: meeting media layouts and Collaboration (already on their own recent passes), AI answer formatting, list-page stat cards, and moving the RFQ / offer / scenario editors out of a dialog stacked on the record dialog.

## Structural redesign (pass 2, frontend only)

The composition changed; the business did not. Every screen still reads the same server views and calls the same endpoints with the same bodies. No schema, migration, permission, scope, Apollo, commercial-calculation, AI, meeting-media or R2 change. BUY prices, costs and margins still render only where the server's view says `canSeeCosts`; the Commercial tab is hidden, not just emptied, when it does not.

### Building blocks

- `src/components/ui/layout.tsx`: `PageHeader`, `Section`, `Tabs` (ARIA tabs with arrow/Home/End keys), `Metric`, `EmptyState` and `useMediaQuery`. Use these rather than new bordered cards.
- `Dialog` takes `variant="drawer"` (a right-hand sheet, full screen on phones) and a `description`. Editors that belong to a record open as drawers. Dialogs are single-level: none opens on top of a record dialog any more.
- `src/app/shell.css` is the last stylesheet imported and owns the app shell, page headers, record pages, drawers, list pages, dashboard, Deal Room tables and print rules for record pages. Tokens: `--shell-sidebar`, `--shell-topbar`, `--shell-gutter`, `--page-max`, `--rw-context`.

### What changed

| Area | Before | After |
| --- | --- | --- |
| Records | A wide modal on top of the list, with nested dialogs for RFQs, offers and scenarios. | A page (`src/components/record/record-workspace.tsx`). It has a `?record=` URL, and Back (header button, browser Back, or Escape when nothing is open over it) returns to the list with its scroll position and focus. The position is tracked while the list is showing, because by the time a record renders the browser has already clamped it to the shorter record page. The list stays mounted underneath, so filters and pagination survive. Header: back link, noun, title, status, company/owner/value, then Log activity, Print, Edit, one primary and a More menu (Assign, Pin, Delete). On phones the secondary actions fold into More. |
| Deal Room | One long scroll (5,989px at 390px after pass 1). | `commercial-workspace.tsx`: a summary (Customer, Contact, Requirement, Next action, sourcing progress) and then tabs: Overview, Sourcing, Commercial and Activity. Overview leads with the authoritative financial summary of the selected or reviewed scenario. Sourcing covers candidates, RFQs with key terms (quantity, Incoterm, destination, follow-up) and an offer comparison table per currency/unit/Incoterm group. Commercial covers the selected offer and scenarios, ordered Selected › Reviewed › Draft. Saving a scenario switches to Commercial. The Overview is 2,578px at 390px, and its first screen shows customer, stage, owner, requirement, next action and sourcing/quotation status. |
| Customer / Supplier / Product | Sections stacked in the record dialog. | The same workspace with tabs per kind. Customer: Overview (next action, primary contact, open leads, latest quotations/orders, AI brief), Contacts, Commercial, Activity. "Review relationships" and "Find prospects" sit beside the tabs, or at the top of the Overview on phones. Supplier: key figures, latest offer, Capabilities, Sourcing, Offers. Product: demand, capable suppliers, offers. |
| RFQ / offer / scenario editors | A dialog over the record dialog. | A drawer with grouped fieldsets (Key terms; Price; Quantity; Terms and validity; Additional costs; Manual FX; Customer SELL price), a `role=status` preview and Calculate preview / Save in the footer. Field names and payloads unchanged. |
| Financial summary | Figures spread across a card. | `FinancialSummary`: Supplier BUY → Landed → Customer SELL → Margin (or "Negative margin" in words), with FX on one line and the cost breakdown on request. Only figures the server already calculates are shown. Per-unit additional cost and per-unit margin were deliberately not derived. |
| Lists | Mini stat cards and a toolbar above every list; card view by default. | Page header, one list panel, and filters with the Card/List switch in the same row. Tables are the default everywhere except the lead board, and the two layouts share one search and filter state (reset when the module changes). The Value column appears only for kinds that carry a value. At ≤720px, Deal Room tables become labelled cards. |
| App shell | Search field, theme, notifications and shortcuts spread between the top bar and sidebar. | Sidebar groups: Commercial, Work, Operations, Organization, Manage (same permission checks), with My requests and profile at the bottom. The top bar holds a breadcrumb, one "Search or jump to…" trigger for the command menu (⌘K), clock, Quick add, theme, notifications and profile. |
| Dashboard | KPI cards, attention, charts and rankings in one long page. | KPI strip; a main column (needs attention, what changed) beside a side column (operations, pipeline health, shipments). The business analysis (charts, rankings, performance) is collapsed, remembers its state per browser (`enercore-dashboard-analysis`), and renders only when opened. The date-scope caption sits in the header, beside the time range. |
| Action Center | Rows of text and buttons. | Aligned What / Why / When / Action columns. Severity is a badge only when raised. |
| Enercore AI answer | Sections in one column. | Summary first, then Key facts, Gaps and risks and Next actions side by side, then the draft, with sources and fine print in a quiet footer. |
| Prospecting | Tabs in the page body; card results. | Tabs in the page header, and results as dense rows (actions at the right from 1280px). Credits and saved searches are secondary. |
| Quotation | Document preview only. | A readable summary on every width. The A4 document is shown on desktop and one tap away on phones. Print still outputs only the document. |
| Collaboration / meetings | Boxed inside the page padding. | Full-bleed chat, and slimmer meeting bars with 46px icon-only controls on phones. No LiveKit or media change. |

### Print

`design.css` hides `.main-shell` in print, which suited records that printed from a portaled dialog. A record page lives inside `.main-shell`, so `shell.css` shows it again while a record is open and hides the sidebar, top bar, record controls and the page underneath. A quotation still prints only its document, at the top of page one.

### Record tables

Columns are sized by class (`e-col-record`, `e-col-status`, `e-col-owner`, `e-col-next`, `e-col-value`, `e-col-actions`), not by position, because the Value column is absent for kinds without a value. From 721 to 1100px, a table whose rows have their own status control drops the Status badge column (the control already shows the status) and trims Next action, Value and Actions, so the record's name keeps its room. The Deal Room's offer and offer-history tables turn into cards by their own width (`@container (max-width: 820px)`), not the viewport's, because beside the sidebar a tablet column is narrower than the table needs.

### Other behaviour worth knowing

- A reloaded or linked record (`?record=`) opens in a layout effect, before the loaded list is first painted, so the list never flashes up and disappears again.
- Opening a meeting no longer closes the record underneath. The meeting layer covers it, and leaving the meeting reveals it on the same tab. Escape belongs to the meeting while one is open.
- The dashboard's loading skeleton mirrors `.dash-grid` (main: attention, what changed; side: operations, pipeline), so nothing moves when data lands.
- Tab strips that overflow on narrow phones fade at the edge that has more (`useOverflowFade`); from 390px the Deal Room's four tabs fit.
- Action Center rows keep the main action, Tomorrow and Dismiss on one line on desktop.
- First paint uses this browser's choices. `src/app/boot-script.ts` runs as a plain inline script in `<head>`, not `next/script`, whose `beforeInteractive` code waits for Next's JavaScript. It sets the theme and palette, and shows each saved profile picture on `[data-avatar-id]` avatars until React renders it. The theme button's icon follows `html[data-theme]` in CSS.
- The loading screen shows the Enercore logo (`/brands/enercore-loader.png`, a 47 KB copy of the 664 KB original). The Istanergy and Petronex logo files are trimmed to their artwork, so every company logo draws at the same size, and quotation headers need no special case.

### How it was checked

Local, fictional data only: the preview (`APP_MODE=preview`) and an isolated built Worker on a throwaway local D1 with the fake AI and fake Apollo bindings and a local LiveKit. There was no real Apollo call or credit, no R2 and nothing remote.

- Typecheck clean; 426/426 unit tests; production Worker build (`npm run cf:build`) succeeds.
- Preview browser suite: 147/147. Three tests flaked under load or on a cold dev server and passed on repeat runs.
- Worker suite: every UI-relevant file passes on fresh state (commercial, ai-ui, ai-sales-ui, notifications, proactive, proactive-ui, apollo-workspace, ui-polish, meetings-v31, and phase7 except as below). Media tests (meeting-chat, meeting-link, meeting-media, meetings-v31 guest) match a build of `HEAD` exactly: the same six pass and `meetings.spec`'s room-meeting test fails on both, because "Send message" matches the hub composer and the meeting chat.
- Failures not caused by this pass: R2-dependent attachment and voice tests (R2 is off, as in live); `phase7.spec`'s per-width test, which waits for the "Apollo credit review" dialog removed in 0f82e7c; login rate limits (429) and fake-Apollo enrichment limits when many files share one local database; relative-date expectations when seed data is a day old; `ai.spec`'s AiUsage check, which assumes only its own features are in that table.
- Sweeps: 26 widths from 320 to 1920px × 13 screens in light and dark (676 checks; the one real finding, Sourcing-tab overflow at 768–1024px, is fixed), plus continuous resize from 320 to 1920px and back, short heights (600px and 560px), keyboard and focus, long content, empty and many-record lists, and print.

## Simplification pass (frontend only)

The software carries the complexity; the employee should not have to. No schema, API, permission, calculation or workflow-state change. Every payload is the same as before.

- **Forms show everyday fields first.** A field spec can be `advanced` (see `more()` in `record-profiles.ts`), and `RecordForm` puts those under a "More details (optional)" disclosure. The fields stay in the form, so their values are always saved. The section opens by itself when an edited record already uses those fields, or when validation finds an error inside it. Quotations (sectioned editor), HR and locked order corrections are unchanged.
  - Lead: customer, contact, product needed, quantity, unit, destination, next follow-up. Value, currency, source, email, phone and country are under More details.
  - Customer and supplier: name, country, main contact, email, phone. Address, tax, codes, segment and terms are under More details.
  - Product: grade, unit, packaging.
- **Plain names.** Lead, Customer, Supplier and Product (not "Opportunity", "Customer profile", "Supplier profile", "Product specification"). "Company name", "Next follow-up", and "Pricing" instead of "Commercial scenario". "Find contact details" instead of "Enrich".
- **Never ask twice.** A customer's primary action is "New lead", which opens the lead form with the customer linked and the name, contact, email, phone and destination filled in. Zero numbers are not carried over. A new pricing is named after the offer.
- **Pricing.** It shows Freight and Insurance plus any costs already used; the rest are behind "Add a cost". Costs that aren't shown are still sent as zero in the pricing currency, as before. Exchange rates appear only for currencies actually in use ("Convert AED to USD"). The sell side is labelled "Our selling price to the customer". Saving switches to the Pricing tab.
- **Deal Room "Next step".** One line, derived from existing state: find suppliers, prepare an RFQ, record an offer, compare offers, select pricing, prepare the quotation. Its button opens the right tab or editor; nothing is saved until the person saves it. It never picks a supplier, price or pricing.
- **Empty lists** name what is missing and offer the add action ("No customers yet. + Add customer"), with the same permission check as the page header.
- **Type floor.** Metadata is at least 12px, and buttons and inputs at least 13px, at every width. Only avatar initials and the ⌘K hint are smaller.

## One business intent (simplification pass 2)

- **Customer or supplier with a main contact is one write.** `POST /api/records` passes a new customer or supplier with a main contact to `newRecordContact` (commercial store). It writes the record, the Contact and the primary-contact link in one D1 batch, in the same order as `quickCustomer`, because the database checks the link. The contact id is derived from the request id, so a retry or double click returns the same customer and never adds a second contact. The route also returns field-level errors (`fields`) in plain words, and the form shows each beside its field.
- **Duplicates while typing.** `GET /api/commercial?view=duplicates` is debounced (450 ms) and reuses `duplicates()`. It only reads records the person may already read, in the target company and branch, and returns at most 5. Matching is deterministic: same name, same name without its legal form (`companyCore`: LLC, Ltd, FZE…), same email, same phone, same business email domain. A strong match (same name or same email) needs "Use existing" or an explicit "different company" confirmation before creating.
- **Active-lead notice.** It is shown when the same customer (and product, once entered) already has an open lead. It uses records the person already sees, and only informs.
- **Earlier errors.** Each field is checked when you leave it (email, phone, numbers, dates, options) with the same words as on submit. Errors under More details open it and take focus.
- **After creating**, a customer, supplier, product or lead opens its own page.

## Leads in context, Apollo review, unsaved changes (simplification pass 3)

- **New lead from where you are.**
  - A customer's page: "New lead" is the primary action.
  - Each active contact on the customer's Contacts tab: "New lead with …".
  - A product's page: "New lead" is the primary action.

  The form shows "Started from …" and arrives with the customer, contact or product already set. The server still checks every link through `resolveLinks`: customer access, the contact belongs to that customer and is active, and the product is in the same scope. It takes the contact's name, email and phone from the stored contact rather than from the browser. Plain-language link errors now reach the form; "not found" and "not permitted" read the same.
- **Active-lead notice.** It matches the same customer and product, by id when both leads have one. A lead with another contact is shown as related, not as a duplicate. Each lead shows its stage, owner and follow-up, with "Open existing" or "Create another lead".
- **Apollo "Add to Enercore".**
  - Single prospect: Ready to add, Already in Enercore, or Needs review, with plain reasons and Use existing / Create separate. An optional "Also create a lead" sets up the Deal with the lead, as the server already does by default. Apollo details are in a secondary section, and only the fields that differ are offered.
  - Bulk: a summary, only the items that need review laid out, the effect before confirming, and "Added / Already existed / Skipped / Failed" afterwards.
  - The import operation (`importProspect`, `bulkImport`) and the matching are unchanged. The state rules are in `src/lib/prospecting/review-state.ts`.
- **Unsaved changes** (`useUnsavedChanges`, in the record form, contact editor and RFQ/offer/pricing drawer). Only the person's own input counts. An untouched form closes quietly. Closing an edited one asks "Discard changes?" (Keep editing / Discard), and leaving the page warns only while edits exist.
