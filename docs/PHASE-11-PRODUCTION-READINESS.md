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

### Brand and team usability follow-up — 19 October 2026

Released to `https://crm.enercore.ae` as Worker version
`7ef55d3c-b4d4-4175-97f9-b9d4c465b643`. This is a source/asset-only release;
no migrations, real-mail sync, account changes or provider activation were run.
Read-only live smoke passed at 390/1440 px, with eight anonymous API denials,
both test endpoints absent and all three new SVG assets/install manifest served
successfully. Authenticated live team acceptance remains a separate handover
step. The original saved local workspace was restored after fictional testing.

- Reused the approved Enercore Prism vector assets from the existing Brand
  Studio source in `Generate 10 premium company logos`: full-colour mark,
  full-colour lockup and white lockup. Login, password reset, loaders, favicon
  and install manifest now use those assets. No other company's logo changed.
- Navigation stores only per-user sidebar scroll position in tab storage and
  reveals the active item on route changes or reload. Profile/appearance/help
  utilities also expose their active state. Page motion does not remount forms
  or navigation and respects reduced-motion settings.
- Credits & usage refreshes the provider account counter on entry, every 65
  seconds while visible, and after focus/reconnect. It does not run searches
  or enrichment. Server caching and authorization remain unchanged. A failed
  balance refresh retains the last checked balance with a helpful message.
- Forms using the shared validation hook stay neutral until submit; Quick Add
  resets errors when changing record type. Record creation and auth no longer
  show required-field errors merely on blur. Server validation is unchanged.
  Incorrect sign-in details are distinguished from an expired session.
- Follow-up dates have a controlled, accessible selected state including No
  follow-up. Shared button/avatar sizing, disclosures, dashboard width and
  auth layouts were refined. The grey quotation print background is confined
  to the intended bands; unused page area is white.
- Enercore AI now has a centred conversation layout, chronological tab-only
  history, a new-conversation action and collapsible guidance/copilot panels.
  The on-demand companion shortcut reuses existing permission-checked CRM
  question tools. It is not an unrestricted general-purpose chatbot, has no
  automatic actions, and makes no model call until explicitly asked.
- Local evidence: 566 unit tests, 392 responsive route/width/theme checks,
  eight usability scenarios, five AI browser scenarios, and ten fictional
  print/validation scenarios. Four company PDFs and a multi-page quotation
  passed pagination checks; the rendered Petronik proof was visually reviewed.
  Ten operations/outbound/task/access workflows are recorded in the final
  release check. No production records, mailbox credentials, schemas or
  Phase 4/provider activation settings are changed by this follow-up.

### Responsive and shared UX follow-up — 19 October 2026

Deployed to the existing live domain as Worker version
`c70005db-030c-440e-b959-906121dcc8da`. No migrations or secret changes were
part of this follow-up.
Read-only live smoke passed at 390/1440 px with no browser errors or document
overflow; eight private APIs still deny anonymous access and both test endpoints
return 404. Authenticated live team acceptance remains separate.

- Profile identity and actions now wrap independently, including inside narrow
  content panels. The workspace header truncates its title instead of widening
  the document on small screens.
- Shared padded skeletons replace remaining primary loading text in Action
  Center, Access control, Operations, outbound, notifications, task details,
  automation history and meeting intelligence. Assignee selection has a field
  skeleton. Existing dashboard, record-list, mail and collaboration placeholders
  remain in place. Dropdown options use consistent padding and theme surfaces.
- Shared request handling translates HTML/parser/network failures into helpful
  messages, preserves field validation and offers retry or sign-in recovery.
  Access control distinguishes a failed account request from a genuinely empty
  account list. Reads can retry once; writes are never automatically replayed.
- Verification: 566 unit tests; three browser UX scenarios covering keyboard
  selection, held loading requests, HTML failures and successful retry; ten
  operations/outbound/task/permission workflow regressions. Responsive audit:
  28 routes at 320, 390, 768, 1024, 1280, 1440 and 1920 CSS pixels in light/dark
  themes (392 combinations), no document overflow or captured browser errors.
  These are fictional local checks, not authenticated live team acceptance.
- This follow-up does not change roles, database schemas, mailbox storage,
  provider activation or the Phase 4 hold. The exact upstream source of the
  screenshot's HTML response is not established; friendly failure handling is
  verified, not a claim that an unavailable upstream can never recur.

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

### Customer proforma and role-home follow-up — local candidate, 19 October 2026

- Confirmed scope: customer proformas prepared by Accounts; incoming supplier
  invoices remain separate. No supplier invoice creation screen was added.
- Accounts Manager/Accountant can directly create a draft or start from a
  readable customer-linked sales order. Company, branch and module overrides
  remain enforced on the server. Management may view but cannot prepare/issue
  these proformas. Existing quotation acceptance and supplier-bill flows stay
  unchanged.
- Proformas use the quotation document engine with explicit trade/bank fields.
  No customer terms, bank details, stamp or signature from the supplied PDF are
  copied into source/defaults. References are unique identifiers, not a promise
  of sequential numbering. A proforma is not a tax invoice, receivable or payment.
- Drafts can be edited; issuing records the responsible accountant. Issued or
  cancelled documents cannot be reopened or edited. Cancel and prepare a new
  document for revisions. Issuing does not email the customer. No automated
  conversion to a payment invoice is introduced by this follow-up.
- Logo navigation preserves the session. Login uses a wider uncarded form;
  role-specific desks prioritise permitted modules. Dark login and proforma
  entry use shared theme colours. AI chat layout/cards are explicitly deferred
  to the next task per the user's latest instruction; do not include them here.
- Verification: 575 unit checks; nine local browser scenarios, plus an isolated
  local D1/Worker API check covering roles, company scope, simultaneous retry,
  server totals, issue audit, edit locks and payment rejection. PDF visually
  checked as a single clean page without workspace chrome. No production
  migration, provider activation, live record writes or deployment performed.
