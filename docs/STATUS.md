# Implementation status

## Roles, activity log and table polish (23 September)

- **Preview sign-in with demo roles.** The login page now lists six fictional
  accounts (MD, Sales, HR, Accounts, Logistics, IT), password `demo1234`, and
  signs in as that role. This is preview only: the database auth path in
  `/api/auth` is unchanged and still refuses credential login without a
  database. Sign out moved from Settings to the profile page, because Settings
  is reachable only by MD and IT, which left most roles unable to sign out.
- **Role-scoped dashboard.** Order value, demand rankings and the business
  performance chart are shown only to roles that work with that data, so an HR
  or IT sign-in no longer sees the MD's commercial dashboard. The metric grid
  is hidden entirely when a role has no metrics, instead of leaving a gap.
- **Activity log is a table.** It filled a fraction of the panel before. It now
  has Person, What changed, Company and When columns that sort, and each entry
  opens a dialog with the person, area, change, company, record and full
  timestamp. The dashboard widget keeps the compact timeline.
- **Sorting is no longer counted as a filter.** Ordering a column used to make
  the Filters badge claim an active filter and offer Reset. The badge now
  counts filters only.
- **Sort options are per list.** The generic Name A–Z / Z–A choices no longer
  appear where they mean nothing, such as the audit trail. Tables expose no
  sort dropdown at all and say to use the column headings.
- **Created by column** added to the records and cashbook tables, reading the
  existing record owner, and it sorts like any other column.
- **Company filter hidden where it changes nothing**: on profile, appearance,
  shortcuts, access control and self-service, and whenever the signed-in user
  has only one company.
- **Notes and errors read as warnings**, not filled cards: an inline amber or
  red rule and text rather than a bordered panel.

- Verified: TypeScript, 58 unit tests, 73 browser tests and a production build
  pass. Six new browser checks cover role scoping and sign-out, the filter
  badge ignoring sort, the Created by column, the activity table and its
  dialog, and company-filter hiding. Screenshots reviewed for the login page,
  the sales and HR roles, the activity table and dialog, and the warning style.
- Preview fixtures only; no database was contacted.


## List controls and dashboard period (23 September)

- Table columns now sort. Every heading in the records, cashbook and user
  tables is a button that cycles ascending, descending, then back to default
  order, keeping `aria-sort` in step. Only one column is ever marked sorted.
  Card and grid views have no columns, so they keep the sort dropdown; both
  write the same sort spec, so the two controls cannot drift apart.
- Secondary filters moved behind one "Filters" toggle beside the search box,
  with a badge showing how many are active. The panel opens on its own full
  width row, so opening it never reflows the bar above it. Reset appears only
  when something is actually set.
- The from/to date range was removed from every business list. The supporting
  query code was removed with it rather than left as an unreachable path, so
  `ListQuery` is now search, status and sort only.
- The dashboard period control moved out of its card and sits inline beside the
  company filter in the page header. Its scope and validation messages are now
  a plain line above the metrics. Period behaviour itself is unchanged.
- The dashboard insight panels were briefly grouped into tabs and then reverted
  at the user's request; that section is unchanged from the previous revision.

- Verified: TypeScript, 58 unit tests, 67 browser tests and a production build
  pass. New browser coverage asserts that lists offer no date range, that a
  column heading sorts ascending then descending then clears, that exactly one
  column reports itself sorted, that the sort dropdown is absent on tables and
  present on cards, and that the filter toggle is the next stop after search in
  tab order. Screenshots reviewed in light and dark at 1440px and 390px.
- Preview fixtures only; no database was contacted.


## Usability and correctness audit (22 September)

Audited every module page, the shared list controls, the dashboard date scope,
HR salary, the accounts cashbook, navigation and the quotation documents, then
fixed the defects found. No database was contacted; all testing used the
synthetic preview fixtures.

### Filtering, sorting and pagination

- List search matched `JSON.stringify(record)`, so it matched **field names and
  internal identifiers**: searching "status" or "company" returned every row.
  Search now walks stored values only, skipping booleans and bookkeeping keys.
