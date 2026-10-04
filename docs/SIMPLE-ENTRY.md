# Simple entry — local UI update

The Phase 1–7 architecture and commercial rules are unchanged. This change is presentation-only: no schema, migration, deployment, permission, provider, approval or conversion changes.

- Shared new-record forms start with essentials. Leads show customer, company, product and next follow-up; optional contact, quantity, value, source and notes remain available in a disclosure.
- Quotations use one screen instead of three section tabs. Required party/address/date fields and items remain visible. Optional terms and sender metadata are expandable. Existing sender defaults, product selection and calculated totals remain in use.
- Every profile-required field stays visible. Collapsed optional values are still submitted and validated. Errors open the disclosure before focus moves to the field.
- Edit forms retain all fields; protected commercial edits retain the existing correction-only policy.
- Selecting a live customer can prefill available authorized customer snapshots. Company changes clear the selected contact. No external enrichment or automatic identity merge was added.
- Changing quotation lines now participates in the unsaved-change guard.

Verification: typecheck; targeted entry-layout, quotation, commercial and Phase 7 unit suites; three preview-only browser checks (minimal lead persistence, quotation required-field validation and optional-value preservation, mobile overflow/disclosure). Browser tests block all non-GET API requests. No live database or provider checks were performed.

Run the preview checks with `npx playwright test -c playwright.entry.config.ts`; optionally set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to installed Chrome. The suite requires the local preview and refuses to proceed without its preview banner.

## First-time-user guidance

### Spacing follow-up

Shared shell rules now reserve independent space for the collapsed logo/toggle and use the same compact width as the page offset. Field headings reserve equal height with or without help icons. Dialogs and drawers share horizontal padding tokens. My requests uses the shared page header and a single panel gutter, with balanced form rows. Desktop table actions stay together instead of wrapping into taller rows; mobile actions can still wrap. Browser checks measure sidebar separation, paired field alignment, request-panel gutters and overflow.

- Business pages include a collapsed “How this page works” guide with a short explanation and three next steps. Shared page headings also support guides for profile, appearance, access control, prospecting and other named views.
- Sidebar group names use ordinary work terms. Navigation explanations work in both expanded and collapsed desktop navigation.
- Shared icon buttons expose their accessible label as a tooltip; buttons can supply a richer explanation. Existing explicit tooltips are not duplicated.
- Unfamiliar form labels have short, curated explanations. Hover or focus shows a tooltip; click/tap opens persistent help with a dismissal button. Help buttons do not submit the form.
- Shared row actions show “Open” and “More” text. The underlying handlers and authorization are unchanged.
- New-record dialogs focus their first editable input, not the close icon. Guidance uses theme tokens, bounded widths and reduced-motion support.

Verified locally: typecheck and 23 targeted unit tests; preview browser checks for keyboard/touch help, dark mode, form saving and overflow across 11 business pages at 1440px and 390px. This is not a production or full Phase 1–7 acceptance test. No live data, migrations, deployment or external provider calls were made.