- Reproduce browser checks with `playwright.proforma.config.ts`; the API review
  script requires the separately seeded fictional Worker on port 8789, not the
  user's saved local workspace. Local review artifacts are Git-ignored.

### Complete document and dark-mode review — local candidate, 19 October 2026

Reference-section coverage is explicit and editable, not a copy of another
customer's deal into defaults:

- Issuer logo, legal name, address, phone, email and website; document date,
  reference and customer reference/ID; customer address and attention/contact.
- Delivery terms/destination/period; validity derived in days from the actual
  dates; payment terms; partial shipment; origin and port of loading.
- Serial number, separate item/category and grade/description, packaging,
  quantity/unit, unit price/currency, line total, subtotal, total and words.
- Bank name, branch, account holder/currency/number, IBAN and SWIFT.
- All 15 free-text terms clauses, including long clauses and their final text;
  signatory name/title and a blank signing area; thank-you/footer contacts and
  page numbers. Optional signature/stamp choices are reserved in the draft.
  Actual image uploads remain unavailable while protected storage is held;
  no signed stamp was extracted, reused or claimed as stored.

The shared paper design uses a quieter letterhead, strong table hierarchy,
high-contrast totals and non-overlapping footer boxes: contacts centered and
page counts on the right. Long documents paginate without truncation. The paper
preview deliberately stays white in dark mode; original sender HTML emails and
unaltered brand artwork retain their own colours too.

Preview mode now gates the entire workspace until its saved demo actor is
known; the server's MD fallback is never mounted as the interim shell. Live
actors still come only from the authenticated server session. Non-executive
record loading uses the actual role's home skeleton, not the executive layout.

Verified locally: 579 unit checks; 28 workspace pages at 390/1440 pixels in dark
mode (56 surface/overflow checks, no captured browser errors); all 16 live-mode
fictional role refreshes; nine preview/form/navigation checks; ten existing
quotation/form regressions; two complete-document scenarios covering every
section and 15 clauses. The loaded dark email view uses fictional local mail.
Both complete-document PDFs were rendered and visually reviewed, including
footer page counts and unbroken numeric totals. No deployment or production
database writes were performed. AI chat layout redesign remains deferred.

### Catalogs, guided entry and compact dashboards — local candidate, 19 October 2026

- Added the dedicated Option Catalogs page in navigation. It reuses existing
  company/module-scoped shared options, creator/manager edit rights and optimistic
  versions. Built-ins remain protected; editing/deleting a custom choice does not
  rewrite historical records. Labels are capitalized without rewriting enum values.
- Expanded editable business vocabulary to document units, packaging, delivery
  periods, origin countries, loading ports, partial-shipment descriptions and
  payment terms. Roles, company access, workflow states and currencies stay fixed.
- Proforma entry is a wider, responsive three-step form with a three-column desktop
  grid. Values survive step changes. The company Branch selector is removed; stored
  branch scope still applies. Bank branch remains a separate banking field.
- Accounts can create a customer inside proforma entry. This is a narrow, audited,
  idempotent create-only permission: no new general customer edit/delete rights.
  Company/branch scope and explicit read-only/disabled overrides remain enforced.
  Corrected dynamic dropdown empty-change events and premature wizard submission.
- Tightened the shared A4 design to a single paper margin. Both complete 15-clause
  test documents fit one page, including proforma bank/signatory details. Longer
  item lists still paginate naturally; content is not clipped or forcibly scaled.
- Compacted role desks/KPIs; added a keyboard-explorable line chart of authorized
  record creation counts by GST month, with source-record links and reduced-motion
  support. Counts are not revenue or a forecast and never combine currencies.
- AI answer instructions and example questions now reflect the authenticated role.
  HR, marketing and support status counts use the same permission-checked data path;
  they cannot access sales/finance tools solely because AI is enabled. Chat layout
  redesign remains deferred; no model/provider calls were used for these checks.
- Local verification: 583 unit tests, TypeScript, role/form/catalog browser checks
  at 390/768/1440 in light/dark, full-document one-page assertions, and the existing
  45-item pagination/form regressions. Test PDFs and screenshots remain Git-ignored.
  No migration, production data changes, external provider activation or deployment.

### Corporate forms and document previews — local candidate, 19 October 2026

- Supersedes the standalone activity chart above: that chart is removed. Small
  depth-styled sparklines now live inside the existing KPI cards, retaining their
  values, labels, icons, supporting text and navigation. Trends are authorized
  record-creation counts, not revenue or a forecast; reduced motion is respected.
- Shared corporate navy, calmer dialog chrome, consistent field heights, aligned
  line-item columns and wide uncarded proforma entry. Phone KPI cards use a real
  two-column layout instead of squeezing four cards into the viewport.
- A4 preview has Fit To Width / Actual Size controls and a white paper surface in
  either theme. Direct printing from the open preview now retains the document.
  Explicit print margin boxes suppress Chrome's date/title headers while keeping
  centered document contacts and the right-aligned page number. Other browsers
  retain a clear instruction to turn off their own Headers and footers setting.
- Authorized signatory name and title are main quotation fields and editable in
  the proforma wizard. Removed the hardcoded Peiman Hussain fallback: only an
  explicitly saved name prints; existing saved document names are not rewritten.
- Local verification: 584 unit tests, TypeScript, ten quotation/form regressions,
  four catalog/wizard/KPI/preview scenarios at 390/768/1440 in both themes, and two
  complete-document scenarios. Both 15-clause documents fit one page and were
  visually reviewed; a separate Chrome run enables native print headers to check
  their suppression. OpenNext production-format build passed and emitted
  `.open-next/worker.js`; the full diff passes whitespace checks. Review files
  contain fictional data and remain Git-ignored.
  No live deployment, production data changes, provider calls or file uploads.

### Document contact links and bottom footer — local candidate, 20 October 2026

- The screen preview now fills the A4 paper with a flex column; spare space sits
  above the contact footer, not underneath it. The footer remains in normal flow
  for longer content. Print keeps the existing reserved page-margin footer and
  right-aligned page count; no fixed overlay is added over terms or signatures.