- Amount sorting interleaved currencies as though they were comparable. Each
  currency is now ranked as its own block, and a caption explains this whenever
  a list actually holds more than one currency. Values are never converted.
- The filter row, list and pagination were reordered visually with
  `display:contents` and `order`, so the keyboard order was list → filters →
  pagination. `Pagination` was split into `ListFilters`, `ListEmpty` and
  `Pagination`, rendered in real document order; the CSS reordering is gone.
- The reversed-date warning inherited no `order` and rendered above the filter
  row, detached from its controls. It now sits inside the filter row, and a
  reversed range selects nothing deliberately instead of dropping a bound.
- Filtering a list to nothing left a blank table. A shared empty state now
  explains whether the list is filtered or genuinely empty and offers Reset.
- Duplicate controls removed: business lists carried both a toolbar status
  filter and the shared one; user administration and the cashbook each had a
  second search box. The kanban board keeps its own status control because it
  has no filter row. Document line items remain unfiltered and unpaginated.
- Date filters now name the field they use. The cashbook filters and sorts on
  the transaction date it displays, not the record creation time.
- Pagination resets on a filter, sort or scope change and clamps when results
  shrink, so editing a record no longer throws you back to page one.

### Dashboard date scope

- `toISOString()` was applied to a local date, so every preset was computed on
  the **UTC** day. In any non-UTC timezone "Today" could select yesterday and
  exclude today's records. Ranges now use a DST-safe local calendar.
- Choosing Custom with one or no date silently behaved like All time. The
  incomplete, reversed and empty-result cases are now stated in the period row.
- Metric cards showed a USD-only total beside a count of records in every
  currency. The cards now say "USD value only". Counts remain complete.
- Daily focus remains intentionally current and is still labelled as such.

### Charts

- Segments were capped at four **before** zero-value rows were filtered out, so
  a chart could silently lose a segment. Filtering now happens first, and one
  exported `chartSegments` helper decides this for both the chart and callers.
- The selection panel appeared only once a segment was chosen, shifting the
  layout. It is always present with the same two-line shape; verified that the
  panel and document heights are byte-identical before and after selecting.
- Keyboard focus keeps segment emphasis with no rectangular outline.
- "1 orders" is now "1 order"; the sales-contribution panel no longer repeats
  the donut legend as a ranked list; the country panel no longer prints two
  overlapping "no destination country" messages.

### HR salary

- The derived monthly total was calculated and stored but **never displayed**.
  Employee details now show "Monthly total" beside Basic salary and Allowance,
  derived on read so a stale stored value is never shown.
- The preview path recomputed the total inline with no validation. Preview and
  server now share `salaryAttributes`, so both validate identically.
- Legacy records that predate the split still show their stored total and
  prefill it as basic salary when edited. No payroll or tax logic was added.

### Other fixes

- The unidentified 404 was `/favicon.ico`: no `<link rel="icon">` was emitted,
  so browsers probed the default path. An explicit icon now points at
  `/icon.svg`. A browser test asserts no failed requests and no console errors.
- The shared `Select` read only direct `<option>` children, so options wrapped
  in a fragment were read as `[object Object]`. It now flattens fragments and
  nested arrays and skips empty values, which Radix rejects.
- The internal company key `Istanegry` was shown to users verbatim. The
  presentation-only label map now renders it "Istanergy". **Persisted company
  and access keys are unchanged**, including `Istanegry` itself.
- The page-size control clipped "10 per page" to "10 per pa…".

### Verified

- TypeScript, 58 unit tests (9 new), 66 Playwright browser tests (17 new) and a
  production build all pass.
- Browser coverage added for: document/visual/tab order of list controls, the
  filtered-empty state and Reset, reversed date ranges, single-currency sort
  order, cashbook transaction-date filtering, one status filter per list, the
  kanban exception, page-size labelling, chart selection stability and
  pluralisation, every dashboard preset, incomplete and reversed custom ranges,
  delete-control colour in both themes, salary create/edit/reload, friendly URL
  reload and back/forward, company switching, legacy query-string bookmarks and
  My Requests scope.
