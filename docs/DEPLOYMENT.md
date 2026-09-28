# Deployment and Phase 6 recovery

Enercore runs on Cloudflare Workers with D1. The checked-in `live` environment
uses `APP_MODE=production`, `APP_URL=https://crm.enercore.ae`, and the live D1
binding. The default Worker is a separate fictional-data preview. Verify actual
account, Worker version and database identifiers before any remote operation;
this document describes configuration, not a live infrastructure audit.

**R2 and Phase 4 remain disabled.** Do not create a bucket, enable a binding,
bootstrap users, seed production or backfill relationships as part of Phase 6.
The commands below are a runbook, not authorization to release. Design approval
alone does not authorize commit, push, remote migration or deployment.

## Local verification

Use Node as specified in `package.json`, Python 3 with SQLite JSON support,
installed Chrome, and the local LiveKit test binary. No production credentials
are required. The suite uses fictional accounts and a local AI test double.

```sh
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
node --import tsx --test tests/*.test.ts
npx playwright test
npm run cf:build
npm run typecheck
npx playwright test -c playwright.d1.config.ts
npx playwright test -c playwright.collab.config.ts --workers=2
npx playwright test -c playwright.collab-nofiles.config.ts
COLLAB_TEST_NO_R2=1 npx playwright test -c playwright.collab.config.ts commercial.spec.ts --workers=2
```

Run Worker suites sequentially: they provision a fresh local state and share
port 8788. The collaboration launcher uses Wrangler’s Worker API with
`dev.watch=false`. A test-only entrypoint exports the real app and the fake
AI named self-service binding in one runtime, so D1 has a single owner and
service discovery cannot substitute another preview. Test data inspection is
read-only; the fixture snooze-expiry adjustment uses a per-run-token-protected
route in the test-only entrypoint and the running D1 binding. Tests must not
open the active SQLite file for writes. This route is absent from worker.ts
and from production builds. This prevents development asset notifications from restarting the
runtime and terminating sockets during regression. Production realtime behavior
is unchanged. Do not rebuild `.next`/`.open-next`, edit runtime source, or run another
Worker test server against that state during a suite. Main E2E uses port 3000;
finish it before the build. Recovery E2E is included in the main suite and uses
separate local bindings/configuration directories. It exercises the actual
Wrangler migration, export and restore commands, including interruption.
Its Playwright project depends on the browser project, so both run under the
default command while recovery gets an uncontended CPU budget. The existing
60-second test deadline and all recovery assertions remain unchanged.

The dedicated D1 configuration provisions its own local Worker and accounts.
It fails when prerequisites are unavailable; it does not silently skip. Unit
verification includes every Python recovery case as a separate Node test.
Standalone recovery tests: `python3 tests/recovery_test.py`.

A release gate requires the complete final run to have zero failures, skips and
retries, a successful isolated recovery rehearsal, a successful build/typecheck,
and a reviewed source-only candidate/secret scan. An isolated pass does not
clear an unexplained complete-suite failure.

## Backup validation

`scripts/backup-d1.sh` reads the existing live D1 only with `wrangler d1 export
--remote --env live`. Run it only when production export is authorized. It never
restores or writes to remote D1. Output contains metadata only; raw Wrangler
output and signed download URLs are withheld even on failure. Files use private
permissions. `.backup.env` remains optional and ignored; never commit it.

After export, the script calls `scripts/d1-recovery.py validate`. It rehearses
the dump in memory and verifies the migration-derived schema, all required
columns, indexes (including expression/unique indexes), triggers, data
constraints, relationship guards, foreign keys and SQLite integrity. The
Phase 6 profile requires Contact, Deal and SupplierProductCapability and their
guards. A missing Phase 6 table or guard cannot pass as an older backup.

Before migration 0013, select the older profile explicitly:

```sh
BACKUP_SCHEMA_VERSION=pre-phase6 npm run db:backup
```

After migration 0013, the default is Phase 6:

```sh
npm run db:backup
```

Do not use the older profile to bypass a Phase 6 validation failure. The old
profile rejects Phase 6 tables. Migration history, when present, must match the
selected profile exactly. Legacy rows with null/unset optional relationships
remain valid; inactive historical Contacts are preserved.

A backup is promoted from `.partial` only after validation. Its
`.sql.validation.json` companion records table counts/hashes and schema object
names, never row contents. `BACKUP_DIR`, `D1_DATABASE`, `BACKUP_KEEP` (default 30)
and optional `BACKUP_MIRROR_DIR` remain supported. Mirror both files; verify that
an off-device copy actually completed. Local success is not evidence of cloud
sync. Retention removes only this script's old backups and their sidecars.

Standalone offline validation (use a new report path each time):

```sh
python3 scripts/d1-recovery.py validate /protected/path/backup.sql \
  --schema phase6 --report /protected/path/validation-new.json
```

Validation checks what is in the export. Protect/authenticate backup files and
retain source-side operational evidence; a structurally valid SQL file alone
cannot prove that an upstream exporter included every intended source row.

## Restore architecture

`scripts/restore-d1.sh` delegates to `scripts/d1-recovery.py restore`.
The old two-argument command with implicit remote mode is removed. There is no
production override. Restore accepts only an **empty isolated recovery target**
whose name begins `enercore-recovery-`; it refuses the checked-in live/default
D1 names and IDs and refuses environment-overriding configurations.

1. Parse only supported export statements, using SQLite statement boundaries
   so trigger bodies, escaped quotes, Unicode and multiline strings survive.
2. Rehearse the entire backup in memory. Reject malformed/truncated SQL, invalid
   JSON, schema drift, missing guards, bad relationships and duplicate Deals
   before any target write. Verify the backup did not change during preflight.
3. Confirm that the isolated target has no application tables. Create an
   incomplete-restore journal and a private local receipt.
4. Create all base tables; restore data in deterministic physical-FK dependency
   order; create indexes; install integrity triggers last. Logical cycles such
   as Customer → primary Contact → Customer and Lead → Deal → Lead do not
   constrain the load order. These stages share one ordered import file with
   a journal update at each boundary, avoiding repeated CLI startup. Invalid
   ancestry cycles are rejected. Unsupported
   physical FK cycles fail before target writes rather than being guessed at.
5. Run D1 `foreign_key_check` and `quick_check`. D1 rejects `integrity_check` at
   its API boundary. For a **local** target, identify its SQLite file by the
   unique recovery journal ID and run full `integrity_check` read-only.
6. Export the target and validate that export in SQLite, including full
   `integrity_check`, all guards and exact schema/row hashes for **every** table.
   BusinessRecord payload strings, Contact/Deal/capability rows, audit, meeting,
   AI usage and migration metadata must match exactly. Historical inactive
   Contacts are checked as unchanged references, not new selections.
7. Only after every check passes, remove the temporary journal and write a
   `validated` receipt. Only then print `RESTORE VALIDATED`.

No guard is disabled on a running application. No backup editing is required.
No constraint failure is ignored. The target must not serve an application
until its restore is validated and separately approved for use.

## Isolated local rehearsal

Use a new directory and a standalone JSON configuration with a newly generated
local database UUID. No Cloudflare resource is created by local D1 commands.
The repository test `tests/recovery_rehearsal.py` creates these automatically.

```sh
python3 tests/recovery_rehearsal.py --work work/recovery-rehearsal-NEW
```

For a separate manual restore, supply the isolated config and target binding:

```sh
bash scripts/restore-d1.sh /protected/path/backup.sql \
  --local --config /isolated/recovery/wrangler.json --database RECOVERY \
  --persist-to /isolated/recovery/.wrangler/state \
  --report /isolated/recovery/receipt-NEW.json
```