- Desktop Fit To Width can enlarge the paper to 125% for readability. Actual
  Size remains available; phone and tablet previews still fit without overflow.
- Document phone/email/website details are readable, accessible contact links.
  Unsafe schemes and malformed destinations remain plain text. Business values
  and existing workspace addresses are unchanged; no external links were opened.
- Verified 586 unit checks, TypeScript, six light/dark responsive preview cases,
  the complete quotation/proforma PDFs and ten print/form regressions. Both full
  15-clause PDFs remain one page, visually reviewed with bottom footer text and
  page counts intact. Local only; no deployment or production-data changes.

### Reference-only sales-document fields — local candidate, 20 October 2026

- The supplied proforma's field set supersedes the earlier request for named
  signatories: quotation/proforma PDFs now show Authorized Signatory plus an
  unnamed signing/stamp area only. No printed signatory company/name/title/date,
  client-representative fields or generated-electronically sentence. Other
  generic document types retain their existing signature layout.
- Retain the reference's buyer To/address/attention block, issuer/address, date,
  PI number, customer ID, delivery terms/period, validity, payment terms, item #,
  description, packaging, quantity/unit, price, totals/words, origin, loading port,
  partial shipment, bank fields, terms and footer contacts. Do not copy this
  customer's commercial terms, bank values, signature or stamp into defaults.
- Proforma validity is entered in days and converted to the existing expiry date;
  the printed duplicate expiry and delivery-to labels are removed. Destination
  and delivery period remain visible within delivery terms. Bank branch has its
  own label; currency remains with the account number. All custom clauses remain.
- Removed extra tax/contact/signatory entry controls from these document forms.
  Existing saved metadata is preserved during unrelated edits, not migrated or
  deleted. Customer contact data remains in the CRM; only the reference's fields
  print. The optional future approved-image choice remains reserved while
  protected file storage is held. Draft/cancelled status notices remain explicit.
- Local verification: 588 unit tests, TypeScript, four responsive form/catalog
  scenarios, two complete-document PDF scenarios, ten print/form regressions and
  nine role/proforma scenarios. Both complete documents remain one page; rendered
  PDFs were visually reviewed against the reference's field set. OpenNext build
  passed and emitted `.open-next/worker.js`; whitespace checks passed. Nothing live
  was changed; no source stamp/signature was reused or uploaded.

### Attached thank-you and colored footer — local candidate, 20 October 2026

- The thank-you message belongs to the same footer group as the contact band,
  directly above it. Screen preview pins the whole group to the A4 bottom edge.
- The contact band uses a restrained company-colored background with readable
  matching text. Print reproduces the white thank-you row and tinted contact row
  inside reserved 22mm page-margin boxes, with page numbers on the right. No fixed
  body overlay is used; body content cannot run beneath the footer or create a
  separate footer-only page. Long documents repeat the footer on each page.
- Business fields, stored records and signature/stamp handling are unchanged.
  Local preview/PDF checks cover one-page 15-clause samples, multi-page line items
  and light/dark previews at phone/tablet/desktop sizes. No live changes.
- Final checks: 589 unit tests, TypeScript, 13 browser scenarios and OpenNext
  production-format build passed. Text-position checks confirm exactly one
  thank-you/contact footer and the correct page count on every page of the
  one-page samples and three-page 45-item quotation; rendered PDFs were reviewed.

### Continuous footer background — local candidate, 20 October 2026

- Fixed the visible hairline joins between the three print margin boxes. One
  full-width center box now paints the strip once; a transparent raised counter
  overlaps its right edge. Thank-you placement and reserved margin are unchanged.
- Added Poppler raster checks for an uninterrupted band and visible counter ink,
  not only extractable PDF text. The old exported preview fails this new check;
  regenerated quotation/proforma and every page of the 45-item quotation pass.
  No document fields, saved records or live services were changed.
- Verified 589 unit tests, TypeScript and 12 browser scenarios, including the
  complete one-page PDFs and all four company themes. PDF page counts and one
  thank-you/counter per page are also checked independently.
  OpenNext production-format build and full-diff whitespace checks passed.

### Consistent footer, quantity units and saved bank accounts — local candidate, 20 October 2026

- Petronik quotations and proformas share the approved footer telephone
  `+971 (4) 2669953`, email `info@petronik.ae` and `www.petronik.ae`, regardless of
  legacy per-record overrides. Other companies retain their own verified website;
  unknown telephone/email values are not invented or copied across companies.
  Hidden legacy attributes remain stored. Thank-you remains directly above the
  single continuous contact band. The page counter now has 3mm inner right padding
  (2.81mm measured ink inset), without splitting the band into margin-box seams.
- Quantity-unit selection drives both the `QTY MT` / `QTY kg` heading and each
  row. Common MT/kg casing is normalized for print; quantities and prices are
  never silently converted or relabeled independently of the chosen unit.
- Proforma Bank & Signing step now supports manual entry, saved-account selection,
  Save As New Account, Update Selected Account and reload. Saved templates are
  company- and currency-specific and copied into a document snapshot; later bank
  edits cannot rewrite existing draft or issued documents. Existing finance,
  company and explicit read-only restrictions are checked on the server.
- New additive migration `0022_saved_bank_accounts.sql` is required before live
  use. It has been applied **only** to the isolated fictional review database
  `.wrangler/proforma-review.ykckwl/state`, not the user's saved workspace or
  production. Live bank templates use D1, not browser storage. Fictional preview
  templates are clearly labeled and stored separately per preview actor/company.
  Mutations use origin checks, strict bounded input, optimistic concurrency and an
  atomic audit batch. General Activity excludes bank events, whose audit payloads
  contain version numbers only, never account identifiers.
- Verification: 594 unit tests, TypeScript, 17 browser scenarios (including
  phone/tablet/desktop light/dark bank forms, saved-account reload/edit isolation,
  kg selection, one-page complete PDFs, all company print themes and a three-page
  quotation). Rendered quotation/proforma PDFs reviewed; both remain one page
  with the same contact footer. Production-format OpenNext build passed.
  Authenticated isolated-Worker checks passed for anonymous/role/company/read-only
  denial, invalid origins, required fields, idempotent retries and concurrent edits.
  No deployment, remote migration, real bank-data seed or file-storage change.