- Screenshots reviewed in light and dark at 1440px and 390px; no horizontal
  overflow at either width.

### Remaining limitations

- **No database was used.** Every check ran against browser-local preview
  fixtures. Preview and localStorage state is not production persistence.
- Preview fixtures are entirely USD and contain no cashbook entries, so the
  mixed-currency ordering and its caption are covered by unit tests only.
- The quotation document for `Istanegry` still carries the website
  `www.istanegry.com` in `src/lib/pdf/quotation-data.ts`. Every other reference
  spells it "istanergy", so this looks like the same typo, but it is a
  customer-facing contact detail and was **left unchanged pending confirmation**.
- `next-env.d.ts` differs only because `next build` rewrites its generated
  paths; `next dev` flips it back.
- Everything in "Remaining production scope" below still stands.


## Record-detail dialog correction

- Rebuilt record-detail content with a compact company/type/status row, populated-value grid and a collapsible list of fields not provided. Empty notes blocks no longer consume space. No underlying values are removed.
- Narrowed record dialogs to 820px, aligned status labels/controls without wrapping, preserved fixed header/footer and moved invoice printing into footer actions. Reviewed expanded follow-up/payment forms on mobile.
- Corrected legacy MT display in leave/marketing details to days/leads and the invoice amount label. Reduced unused access-editor grid space and removed Quick actions' nested list scrollbar.
- Verification: 32 browser checks passed covering all 11 non-quotation record types, quotation preview, access editor, quick actions, eight creation dialogs and module/workflow regressions. Final access/quick-actions check rerun after refinements. TypeScript and unit checks passed. No database changes.

## Legal name and compact layout audit

- Added a presentation-only company-name helper: PETRONIK FZCO appears in selectors, record labels, profile branding, notifications, access summaries and quotation sender/signatory text. Existing Petronik company/access keys remain unchanged, including legacy quotations whose sender name is Petronik.
- Creation dialogs now adapt width to field count, with tighter spacing and aligned footer controls. Detail grids use three desktop columns and two mobile columns. Narrow phone forms use full-width fields for readable labels and controls; scrolling remains inside the body with actions available.
- Quotation previews adapt to screen height, start at the top, and use a quieter document background. Print sizing is unaffected by screen-only preview scaling.
- Tightened shared page/card spacing, removed single-category charts and the duplicate lowest-sales chart; exact ranking values remain visible.
- Verification: 41 unit tests, TypeScript and 25 browser checks passed. Coverage includes 15 module pages at desktop/mobile widths, all eight creation dialogs, company filtering, employee/lead submission, quotation acceptance and five company/long-document PDF cases. Visually checked the updated legal-name PDFs and representative dialog screenshots. No database modifications.

## Compact shared dialogs, HR fields and charts

- All dialogs now use the shared header, independently scrolling body, and fixed footer. Record-form and access-editor submit buttons target their forms explicitly; quotation print and record actions live in the shared footer. Mobile employee creation and fixed header/footer positions are covered by browser tests.
- HR departments no longer offer Leadership (Management replaces it). Employee role is a separate profile field with Employee, Manager, Assistant and MD; it does not grant application permissions. Added On-site/Remote, monthly salary and salary currency, stored as existing record attributes without database/schema changes.
- Added accessible SVG donut charts for product/employee sales share and column charts for demand, retaining exact figures and scope/currency filtering. Chart percentages explicitly describe the displayed records, not the entire business.
- Reduced quotation preview scale, typography and item padding. Company website and page number now share the reserved bottom margin on every A4 sheet; the in-flow website band is preview-only. Each company uses its own logo, with consistent sizing and Istanergy whitespace handling. Default signatory is Peiman Hussain; an explicitly entered signatory remains respected.
- Actual Chrome PDF checks passed for all four company logos: short quotations remain one page, and the 45-item fixture now uses three pages instead of four. Rendered pages were visually checked, including footer placement and repeated table headings. Existing records and database were not modified.
- Final verification: TypeScript, 40 unit tests and all 15 browser tests passed, including employee submission, quotation acceptance, desktop/mobile dialogs, dashboard overflow and company PDF layouts.

