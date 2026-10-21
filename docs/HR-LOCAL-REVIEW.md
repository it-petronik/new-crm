# People & HR — local review

Status: implemented for local review. No production migration or deployment has been performed for this HR change. Live document uploads remain disabled.

## User decisions

- Attendance is entered and corrected by HR only. There is no staff check-in/out.
- Employee files and their metadata/download history are restricted to MD, MD Assistant (Personal Assistant), HR Manager and HR Executive, within authorised companies/offices. This follows the latest request to give the Personal Assistant MD/HR access, replacing the earlier exclusion. General IT administration does not open employee files. Explicit read-only/disabled module grants and separate-approver rules still apply.
- Company files (including trade licences) are a separate register. MD Assistant can manage these with their existing HR module grant. Read-only/disabled module grants are respected.
- Salary, increments, bonuses, reviews and probation decisions start as drafts. The latest preparer cannot approve their own proposal. MD/authorised IT approves financial/probation proposals; HR Manager can also review another person's performance proposal.
- Accounts sees only approved/paid payroll, not private employee documents, salary proposal history, probation or performance reviews.

## How to use

Open People & HR and choose a register from the HR workspace dropdown.

1. Employee directory: add employee profiles using the existing form. Employment dates: set probation and next review dates.
2. Attendance: choose an employee and date; enter the day status. Present days may include start/end and break minutes. Every edit needs a reason. Missing entries are not assumed absences.
3. Salary & increments / Bonuses: enter a proposal, save draft, submit, then have a different authorised approver review it. Bonuses may link to an approved performance review.
4. Performance reviews: record agreed measures, target, actual, units, human assessment and next review. These never automatically change pay or decide employment.
5. Probation decisions: propose confirmation, extension or not-confirmed, with a reason and review date. No automatic dismissal or confirmation occurs.
6. Payroll: choose employee/month. The server uses the approved monthly salary effective at month end and approved same-currency bonuses. HR must manually review any partial-month/proration, adjustments and authorised deductions. Submit, separately approve, then Accounts records the confirmed payment reference. Recording paid does not initiate a transfer.
7. Employee / Company files: record category, reference, issuer, issue and expiry dates. Due/expired documents appear on the HR desk. Uploads add retained file versions; archive does not erase files/history.
8. Export register: downloads the current filtered register, with spreadsheet-formula protection. Private history displays the latest 250 events and identifies that limit.

## Important boundaries

This is a reviewed HR/pay register, not a statutory payroll, WPS, tax, gratuity, leave-accrual or banking engine. No automatic attendance deductions, pay increases, performance ranking or employment decisions. Configure and verify company policies before operational use. Legacy salary fields on employee profiles are not approved payroll inputs.

Protected local uploads accept verified PDF/PNG/JPEG file signatures, maximum 10 MiB, to a separate private local R2 binding. Every upload and download is permission checked. Downloads are attachments, private/no-store, with opaque storage keys and private access history. File-signature checks are not malware scanning. No real employee documents should be added to fictional browser previews. Set a retention/deletion, malware scanning, backup and production storage policy before enabling live storage.

`HR_UPLOADS_ENABLED=true` plus `HR_FILES` is accepted only when the configured app URL is loopback. No live binding/flag is added to Wrangler. Production uploads therefore stay disabled even if a flag is accidentally copied to the live URL.

## Verification / reproducibility

- Unit/database tests: `npx tsx --test tests/hr.test.ts` (real migrations, isolated in-memory SQLite through the D1 driver).
- Browser preview checks: `npx playwright test -c playwright.hr.config.ts`.
- `node scripts/hr-test-setup.mjs` generates a fresh `.wrangler/hr-review.*` directory with fictional users, a test config and SQL. Apply migrations and seed only with `--local --config <that directory>/wrangler.test.json --persist-to <that directory>/state`.
- Start that isolated Worker on port 8789. `npx tsx scripts/hr-api-review.ts` checks real authentication, payroll workflow and local protected uploads. Never point these fixtures at a production database.
- Local test password and accounts are fictional fixtures only. Existing saved local workspaces and live data are not modified.

The migration is additive (`0027_hr_operations.sql`). Approved/paid entries and private audit history are immutable; linked employee records cannot be deleted or moved across company scopes. Attendance/payroll keys prevent duplicates. D1 atomic batches use a global HR compare-and-swap; a stale writer rolls back all changes/audit rows and must refresh.

Verified locally on 21 October 2026 after the permission/layout update: 690 unit/database tests, 28 browser/PDF scenarios (including 15 main sections in both themes, HR forms, Personal Assistant access, desktop-style phone views, five-brand PDF symbols and multi-page footers), and 36 authenticated API/file checks passed. Production-format OpenNext build passed. Test fixtures were isolated in `.wrangler/hr-review.*`; the saved existing review database and production were not migrated or seeded. Shared-control review: `npx playwright test -c playwright.crm-polish.config.ts`.