### Corporate document refinement and optical footer alignment — local candidate, 20 October 2026

- Replaced the two-line gradient margin-box footer with independently centered
  rows: one solid 7mm contact band, a thank-you row immediately above it, and a
  transparent page-counter overlay. A 0.25mm optical baseline correction balances
  visible glyphs, including company contacts without descenders. Right inset is
  retained. Screen paper now uses the same 9mm side/4mm bottom footer insets as
  print, with genuine inner padding rather than text touching the band edge.
- Refined the existing brand-led corporate design: clearer title/reference
  hierarchy, proportionate logo, restrained metadata panel, aligned line items,
  navy total with a company accent rule, quieter bank details and section labels.
  No new business fields, terms, contacts, monetary values or signature assets.
- Pixel checks now require visible text to have at least 1.2mm inner vertical
  clearance and less than 0.8mm top/bottom imbalance, on every printed page for
  all four company themes. The one-page complete quotation and proforma retain
  all 15 clauses and the blank authorized-signing area; long quotations paginate.
- Verified 594 unit tests, TypeScript, 13 print/form/responsive-preview scenarios,
  rendered PDF inspection and OpenNext production-format build. Two development
  preview startup timeouts passed on rerun; no document assertions were relaxed.
  Review-only sample PDFs are saved in Git-ignored `output/pdf/`.
  No deployment, production change or bank-account migration in this refinement.

### Approved Petronik signature and stamp — local candidate, 20 October 2026

- User explicitly approved reuse of the extracted signature and company stamp
  from the supplied Petronik sample. Connected Petronik quotations and customer
  proformas now apply that version automatically, preserving native PNG bytes,
  original transparency, overlap, proportions and paint order. The reference
  signing area still has no printed personal name or client-signature fields.
  Document totals, terms and approval/issue status are not changed by rendering.
- Artwork is **not** in `public/`, public JavaScript or a demo account's browser
  storage. Private immutable `ApprovedDocumentSeal` versions are served through
  `/api/document-seals` only after session authentication and company, branch,
  module, record-kind and record-read checks. Both PNG hashes must match the
  approved master. Responses are private/no-store; missing/unapproved assets fail
  closed. Fictional public preview never retrieves the actual company signature.
- Printing waits for image decoding and blocks with a clear message if the
  approved seal fails to load, rather than silently printing an unsigned copy.
  Generic attachment uploads/R2 remain held; this dedicated permanent-master
  integration does not enable public file storage or alter other companies.
- Additive migration `0023_approved_document_seals.sql` and the private master
  installation are verified **only** in isolated `.wrangler/proforma-review.ykckwl`.
  `scripts/prepare-document-seal.ts` creates the Git-ignored, mode-0600 installation
  SQL from verified local master PNGs; it does not connect to any database. Never
  commit that SQL or master bytes. Production activation requires the migration,
  explicitly authorized private-master installation and application deployment.
- Verified 600 unit tests, TypeScript, production-format OpenNext build, two
  stamped one-page full-clause PDFs, two original complete-document regressions
  and the accountant create/print/issue regression. Authenticated isolated-Worker
  tests confirm original hashes, role/company denials, unchanged document state,
  both real preview/print paths and blocked printing when asset loading fails.
  All 158 public build assets were checked: approved master bytes are absent.
  No production deployment, remote database write or current-workspace migration.

### Per-company document watermark — local candidate, 20 October 2026

- Quotations and customer proformas use the issuing company's existing logo as
  a centered, decorative 4%-opacity watermark. Petronik now uses only its original
  flame, clipped from the existing lockup and enlarged to 110mm wide (roughly
  three times its previous visible width); its header lockup remains unchanged.
  No artwork is redrawn, stretched or replaced. Afrilube, Petronex and
  Istanegry retain their own artwork; missing branding never falls back to a
  different company. Other document types remain unchanged.
- Proforma date metadata explicitly reads `Invoice Date`, not the ambiguous
  `Date`. Printed amounts in words use title case (including hyphenated words)
  while preserving currency abbreviations. Dates and monetary values do not
  change; both one-page full-clause signature previews cover these labels.
- Preview artwork is outside document flow; fixed print artwork repeats on
  every page without changing pagination, header, footer or signature geometry.
  Printing waits for both header and watermark images and reports a friendly
  error on asset failure rather than silently dropping branding.
- Verified 602 unit tests, TypeScript, ten four-brand single/multi-page browser
  PDF checks and two approved-seal/full-15-clause one-page regressions. Pixel
  comparisons confirm every sheet contains the watermark with at most 12/255
  color-channel change; footer continuity and optical padding remain verified.
  Fictional review samples are in Git-ignored `output/pdf/`. No deployment or
  database changes were made for this refinement.

### Centralized Lead Desk — local candidate, 20 October 2026

- Local preview: `/workspace/all-companies/sales-pipeline`. The existing pipeline
  board/list remains available alongside Lead Desk. Quick add captures a name,
  buyer inquiry/prospect or supplier prospect/offer type, source and optional
  phone without requiring unknown commercial details or showing errors early.
- Sales queues: New for me, Follow up today, Waiting for customer, Needs feedback
  and All leads. Each lead has one accountable owner, acknowledgement, short
  outcome and next follow-up. Not Relevant requires a reason visible to Marketing.
  Acknowledgement and unanswered calls never count as customer contact.
- Allocation uses existing Assign controls, restricted to active, writable sales
  or management users within company/branch scope. Marketing may capture, route
  and review feedback, but cannot claim a salesperson's contact. Existing
  server-side record, role, owner and company checks remain authoritative.
- Buyer demand is separate from prospect and sourcing lists. Cohort reports show
  inquiries, qualified inquiries, sent quotations and unique confirmed-order
  conversions; Won alone is not proof of an order. Response timing uses known
  receipt and first staff-reported contact timestamps; missing receipt time is
  Unknown, never zero. Imported prospects and legacy unclassified rows are not
  silently promoted to actual demand. Campaign lead targets are labelled targets.