## Quotation print pagination fix

- Removed the empty viewport-height application shell from quotation printing; it previously consumed a blank first page before the portalled dialog.
- Removed forced commercial/terms page breaks and converted the outer layout table to normal print flow. Actual item tables retain repeated headers and row break protection.
- Removed modal animation, shadow, scroll gutter and constrained dimensions during printing. The website band now follows the signature instead of overlapping document content; page numbers stay in the reserved A4 margin.
- Verified actual PDFs in installed Chrome using isolated synthetic preview data: a one-item quotation is one page; 45 items flow across four pages. All five rendered pages were visually inspected. Added print regression tests; 40 existing unit tests and TypeScript also pass. No database changes.

## Working first version

### Compact dialogs and source quotation template

- Read the user-specified `petronik-crm/src/components/pdf` and its print CSS/config/type dependencies without modifying that project. Adapted the actual DocumentTemplate components and company color defaults into new-crm, with a typed quotation-data adapter and scoped utility styles. Plain-text terms stay escaped; private activity notes, bank records and signature images are not imported. The source serverless Chromium engine is not installed/wired: export still uses browser Print / Save PDF, so server-generated PDF pagination parity is not claimed.
- Shared dialogs now use compact four-column desktop/two-column mobile grids, wider address/name fields, tighter controls and sticky form actions. Quotations use Customer & delivery, Items & pricing, and Sender & terms sections. All fields remain mounted so switching sections retains entered values; validation opens and focuses the first invalid field's section.
- Replaced the separate catalog select with an inline keyboard-accessible product combobox. Matches remain restricted to the existing permitted company/currency/unit catalog. Selection fills price and packaging while retaining quantity; custom text remains supported.
- Removed blanket note-entry forms from master records, quotations, HR and finance. Sales, shipment, order and support updates now have contextual labels and an explicit open action. Previous notes remain in collapsible history; invoice payment recording is preserved.
- Verification: 40 tests and production build passed. Browser checks covered compact desktop sections, inline product search with ArrowDown/Enter and automatic USD 800 pricing, hidden-section validation, actual source-template preview, and mobile sender form without dialog-level horizontal overflow. Actual saved PDFs/multipage footer output remain unverified. No database writes, original-project edits or live permission changes were made.

### Country sales, suppliers and reference quotation (22 September)

- Added per-country product rankings based on explicit destination country, confirmed order value, accessible company records, currency and creation-date filters. Country case/spacing is normalized; missing countries are counted and excluded, never guessed from ports. Existing records were not backfilled.
- Added company-scoped supplier profiles, contact/address/tax details, supplied products, payment terms and lead time. Search, status filters, shared pagination, notes, audit history, quick creation and module restrictions use existing infrastructure. Default access follows leadership roles; no existing user permissions were changed. This is a supplier directory, not purchasing or accounts payable.
- Quotation form and customer-facing print layout follow the supplied QT-0008 reference: sender/customer identity, issue/expiry dates, delivery terms/destination, item packaging, totals, calculated English amount in words and blank client-signature area. No sample customer or signed approval was copied. Saved customers prefill address/country/tax fields; previous accessible quotations in the same entity supply sender defaults. New fields use existing JSON payloads, without migration.
- Fixed preservation of line items and prevented lead enquiry notes from being copied into customer-facing commercial terms. Added shared date/line/total validation. Country, packaging and document details survive quotation acceptance into operational records.
- Verification: 37 unit tests, TypeScript and production build passed. Browser checks confirmed supplier form, quotation document layout and live 500 x USD 570 calculation/amount in words. Browser print CSS is implemented; actual saved PDF pagination has not been verified. No database writes, seed/import, permission changes or deployment performed.
- Broader remaining gaps are recorded below. In particular, revision/edit workflows, structured purchase orders and supplier invoices, inventory costing, tax/accounting integration, HR policy engines and outbound automations are not implemented by this UI revision.

The application has a connected interactive preview plus database-backed API/authentication code. The UI supports executive overview; leads; itemised quotations; orders; shipments; invoice receipt recording; customer/product records; basic HR, marketing and IT records; approvals; audit history; scoped user provisioning; and a separate employee self-service page. Preview records are fictional.