The config needs `d1_databases` with binding `RECOVERY`, a unique
`database_name` beginning `enercore-recovery-`, and a new `database_id` distinct
from live. Local `--persist-to` must be the config directory's `.wrangler/state`:
the installed Wrangler exporter does not support a custom persistence flag.
This check prevents exporting a different empty database by accident.

The automated fixture starts before Phase 6, creates a legacy unlinked Lead,
applies 0013, then records same-name Customers, a primary Contact, an inactive
historical Contact, a Supplier Contact, a linked Lead/Deal/quotation/downstream
chain, renamed Customer/Supplier/Product, active/inactive capabilities, audit,
meeting notes/reports and AI usage metadata. No real business records or usable
credentials are used.

## Interruption and failures

Any failure returns nonzero and never prints validation success. After target
writes begin, the journal and receipt retain an `incomplete` phase. A hard kill
also leaves the last incomplete journal in place. A partially populated target
is refused on the next attempt. Never resume by manually deleting selected rows
or installing only the missing guards.

Discard/recreate the **isolated** target, or use a new isolated config/state
location and preserve the incomplete target for diagnosis. Verify no process
uses it before cleanup. The script performs no automatic target deletion.
The local-only `--rehearsal-stop-after data` switch deliberately fails after
loading data; it is rejected in remote mode and is used by automated tests.

A report path must be new and distinct from the backup, preventing an old
validated receipt from being mistaken for the current failed attempt.

## Isolated remote recovery (requires separate authorization)

Provision an isolated recovery D1 through the authorized infrastructure process;
never reuse the production ID. Supply its standalone config and exact name:

```sh
bash scripts/restore-d1.sh /protected/path/backup.sql \
  --remote --config /isolated/staging/wrangler.json --database RECOVERY \
  --confirm-isolated enercore-recovery-APPROVED-TARGET \
  --report /protected/path/remote-receipt-NEW.json
```

This path is not a production restore or deployment command. Remote D1 exposes
`quick_check`; physical SQLite-file inspection is local-only. Remote validation
still compares the complete target export and runs SQLite integrity/guard checks
on it. Local rehearsal does not claim remote execution has been verified.
Never switch application bindings to a recovered database without explicit
infrastructure approval and reconciliation of activity since the backup.

## Authorized Phase 6 release sequence

1. Review the blocker-resolution report. Confirm all gates passed and obtain
   explicit authorization for the intended commit/push and production actions.
2. Reconcile the candidate with the current release baseline and confirm 0013
   is the only intended pending migration. Review changed source only; exclude
   all secrets, exports, `.wrangler`, `.dev.vars`, generated files and test state.
3. Rehearse recovery on an isolated target and verify the actual live Worker/D1
   identities, deployed version, domain, variables and absence of R2. Record a
   tested compatible rollback/write-freeze mechanism.
4. Take and validate an authorized pre-migration backup with the pre-phase6
   profile, including the off-device copy. Pause commercial writes for rollout.
5. Apply only the reviewed live migration:
   `npx wrangler d1 migrations apply enercore-crm --remote --env live`.
   Check migration history, all new schema objects and foreign keys. Do not seed
   or backfill. Take a Phase 6-profile backup after the validated migration.
6. Build the reviewed revision with `npm run cf:build`. Deploy specifically with
   `npm run cf:deploy:live`. Never use generic default-environment deployment for
   production. Keep the default preview Worker in preview mode.
7. Verify sessions, server permissions, legacy records, stable relationships,
   Deal idempotency, quotation/downstream flow, meetings and explicit AI before
   resuming writes. Confirm passive pages make zero AI calls. Any write-based
   production smoke test needs an agreed controlled scope.

## Rollback

0013 is additive, but an older Worker can discard optional relationship keys
when editing. Do not assume deploying the old Worker is a safe writable rollback.
Freeze commercial writes or use a tested compatibility patch. Preserve Phase 6
tables and records. Never automatically restore an old backup over new activity.
A disaster recovery decision must reconcile changes since the backup and receive
explicit authorization; the isolated restore tool never writes over production.