- Lead Desk cursor-loads the entire permitted lead/quotation/order scope rather
  than treating the ordinary 1,000-record workspace window as a group total.
  Automatic refresh runs every minute while visible and on window focus. Failed
  refreshes retain and label the previous successful snapshot; incomplete reports
  cannot be exported. Weekly CSV covers brand, product/grade and owner summaries.
- New tracked inquiries require product, grade, quantity/unit, destination,
  customer/contact details and responsible owner before qualification or later
  lead stages. Existing quotation approvals and order/accounting handoffs remain.
  Draft quotations remain editable; this change does not send them automatically.

#### Daily operation and suggested training

Marketing captures the source and brand, distinguishes prospect from real inquiry,
and reviews returned-lead reasons. Sales management assigns one responsible sales
owner and reviews unallocated/overdue exceptions. Sales acknowledges assignments,
records the real contact outcome and schedules the next action. Each person checks
New for me and Follow up today at the start of the day, then clears missing feedback
before finishing. Management reviews the weekly export; the approved response-time
target and review meeting time still need management confirmation.

The in-app Team guide proposes training for Liera, Aleena, Mak and Max: capture
(Day 1, 30 minutes), handoff/feedback (Day 2, 20), qualification/quotation (Day 3,
30), reporting (Day 4, 20), supervised practice (Day 5, 20). These are proposed
sessions, not booked meetings or proof of training. Individual roles, company
coverage and calendar dates must be confirmed before changing real permissions.