Quotation acceptance creates one order, shipment and draft invoice in a single transaction in the database implementation, with deterministic IDs, an optimistic version check and audit history. Unit tests also cover repeated acceptance, self-approval, cross-company and branch restrictions, restricted assistant access, payment validation and follow-up notes.

Employee self-service exposes only the current user's own leave requests and support tickets through a separate endpoint. Department module access remains unchanged. This is the narrower alternative to a broad HR/IT navigation expansion rejected during automatic approval review.

## Latest functional refinement

- My Requests is now a view within the persistent workspace shell; sidebar navigation updates browser history without replacing the shell. Direct authenticated loading of `/my-requests` remains supported.
- Department forms/details have dedicated profiles: employee, leave, customer, product, ticket, campaign, quotation, shipment, order and invoice. People has a distinct Add employee action. Employee records do not create accounts or widen permissions.
- Whitelisted optional attributes are stored in the existing record JSON payload; no migration was applied. Older records still render with empty optional attributes.
- Phase 2 has started with quotation prefills: active saved customers and matching product catalog prices, restricted to the current company/branch and actor scope. Product prices must match the chosen currency and unit. These are copied values, not live pricing, credit approval, stock reservation or complete master-record linkage.
- Existing database integration and external service limitations remain unchanged.
- Latest checks: production build, type checking and 19 unit tests passed. Browser checks confirmed preserved company selection across self-service navigation, distinct employee/support dialogs, persisted support priority, and quotation customer/product prefills. Updated browser regression specs remain separate from the executed unit suite.

## Remaining production scope

| Area | Still required before full production use |
| --- | --- |
| Administration | Editable legal-entity profiles and departments; custom field-level permissions; granular delegated access; complete password reset/MFA and access review |
| Sales | Full customer timelines and duplicate review, revisioned quotations, product-picker master linkage, discounts, margin/cost checks, tax/Incoterm rules, approval thresholds, saved-PDF multipage validation |
| Purchasing | Supplier directory is implemented; purchase orders, goods receipts, supplier invoices, payment approvals and stock/cost linkage remain |
| Logistics | Dedicated shipment/container/vessel fields, document checklists, proof of delivery, split shipments, stock reservations, carrier integrations |
| Finance | Invoice numbering/legal templates, payment terms, credit limits/holds, ageing reports, cancellation/write-off approvals, FX snapshots, cost/margin ledger and accounting integration |
| HR | Leave policies/balances and holiday calendars, manager delegation, document-expiry tracking, onboarding/offboarding, recruitment and attendance |
| Marketing | Campaign attribution to actual orders, spend integrations and validated ROI calculations |
| IT | Hardware/software/SIM asset register, warranties, assignment history, licence expiry and full permission editing |
| Documents | Authenticated private uploads/downloads, retention and malware-scanning workflow |
| Automation | Durable jobs/outbox, retry policy, scheduled digests, email ingestion/sending, WhatsApp and escalation rules |
| Reporting | Export permissions, CSV/Excel exports, team targets, aggregated multi-currency reporting |
| Mobile | Install manifest is present; offline sync, push notifications, app-store wrappers and physical-device tests remain |
| Operations | Staging MySQL integration tests, hosting capacity/security validation, backup/restore drill, monitoring and deployment |

Do not represent any of these remaining features as completed or silently replace them with fixed demonstration charts. Existing overview values are calculated from visible records; dollar summaries include USD only.

## Verification

- Initial production build and TypeScript check passed; final checks are recorded in the task handoff.
- 13 domain/workflow tests passed.
- Browser observation confirmed rendered dashboard, saved fictional lead, company filtering, quote acceptance and generated sales order. Narrow-screen navigation and layout were also inspected; browser viewport tooling reported a 582 CSS-pixel effective width, so a physical 390-pixel device is not claimed as verified.
- Playwright suite exists but its launch was blocked by an absent bundled Chromium executable. These are not counted as passed automated browser tests.
- No MySQL database was available. Database-backed authentication, migrations and transactional behavior have not yet been integration-tested.
- Dependency audit reported zero known vulnerabilities after pinning the transitive deepmerge-ts override. Re-check when updating dependencies.

No production data, external accounts, company websites or deployed applications were modified.

## Workspace tools and scoped access update

### Supplied branding, profile and pagination

- Removed the redundant Enercore Group / Team workspace sidebar box. Replaced placeholder sidebar/login branding with the supplied Enercore logo and added a personalized dashboard welcome.
- Added the four supplied company logos under `public/brands` without modifying source artwork. Profile company cards and the selected-company control use these assets. Logos sit on light plates for legibility in both themes. Internal legacy company keys are unchanged.
- Enercore uses navy, turquoise and gold accents. Company selection applies Petronik turquoise, Afrilube red/orange, Istanergy red/gold or Petronex teal/gold, including dialog controls through shared root variables.
- Rebuilt profile with identity header, account details, company logos and structured module access summaries. Profile identity remains read-only.
- Shared client-side pagination covers record tables/cards, users, notifications, activity history and personal request history. Options: 10/20/50 items, range/total, previous/next and page count. Filters and changed result sets reset the page; data access is still scoped before pagination. This is not database cursor pagination, and commercial document line items remain unpaginated for printing.
- Validation: 26 unit tests, TypeScript and production build passed. Browser checks verified the welcome, loaded logos, notification page 2 and search reset, Afrilube color selection, and light/dark profile layouts. Profile had no horizontal overflow at 388 CSS pixels. No live records, migrations or user permissions were changed.

### Design revision: company-only workspace

The dedicated Company dashboards page was removed at the user's request. Company selection remains on the main dashboard and module pages; old company-page bookmarks resolve to the overview. All branch inputs, profile/settings branch summaries and record-detail branch fields are removed from the UI. Branch Manager is no longer offered for new role assignments. Legacy branch columns and checks remain internal for compatibility; no records, schema, migrations or access boundaries were changed in this revision.

`studio.css` supplies a new neutral/blue visual system with white navigation in light mode, charcoal navigation in dark mode, compact grouped menus, colored metric accents, structured pipeline columns, shared form controls and mobile layouts. Design references reviewed: official Attio and folk product pages. No new libraries, external assets or integrations were added.

Revision verification: 24 unit tests and the production build (including TypeScript) passed. Browser inspection covered the light/dark dashboard, desktop pipeline, branch-free lead form, mobile navigation and My requests. The dashboard had no page-level horizontal overflow at 388 CSS pixels. Database data was not touched.

- Added visible Profile and Appearance pages, persistent light/dark selection, company dashboard cards and company-specific URLs that retain scope during navigation.
- Added searchable notifications with action/activity filters, company filters, record links and device-local read state. Items are derived from permitted records and audit events; this is not an email or push delivery service.
- Added a keyboard command menu (Cmd/Ctrl+K or /), permitted quick-create actions, scoped record search and a shortcut guide. Existing customer/product prefills and linked quotation workflow remain in place.
- Added dedicated access administration: role, company, branch and module restrictions, review-before-save, server scope checks, self-edit prevention, IT leadership limits, audit entries and target session revocation.
- Prepared migration `202609220002_module_access` for the nullable User.moduleAccess JSON column. It was NOT applied. Apply it through an approved staging/release process before database-backed use of this code. Production authentication and access updates remain unverified against MySQL.
- Profile identity is read-only. Preview account changes and notification read state are browser-local; cross-device preferences, email/WhatsApp automation, scheduled jobs and profile editing remain future work.

### Record editing and delete confirmation

### Accounts cashbook and motion polish

- Added shared search, status/date filters and name/date/amount sorting to paginated business lists, with reset and pagination recalculation. Date filters use record creation date (activity timestamp or due date when no creation timestamp exists); amount sorts do not convert currencies.
- Dashboard has All time, Today, 7/30/90 days, 12 months and custom dates. Metrics and charts use the selected creation-date scope; daily focus stays current. Removed the redundant nested insights period selector.
- Salary form now has Basic salary and Allowance with a derived monthly total validated on server and preview. Legacy monthly salary is prefilled as basic salary when editing. Chart keyboard focus uses segment emphasis instead of the rectangular outline; card hover belongs to the whole card.
- Verified 49 unit tests, TypeScript and 13 browser checks covering salary persistence, record filters/sorts, custom dashboard dates and desktop/mobile layouts. No live database operations.