Training/process references checked 20 October 2026:
[HubSpot Academy Lead Management](https://academy.hubspot.com/courses/lead-management?previewmode=true)
and [Salesforce assignment-rule guidance](https://help.salesforce.com/s/articleView?id=sf.customize_leadrules.htm&language=en_US&type=5).
These support qualification, consistent follow-up and clear routing; the commodity
fields above reflect this team's stated workflow, not an invented industry mandate.

Verification: 618 unit tests, TypeScript, four Lead Desk preview browser scenarios
(including quick capture and dark mobile), and OpenNext production-format build
passed. Authenticated acceptance against isolated fictional D1/Worker verified
three cursor pages containing all 1,005 assigned test leads, anonymous/HR and
cross-company/owner denials, writable-sales-only allocation, marketing/read-only
feedback denial, wrong-origin and stale-update rejection, server timestamp
protection, and browser-save feedback visible to Marketing. The test-port browser
proxy supplied the isolated Worker's configured origin; real application origin
checks were not weakened. The isolated test Worker was stopped afterward; the
existing saved review database/Worker and source preview were preserved. No
signed-in production acceptance or live deployment is implied by these results.

Website intake code records trusted receipt time, but each brand's connection
still requires configuration and acceptance. Email, WhatsApp, social and advertising
remain manual sources until separately approved and tested. Saving feedback sends
no external message. This work does not connect accounts, spend credits, deploy,
seed production or change staff access. Four configured companies are supported;
the fifth brand is not invented. IT must separately verify company-owned website,
domain, email and advertising account access, MFA, recovery and offboarding;
passwords and recovery codes must never be stored in CRM notes.

### Sales assignment, simpler staff view and Enercore brand — local update, 20 October 2026

- Supersedes the earlier broad management lead visibility: only MD, MD Assistant
  and IT Administrator have all-leads visibility, still bounded by their allowed
  brands, branches and modules. Other users see only leads they created or own.
  MD Assistant remains read-only. Creator identity is trusted server metadata,
  not a client-entered field; missing legacy authorship never grants visibility.
  The same predicate applies to Lead Desk paging, ordinary records, commercial
  related-record queries and AI record reads, before any final per-record check.
- Sales Manager and Sales Executive are the only assignment targets for leads.
  Inactive, read-only and out-of-scope users are excluded and rejected on save.
  Lead creators may hand over their own leads. Quick add offers brand and
  salesperson together, and creation plus assignment is one audited record write
  (not two writes that can leave a half-saved handoff). The assigned person is
  notified. Creators retain access; unrelated managers do not get a team bypass.
- Each lead row has Assign salesperson. Assigned to me and Created by me make
  ownership clear; staff see four key numbers by default and can reveal the
  remaining figures. Extra filters and metric explanations are collapsed.
  Default owner/brand/status/unit and follow-up reduce entry; unknown commercial
  details are not invented or required at capture. Existing approval safeguards,
  audit, financial locks and role-restricted forms remain in place.
- Manage team opens Access control directly. Add user defaults to Sales
  Executive; select brands and create an active account before assigning work.
  The separate People & HR page is not a login/assignment account creator.
  Fictional browser preview uses its own roster; authenticated APIs never trust
  that roster. No real team accounts were created or changed by this work.
- IT Administrator now has MD-equivalent CRM, HR, finance, approvals, operations,
  internal automation, template and user-administration capabilities, as expressly
  requested. Scope/module restrictions, self-administration protections, last-MD
  protection and private mailbox/room boundaries remain. IT keeps its own identity
  in audit and UI. The role editor warns about this sensitive scope of access.
- Enercore is the fifth company/brand, with a stable `/workspace/enercore/...`
  route and its existing approved logo/theme on commercial documents. No contact,
  address, bank details, signature or legal entity name was invented or copied
  from another company. Commercial footer contacts await approved details.
- Migration `0024_lead_creator_visibility.sql` backfills creator IDs only from
  matching, genuine Created leads audit events and adds an index. Migration
  `0025_enercore_brand.sql` adds Enercore only to MD/MD Assistant/IT accounts that
  already cover all four existing brands, revokes their old credentials and
  records the grant. Partial scopes and ordinary staff memberships stay unchanged.
  Other brand access must be explicitly granted by an administrator. Migration
  `0026_apollo_lead_creator.sql` restores creator visibility from immutable Apollo
  import receipts, with matching company and branch. New reviewed Apollo imports
  are explicitly Buyer prospects with trusted capture identity, not buyer demand.
  No Apollo API calls or credit spend were performed. These
  migrations are retry-safe and are NOT permission to change production.
- Verified 623 unit tests, TypeScript, final OpenNext production-format build,
  seven browser scenarios and authenticated
  isolated-Worker acceptance. These include direct create-and-assign, creator
  retention, unrelated Sales Manager denial, read-only MD Assistant, IT user
  administration, all 1,005 test leads over three cursor pages and sales feedback.
  The migrations were tested with fictional data, never production.
  The saved review database was not migrated and no real staff access changed.

This is a focused simplification of lead capture, allocation, daily work and
team setup, not a claim that every CRM page was redesigned or that staff training
has occurred. At this checkpoint the AI page redesign remained deferred. Production deployment,
production migrations and real-account acceptance remain separate release steps.

### Workspace clarity, density and loading — local candidate, 20 October 2026

- Shared screen-only styling now gives the workspace compact desktop controls,
  consistent headings, panel spacing, form fields and theme surfaces. Phone
  controls retain 44px touch targets and readable input text. Approved print
  geometry and original email HTML are excluded from this layer.
- Secondary sidebar groups can be collapsed and remember the person's choice.
  Navigating or refreshing reveals the active group and restores the navigation
  scroll. Search and the page-level “How to use” guide keep other work findable.
- Role homes have a three-step, optional daily routine. Sales work no longer
  repeats the same priority queue in two places. Full lead reports and business
  analysis remain available behind explicit disclosures, rather than competing
  with daily work on first entry. No invented targets, streaks or staff scoring
  were added.
- Lead Desk opens with four actionable figures, ten rows, a compact search/filter
  toolbar and a horizontally scrollable queue selector. More numbers, complete
  weekly exports, brand/product/owner breakdowns and allocation remain available.
  Read-only/Marketing feedback controls say “View feedback,” not “Update.”
- Quick add and its keyboard shortcut now follow record-level write permission,
  not merely module visibility. Read-only overrides and MD Assistant cannot open
  an empty creation dialog. Status menus share workflow validation and omit
  approval/payment/reopening transitions which the actor or record cannot use.
  Quotation creation is hidden when the lead's reader cannot create quotations.
  Server-side permission checks, approval separation and company boundaries remain.
- Shared buttons default to non-submit behavior; actual sign-in, password reset,
  activity and payment submissions explicitly remain submit actions. Choosing a
  tab, password visibility or optional dropdown value must not submit a form.
  Explicit empty choices such as “Keep with me · Assign later” are selectable
  again and still send an empty value, not the UI's sentinel, to their caller.
- Dialogs, record workspaces, reports, settings, mail and commercial pages load
  their code on demand with loading feedback. Calendar code loads only when
  opened. Stable scoped arrays stop unrelated menus/toasts from restarting the
  entire lead cursor load. Search requests are debounced. Closed sales-copilot
  disclosures do not fetch their contents. Reduced-motion preferences remain.
- The assistant received the same spacing, control and loading cleanup, not an
  autonomous agent or paid general-chat expansion. Unsupported question tools
  are hidden, and the extra floating assistant is suppressed on phones because
  the header already provides access. No AI requests or provider credits were used.
- Corrected a large-data defect: a global 1,000-record window full of leads could
  make older quotations, customer or people pages appear empty. Record modules
  now additionally load their own bounded, server-authorized kind window, cached
  until refresh. HR includes leave. Invalid kinds are rejected and forbidden
  modules return 403. There is no new permission or database migration.
- Reporting limitation remains explicit: Overview uses loaded records rather than
  a complete server-side management aggregation. It is labelled when its display
  window is limited; the full cursor-loaded lead report remains the source for
  complete permitted lead counts. Ordinary module windows remain bounded; this
  release is not a claim of unlimited pagination or full financial reconciliation.

Verification for this candidate:

- 626 unit tests, TypeScript and the OpenNext production-format build passed;
  `.open-next/worker.js` exists. Working and staged diff whitespace checks passed.
- Five isolated-Worker browser scenarios passed: 29 workspace routes × light/dark
  × 360/768/1440px (174 layout checks); all 16 role home refreshes and creation
  visibility; sidebar/guide/optional-choice behavior; eight standard create forms
  × two themes × three widths (48 editor checks); and older-quotation loading
  behind thousands of leads, invalid kind rejection and Employee 403 denial.
- Eight fictional-preview lead/assignment/feedback scenarios, five catalog,
  customer/proforma/saved-bank scenarios, and seven role-navigation/login-layout
  scenarios also passed. Tests wait for data, not just the role-correct skeleton.
- A like-for-like local production-format sales-page sample loaded 1,007,317
  decoded JavaScript bytes versus 1,528,973 before: 34.1% less. This measures code
  size, not a guaranteed live-network speedup. With 13 cursor requests needed for
  the large fictional lead set, opening Quick add left that count at 13.
- Evidence logs: `/tmp/enercore-ux-build.log`, `/tmp/enercore-ux-types.log`,
  `/tmp/enercore-ux-tests.log`, `/tmp/enercore-ux-browser.log`,
  `/tmp/enercore-ux-lead-browser.log`, `/tmp/enercore-ux-forms-browser.log`,
  `/tmp/enercore-ux-role-login-browser.log`, `/tmp/enercore-ux-performance.log`.
  Screenshots/reports are in ignored `test-results-experience`, `test-results-catalog`,
  `test-results-lead-desk` and `test-results-proforma` directories.

All database-backed checks used the isolated fictional fixture. Its test login
throttle counters were reset for repeated runs; the test suite now reuses sessions.
Production cookie/rate-limit protections were not relaxed. No business records,
real accounts, saved-review data, production data, attachments/R2 configuration,
external messages or deployments changed. This is a tested local UI candidate,
not a guarantee that every possible business state or real staff workflow has
been accepted. Production and real-team acceptance are still separate steps.

### Standard, simpler workspace candidate — 20 October 2026

Local only; not deployed. This follows the request for a more substantial
simplification than the preceding spacing pass.

- Replaced seven lead-queue buttons with one labelled Show leads dropdown.
  Search and the queue choice stay visible; extra filters expand only on demand.
  Refresh, additional numbers, export and permitted team setup share Lead tools.
- Leads now form one divided list, not repeated floating rounded cards. Each
  row keeps its frequent feedback action visible. Assignment and opening details
  are in Actions; unauthorized actions remain absent.
- Standard record lists use status/layout dropdowns rather than status-button
  strips and icon-only layout controls. Import/export/reset share List tools.
  The record title still opens details; the redundant Open button is removed.
- Quick Add record type, conversation outcome, activity type/result and follow-up
  timing use labelled dropdowns. Custom dates appear when selected. Required
  validation, acknowledgement, assignment, audit and follow-up rules are unchanged.
- Role shortcuts keep one primary destination and a Go to menu. Common surfaces
  use restrained 6px corners, controls 4px and dialogs 8px, with flatter panels,
  consistent dividers and comfortable phone targets. Paper layouts, brand marks,
  avatars, circular charts and original email content retain their own geometry.
- Actions menus support arrow keys, Home/End, type-ahead, disabled actions, Escape
  and focus return. No new dependency or network service was introduced.

Verified so far: 626 unit tests, TypeScript, the final OpenNext local build and
11 fictional-preview browser scenarios. These include feedback/assignment,
creator-or-assignee visibility, read-only controls, keyboard menus, list filtering,
record opening and neutral light/dark editors at 360/768/1440px. Evidence logs:
`/tmp/enercore-simple-tests.log`, `/tmp/enercore-simple-types.log`,
`/tmp/enercore-simple-build.log`, `/tmp/enercore-simple-browser.log`.
The isolated production-format review also passed: 29 routes × two themes ×
360/768/1440px (174 layout checks), all 16 role home refreshes and creation
visibility, navigation/optional assignment behavior, eight create forms × two
themes × three widths (48 editor checks), and the older-quotation/kind-permission
regression. Log: `/tmp/enercore-simple-all-pages.log`. All accounts and data were
fictional. No migrations, production writes, external messages, provider calls,
paid credits or deployments were performed. This is not live team acceptance.

### Compact controls follow-up — 20 October 2026

Local candidate only. Fixed the remaining size overrides rather than zooming
the interface or making text unreadably small.

- Shared single-line text, number, selection, date and time fields now have a
  measured 32px desktop height, including the proforma's former fixed 42px
  fields. Padding, line height and actual height agree; changing min-height
  alone was insufficient. Routine action buttons follow the same compact rhythm.
- Phones and coarse-pointer tablets keep 44px fields and 16px entry text.
  Smaller dropdown entries are desktop-only. Help targets remain usable.
- Shorter form gaps, aligned label/help rows, smaller dialog heading/footer
  padding and restrained notes areas reduce unnecessary vertical space.
- Lead search is capped at 440px and its queue choice at 220px on desktop,
  rather than stretching across the whole page. Phone company selection is
  capped at 180px. Summary cells and lead rows have tighter padding.
- Paper/PDF layouts, permissions, stored values and workflow rules are unchanged.

Verification: 626 unit tests; TypeScript; OpenNext local build; four new density
browser scenarios measuring seven standard editors and all three proforma steps
in light/dark at 360/768/1440px, dropdown entries and touch-tablet sizing; five
catalog/customer/proforma/saved-bank regressions; and eleven lead/UI scenarios.
The isolated production-format review also passed all 29 pages × two themes ×
three widths (174 checks), now asserting actual control heights as well as
layout. All 16 role refreshes, eight create editors × two themes × three widths
(48 editor checks), optional assignment and kind authorization regressions passed.
Logs: `/tmp/enercore-density-browser.log`, `/tmp/enercore-density-forms.log`,
`/tmp/enercore-density-lead-flow.log`, `/tmp/enercore-density-all-pages.log`,
`/tmp/enercore-density-tests.log`, `/tmp/enercore-density-types.log`,
`/tmp/enercore-density-build.log`. Screenshots and measurements are Git-ignored
under `test-results-density` and `test-results-experience`. All browser data was
fictional; nothing was deployed and no production data was modified.

### Structural worklist redesign — local candidate, 21 October 2026

This candidate changes the daily layout and information hierarchy, not only
control sizing. It remains local and is not a production release.

- Shared page headings keep the title and main action. Descriptions, definitions
  and first-use instructions remain available from the question-mark help,
  rather than appearing as repeated paragraphs on every page.
- The 56px header keeps search, quick capture, notifications and the account
  menu. Profile, appearance, theme switching and AI are in that account menu;
  existing permission-scoped navigation remains intact.
- Lead Desk uses a compact column worklist on desktop and shorter phone rows,
  with brand marks, salesperson, follow-up and status. Feedback opens in a
  focused 480px side panel, full-width on small phones, instead of expanding
  and displacing the worklist. The pipeline board is available through Tools.
  Saved feedback, acknowledgement, assignment and reporting rules are unchanged.
- Phone directories use two-row entries and a two-row search/filter toolbar.
  Redundant last-updated blocks are omitted from those rows; complete values
  remain in record details. Controls keep 44px phone/coarse-pointer targets and
  normal entry text, rather than using page zoom to fit more content.
- Role homes put current priorities before supporting analytics, consolidate
  shortcuts and keep the daily routine optional. Summary strips, dividers,
  spacing, restrained corners and theme tokens replace competing card chrome.
- Dialog close buttons no longer open an automatic tooltip that consumes the
  first Escape press. Closing the feedback panel returns keyboard focus to
  its originating update button. Keyboard menus and hidden unauthorized actions
  retain their existing behavior.

Verified: 626 unit tests, TypeScript, the final OpenNext build and 39 browser
scenarios across the worklist, lead flows, density, catalogs/banks/proformas,
login/role flows and isolated production-format review. That review includes
all 29 workspace routes in two themes at 360/768/1440px (174 layout checks),
all 16 role refreshes and each role home at three widths (48 role layouts),
eight standard create forms in two themes at three widths (48 editor checks),
and older-quotation/kind-permission regressions. Login and password recovery
also passed both themes at all three widths. Feedback persistence, creator-or-
assignee visibility, assignment, neutral validation, saved-bank selection,
inline customer creation and the customer-proforma issue/print flow passed.

Evidence: `/tmp/enercore-worklist-{unit,types,build,design,lead-flow,density,forms,auth-role,all-pages}.log`.
Screenshots and geometry checks are Git-ignored under `test-results-worklist`,
`test-results-experience`, `test-results-density`, `test-results-catalog`,
`test-results-proforma` and `test-results-lead-desk`. All accounts and data in
these checks were fictional. No migrations, production writes, live messages,
paid-provider operations, commits, pushes or deployments were performed. The
temporary isolated test server was stopped; the browser-local preview remains
available at `http://localhost:3000/workspace/all-companies/sales-pipeline`.

Keep additive tables and new records. An older Worker can stop serving the new
features but is not permission to restore an old database over new activity.
Disable automation and pause affected business writes before rollback. A database
restore requires an isolated target, reconciliation and explicit approval.

Production smoke checks must verify the actual new version, login/public assets,
anonymous API denial, production mode, no test endpoints and no R2 binding.
Authenticated live acceptance still needs the existing administrator/team; no
fictional users or records are seeded into production for testing.

### MD lead operations acceptance — local update, 21 October 2026

The [MD acceptance checklist](./MD-LEAD-OPERATIONS-CHECKLIST.md) maps every stated
requirement to local capability and remaining operational acceptance. The
[staff operating guide](./CRM-STAFF-OPERATING-GUIDE.md) keeps the daily flow to
capture, work and close out follow-ups, with a responsibility matrix, proposed
training and a weekly review format. This supersedes the earlier four-brand
boundary: Enercore is the fifth configured brand. It does not assert five live
website connections or completed training.

Confirmed by the user: Liera is the personal assistant, Aleena and Max work in
Sales, and Mak works in Logistics. IT, Liera and MD can each run the weekly review.
Individual brand coverage, login mapping, training/review dates and a response
target remain unconfirmed. No real accounts or access grants were changed.

- Needs assignment now finds missing owners and known non-sales owners, not
  just Marketing-held leads. Unknown legacy owner roles are not guessed.
- Saved, audited Sales feedback generates an internal update for the original
  creator, only if still active and authorised. Acknowledgements, ordinary
  edits, old feedback on reassignment and own actions stay quiet. The body
  carries the lead/outcome, not private notes or amounts. Notifications remain
  best effort; the queue is the source of truth. No external message is sent.
- Weekly CSV now actually includes brand, product/grade, owner and source
  summaries, plus quantity/unit, destination, contact and missing qualification
  details. The earlier report description overstated grouped CSV coverage;
  grouped tables previously existed on screen only. Screen/export metrics
  now share definitions, including New inquiries and Needs assignment. Owner
  IDs prevent two identically named staff being merged. Allowed zero-lead
  brands remain in the consolidated report without widening anyone's scope.
- Reporting remains an inquiry-creation cohort with current linked outcomes,
  not a historical snapshot or independent count of events in that week.
  Unknown response timing is not fabricated or counted as SLA compliance.

Verified: 635 unit tests, TypeScript and the final OpenNext production-format
build; 18 Lead Desk/worklist browser scenarios, including expanded five-brand
reports at 360/768/1440px in both themes and the mobile overflow correction;
isolated fictional D1 acceptance
with all 1,005 assigned leads over three cursor pages, creator feedback visible
and internally notified, silent acknowledgement/self-action, sales-only
assignment, company/owner/read-only denials, stale/origin checks and an
authenticated browser save. Evidence: `/tmp/enercore-md-{unit,types,build,browser,worklist,connected}.log`.
No production migrations, deployment, provider connections, paid operations,
live data changes, training attendance or real team acceptance are implied.

### Groq AI local update 21 October 2026

The release candidate now uses Groq only, with GPT-OSS-120B for primary answers
and GPT-OSS-20B for short tasks. Workers AI models, the live AI binding and
cross-provider fallback are removed. Existing AI tools keep their role/company
checks and human review; normal CRM work remains available when AI is off.

Quick add can detect inquiry details locally and fill empty draft fields. The
separate AI suggestion button sends pasted text only on an explicit click,
as authorised by the user; secrets are redacted and extracted values require
literal evidence. Typing, saving, assignments and financial decisions do not
trigger autonomous AI actions. Shared dashboard insets and native disclosure
chevrons are consistent, including keyboard and mobile use.

Activation requires revoking the key exposed in chat and storing a replacement
as the private `GROQ_API_KEY` Worker secret. No exposed key was used or copied
into project files. Real Groq inference, account limits, retention settings and
live release acceptance remain pending. Follow the
[Groq setup and workflow guide](./GROQ-AI-SETUP.md) before deployment.

Verified locally: 651 unit tests, TypeScript, the final OpenNext build and a
live-format deployment dry run with no Workers AI binding. All 22 browser
scenarios passed: 13 existing Lead Desk/workspace scenarios, four inquiry/AI
flows and five experience checks. The latter cover all 29 routes in two themes
at three widths, all 16 role homes after refresh, eight create forms and retained
record permissions. The authenticated AI button uses the fictional transport;
typing makes no inference request, applying a suggestion leaves a draft, and
cancel does not save it. Isolated API checks also denied anonymous access,
invalid origins, unknown brands and non-writing roles before model inference.

Evidence: `/tmp/enercore-groq-{all-unit,types,build,dry-run,browser,lead-browser,experience}.log`
and `test-results-ai-workflow` / `test-results-experience`. Browser fixture
origin and Secure-cookie handling were corrected in the test only; production
protections were not weakened. No real Groq inference, credentials test,
production change or deployment was performed. The temporary 8789 test Worker
is stopped; the source preview on 3000 remains available.