- Added company-scoped manual Income/Expense entries within Accounts, separate from invoice records and collections. Includes amount/currency, transaction date, category, department, counterparty, payment method and reference. Currency-specific income, expense and net movement totals exclude cancelled entries; this is a manual cashbook, not a general ledger, bank reconciliation or profit report.
- Cashbook entries use Accounts permissions and audited create/edit/status workflows. Cancellation retains history; deletion is blocked. Server validation rejects non-positive amounts, excess decimal precision and invoice links/items/payments. No database schema migration required or executed; database-backed operation has not been tested.
- Charts use distinct blue/amber series and multicolour ranking charts. Shared hover/focus transitions respect reduced-motion preferences. Verified desktop/mobile page and form layouts, cash entry persistence and cancellation; 46 unit tests and TypeScript pass. Tests used fictional preview data only.

- Follow-up UI polish: permission-aware Edit/Delete icons on table rows, collection cards and pipeline cards; grouped dialog footer controls; consistent two-column form fields (single-column mobile); smaller screen-only quotation preview. Added Company colours, Ocean, Forest, Violet, Rose and Slate palettes, independently persisted alongside light/dark mode. Logos and document branding are unchanged.
- Follow-up verification: 26 browser tests, 45 unit tests and TypeScript passed. Visually reviewed lead detail, support-ticket form, quotation preview and dark Appearance. Preview data only; no database changes.

- Writable record detail dialogs now expose Edit record and Delete. Editing uses the shared, prefilled module form with fixed header/footer, saving state and inline errors.
- Edit/delete commands enforce company/module permissions, immutable identity/link fields and stale-record checks. Approved quotations and operational/financial records only permit contact, delivery and notes corrections; commercial values and payment history remain protected.
- Delete requires a named-record confirmation. Eligible records are soft-deleted from the workspace with an audit event; linked and protected commercial records cannot be deleted. There is no user-facing restore action yet.
- Verification: TypeScript, 45 unit tests and 34 browser tests passed, including edit/save, cancel/confirm delete, persistence after reload, protected order editing and desktop/mobile dialog regressions. Browser tests used fictional preview data only. Database-backed execution remains unverified; no database writes, migrations, deployment or push were performed.

### Dashboard insights and navigation polish

- Breadcrumbs now navigate within the workspace. Company logo plates have consistent dimensions with optical sizing for transparent padding. Quick Actions has a compact header, inline search, categorized navigation and a two-column creation grid that stacks on mobile.
- Dashboard insights show best/lowest-selling products, open-enquiry demand, sales contribution by order owner, highest/lowest orders, win rate, lost opportunities and cancelled orders. Filters use one currency and an optional creation-date window; company/module/record permissions still apply.
- Sales means confirmed, in-progress or completed order value, not profit or collected revenue. Product lines use quantity and price; older orders fall back to product and amount. Lowest-selling ranks products with recorded sales. Demand is not inventory need. Missing product information is disclosed and excluded from named-product rankings. Owner contribution is not an employee performance rating.
- Verification: production build and all 31 tests passed; browser checks verified breadcrumb navigation, Quick Actions, desktop insights and a 388 CSS-pixel mobile layout without horizontal overflow. No browser errors were captured. No database writes, migrations, deployment or push performed.
- Removed decorative footer/company-strip content. New screens use shared controls, spacing, themes and responsive layouts.
- Verification: 23 unit tests, TypeScript, production build and diff whitespace checks passed. Browser checks covered company selection, profile, light/dark switching, notifications, permission editor and keyboard command selection. Profile and notifications had no horizontal overflow at an effective 388 CSS-pixel viewport. No browser console errors were captured in the final check. No live access changes or migrations were executed.
