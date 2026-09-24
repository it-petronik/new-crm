# Deployment — Cloudflare Workers + D1

Current architecture. Runs entirely on Cloudflare's free tier: no card, no VPS,
no cPanel dependency.

```
Browser -> crm.enercore.ae -> Cloudflare Worker -> Next.js 16
                                    |
                                    v
                            Drizzle ORM -> D1 (SQLite)
```

**Status: live.** `crm.enercore.ae` is served by the `enercore-crm-live`
Worker with `APP_MODE=production`. The separate `enercore-crm` Worker on
workers.dev stays `APP_MODE=preview`, where the app runs on fictional
in-browser data and never touches D1. Both Workers share one D1 database, so a
migration applied once covers both.

This is the only current deployment architecture. Anything describing MySQL,
Prisma, cPanel or a Node host is historical — see *Previous architectures*.

## 1. Install

```
npm ci
```

## 2. Local development

Two ways to run it:

```
npm run dev          # Next.js dev server, preview data, fastest feedback
npm run cf:preview   # the real Workers runtime with a local D1 binding
```

`cf:preview` is the one that exercises D1. It reads `.dev.vars` (gitignored);
copy `.dev.vars.example` to `.dev.vars` first.

## 3. Tests

```
npm run typecheck
npm test                                    # unit tests
npx playwright test                         # browser tests
npx playwright test e2e/d1-worker.spec.ts   # D1 integration, needs cf:preview running
```

The D1 spec skips itself when the Worker is not running on port 8788.

## 4. Create the D1 database

```
npx wrangler login
npx wrangler d1 create enercore-crm
```

Copy the printed `database_id` into `wrangler.jsonc`, replacing
`REPLACE_WITH_D1_DATABASE_ID`. The id is not a secret, but it is account
specific, which is why the repository ships a placeholder.

## 5. Migrations

Migrations live in `drizzle/` and are generated from `src/lib/schema.ts`.

```
npm run db:migrate            # local D1, for development
npm run db:migrate:remote     # the real Cloudflare D1 database
npm run db:check              # read-only; add -- --remote for the real one
```

Regenerate after a schema change with `npm run db:generate`.

## 6. Secrets and variables

Non-secret values live in `wrangler.jsonc` under `vars`: `APP_MODE`,
`NODE_ENV`. Set `APP_URL` there too once the domain is attached.

Secrets never go in `wrangler.jsonc`. Use:

```
npx wrangler secret put INTAKE_PETRONIK_SECRET
npx wrangler secret put INTAKE_PETRONIK_OWNER_ID
```

There is no `DATABASE_URL` any more — D1 is a binding, not a connection string.

## 7. Deploy the Worker

```
npm run cf:build
npm run cf:deploy
```

This deploys to the generated `workers.dev` URL first, which is the safe place
to verify before touching DNS.

## 8. Create the administrator

Once, against the deployed database:

```
BOOTSTRAP_EMAIL="you@yourcompany.com" \
BOOTSTRAP_PASSWORD="at least fourteen characters" \
BOOTSTRAP_CONFIRM=CREATE_INITIAL_ADMIN \
npm run db:bootstrap -- --remote
```

It refuses without the confirmation value, refuses passwords under 14
characters, and refuses to run if any user already exists. Remove the values
from your shell afterwards.

## 9. Connect crm.enercore.ae

In the Cloudflare dashboard: Workers & Pages -> enercore-crm -> Settings ->
Domains & Routes -> Add custom domain -> `crm.enercore.ae`.

Cloudflare issues the certificate and routes the domain to the Worker. Then set
`APP_URL` to `https://crm.enercore.ae` in `wrangler.jsonc` and redeploy, because
authenticated writes are rejected when the origin does not match.

## 10. Switch to production

Only after the site loads on the custom domain, `db:check --remote` passes and
login works:

1. Set `"APP_MODE": "production"` in `wrangler.jsonc`
2. `npm run cf:deploy`

## 11. Backup and restore

### Taking a backup

```
npm run db:backup
```

Read-only against production (`wrangler d1 export` only reads). Writes
`backups/<db>-<UTC timestamp>.sql` and prints metadata only — filename,
timestamp, size, database, result. Database contents are never printed or
logged, and wrangler's own output (which includes a signed download URL) is
captured rather than echoed.

The run fails loudly if the export errors, produces nothing, produces an empty
file, contains no `CREATE TABLE`, or is missing any of `User`, `Session`,
`BusinessRecord`, `AuditEvent`. The file is written to `.partial` first and
renamed only once validated, so a failed run can never leave behind something
that looks like a good backup.

**Retention:** the newest 30 backups are kept. Deletion only ever touches
regular files inside the backup directory whose names match this script's own
pattern, never a symlink, and never the newest backup or the one just written.

**Configuration** (all optional, all environment variables; `.backup.env` in
the repo root is loaded if present and is gitignored):

| Variable | Default | Purpose |
|---|---|---|
| `D1_DATABASE` | `enercore-crm` | database to export |
| `BACKUP_DIR` | `<repo>/backups` | local destination |
| `BACKUP_MIRROR_DIR` | none | off-device copy destination |
| `BACKUP_KEEP` | `30` | successful backups retained |

### Off-device copy

A backup that exists only on this Mac protects against very little. Set
`BACKUP_MIRROR_DIR` to any folder that syncs off the device — an iCloud Drive,
Google Drive, Dropbox or OneDrive folder all work, because the sync client
uploads it for you and no credentials ever enter this repo:

```
# ~/.../new-crm/.backup.env   (gitignored)
BACKUP_MIRROR_DIR="$HOME/Library/CloudStorage/GoogleDrive-you@example.com/My Drive/enercore-backups"
```

A mirror failure is reported but never aborts the run and never deletes the
local backup. If the destination is missing the run still succeeds, and the
output says `MIRROR SKIPPED` or `MIRROR FAILED`.

Verify the copy actually left the device. A destination folder existing is not
evidence that it syncs:

- **iCloud Drive**: `~/Library/Mobile Documents/com~apple~CloudDocs` exists and
  is writable even when no iCloud account is signed in, and the `bird` daemon
  runs regardless. Check that `~/Library/Preferences/MobileMeAccounts.plist`
  contains an account rather than an empty dict; if it is empty, files written
  there never leave the Mac. This is the state this machine was in when the
  backup system was set up.
- **Google Drive / OneDrive / Dropbox**: the folder appears under
  `~/Library/CloudStorage/` only once the client is configured.

A paused client, or one out of quota, also keeps files local silently.

### Scheduling a daily backup (macOS)

```
scripts/launchd/install-backup-schedule.sh install     # daily at 02:30
scripts/launchd/install-backup-schedule.sh status      # state + recent log
scripts/launchd/install-backup-schedule.sh run         # trigger once now
scripts/launchd/install-backup-schedule.sh uninstall   # remove (keeps backups)
```

The installer fills absolute paths into the plist template, validates it with
`plutil -lint`, and loads it with `launchctl bootstrap`. Logs go to
`~/Library/Logs/enercore-backup.log` and hold operational metadata only. The
job does not need a terminal, but the Mac must be awake — launchd runs a missed
job after wake.

**Unattended authentication.** launchd runs as you and reads your existing
wrangler OAuth login. This was verified end to end: the installed job ran and
exited 0 without an API token, so no token is needed today. That login can
still expire, and it cannot be refreshed non-interactively — a scheduled run
then fails and the error log says so. Check
`scripts/launchd/install-backup-schedule.sh status` periodically, or after any
run of backups stops appearing. For a schedule you do not want to babysit, put a Cloudflare
API token in `.backup.env`:

```
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
```

Minimum permissions: **Account → D1 → Edit** (D1 exposes no read-only scope;
`export` is still read-only in what it does). Scope the token to this account
only and nothing else. Create it yourself in the Cloudflare dashboard — never
paste a token into the repo or a commit. `.backup.env` is gitignored. Manual
`npm run db:backup` keeps working from your interactive login regardless.

### Restoring — destructive, deliberate, never routine

```
scripts/restore-d1.sh <target-database> backups/<file>.sql
```

The script refuses to target the production database unless
`I_UNDERSTAND_THIS_DESTROYS_PRODUCTION=yes` is set, because a restore replaces
data and cannot be undone. **Take a fresh backup before any restore**, so the
state you are leaving is itself recoverable.

It applies the whole schema first, then inserts data parent-tables-first using
the foreign keys declared in the schema. Both steps are necessary: a D1 export
interleaves each table's `CREATE` with its `INSERT`s and emits tables
alphabetically, so `Session` appears before the `User` rows its foreign key
points at. Replaying the file directly with `wrangler d1 execute --file` fails —
first with `no such table: main.User`, then with a `FOREIGN KEY constraint
failed`. This is not theoretical; it is what happened when the procedure was
first rehearsed.

Rehearse into a scratch database, never production:

```
npx wrangler d1 create enercore-crm-restore-test
scripts/restore-d1.sh enercore-crm-restore-test backups/<newest>.sql
# compare counts against production, then:
npx wrangler d1 delete enercore-crm-restore-test --skip-confirmation
```

Always confirm the scratch database's id differs from production's before
restoring into it or deleting it.

After any restore, check `npx wrangler d1 migrations list <db> --remote`: the
restored `d1_migrations` ledger decides what counts as applied.

---

## Disaster recovery runbook

Three different things are commonly confused. Pick by what actually broke.

| Failure | Tool | Affects | Reversible |
|---|---|---|---|
| Bad deploy, code broken | **Worker rollback** | code only | yes |
| Recent bad data change | **D1 Time Travel** | data only | within retention |
| Database lost or corrupt | **SQL restore** | data only | only via a newer backup |

A Worker rollback changes no data. Time Travel changes no code. Neither is a
substitute for the other.

### A. Worker deployment failure

```
npx wrangler deployments list --name enercore-crm-live
npx wrangler rollback --name enercore-crm-live [version-id]
```

Roll back the Worker you deployed — production is `enercore-crm-live`, not
`enercore-crm`. Schema is untouched; both migrations so far are additive, so an
older Worker runs unchanged against the newer schema. Prefer rolling back code
and leaving the schema alone.

### B. Recent accidental data modification

Time Travel restores the whole database to a point in time, roughly 30 days
back. It is the right tool for "someone deleted the wrong thing an hour ago".

```
npx wrangler d1 time-travel info enercore-crm
npx wrangler d1 time-travel restore enercore-crm --bookmark=<bookmark>
```

Destructive: everything after that bookmark is lost, including good changes.
Take a backup first so you can move forward again if you overshoot.

### C. Database corruption or loss

Restore the newest validated SQL backup into a **scratch** database, verify row
counts, and only then consider production. See *Restoring* above.

### D. Cloudflare account access problem

Time Travel and the D1 database both live inside the Cloudflare account, so
neither is reachable if the account is locked, suspended or lapsed. The only
thing that survives is an off-device backup. This is the entire reason for
`BACKUP_MIRROR_DIR` — set it.

### E. This Mac is lost or damaged

Local backups in `backups/` go with it. Recovery depends on the off-device
copy plus git (`origin/main` holds the application and migrations). Without a
mirror, the position is the same as D above.

### F. Complete environment rebuild

1. `git clone` the repository, `npm ci`
2. `npx wrangler login`
3. `npx wrangler d1 create enercore-crm` — note the new `database_id`
4. Update both `database_id` entries in `wrangler.jsonc` (top level and `env.live`)
5. `npm run db:migrate:remote`
6. Restore data: `scripts/restore-d1.sh enercore-crm backups/<newest>.sql`
   (requires the explicit production override; the database is empty, so this
   is a rebuild rather than an overwrite)
7. `npm run cf:deploy:live`
8. Re-point `crm.enercore.ae` — the custom domain binds to the Worker, so
   confirm the route in `wrangler.jsonc` and that no conflicting DNS record
   exists
9. Verify: `/login` loads, sign in works, row counts match the backup

Step 6 needs a backup. Steps 1–5 and 7–8 need only the account and git.

## 12. Rollback## 12. Rollback

Deployments are versioned, so the fastest rollback is:

```
npx wrangler deployments list
npx wrangler rollback [deployment-id]
```

Note the two Workers are separate scripts, so roll back the one you deployed
(`enercore-crm-live` for production).

The previous MySQL/Prisma implementation lives in git history only. Prisma,
`@prisma/client`, `bcryptjs` and the `prisma/` directory were removed once
production was verified on D1; recover them from history if ever needed.

A schema rollback is separate from a code rollback. Drizzle generates no down
migrations, and both migrations so far are additive (new table, new nullable
columns, new indexes), so an older Worker runs unchanged against the newer
schema. Prefer rolling back the Worker and leaving the schema alone.

## Free-tier limits that matter here

| Limit | Free plan | Relevance |
|---|---|---|
| Worker CPU per request | 10 ms | Drove the password hashing choice, below |
| Requests | 100,000/day | Ample for an internal CRM |
| D1 databases | 10 | One needed |
| D1 storage | 500 MB per database, 5 GB total | Records are small JSON payloads |
| D1 queries per invocation | 50 | Current pages use far fewer |
| Rows read/written | Daily free quota applies | Monitor in the dashboard as usage grows |

## Behaviour differences introduced by D1

- **Password hashing changed from bcrypt to Argon2id** (`@noble/hashes`,
  m=4 MiB, t=1, p=1). bcrypt cost 12 needs roughly 250 ms of CPU and the free
  plan allows 10 ms; this Argon2id configuration measures about 7.9 ms. PBKDF2
  fits the same budget but is not memory-hard, so it parallelises far better on
  a GPU — Argon2id was chosen for that reason. Each hash stores its own
  parameters in PHC format, so the cost can be raised later without
  invalidating existing accounts; `verifyPassword` bounds those parameters on
  read. 4 MiB is below OWASP's 19 MiB recommendation, which is a deliberate
  trade-off forced by the free plan's CPU ceiling — raise `MEMORY_KIB` to 19456
  and `TIME_COST` to 2 on a paid plan. **Do not lower these to buy CPU
  headroom.** A pure-JS implementation is used because Workers accepts only
  statically imported WebAssembly.
- **No interactive transactions.** D1 has no BEGIN/COMMIT that application code
  can branch inside. Each former transaction now reads, decides in application
  code, then commits with `batch()`. Specifically:
  - Login rate limiting became a single atomic `INSERT … ON CONFLICT … RETURNING`,
    which is stronger than before: the old read-then-write could double count.
  - Record updates keep the optimistic version check. The guarded update runs
    first and only a winning update is followed by its linked inserts and audit
    entry, committed together. A stale write still changes nothing.
  - The narrow remaining difference: if the follow-up batch fails after a
    successful update, the record can be updated without its audit row. The
    error surfaces to the caller. MySQL rolled both back.
- **JSON, dates and booleans** are stored as TEXT, INTEGER epoch milliseconds
  and INTEGER 0/1 respectively; Drizzle converts them so callers see the same
  types as before.
- **Case sensitivity**: SQLite `=` on TEXT is case sensitive, where MySQL's
  default collation was not. Email is normalised to lower case on both write
  and lookup, preserving the previous behaviour.

## Previous architectures — historical only

Nothing in this section is in use. It is retained to explain why the current
architecture was chosen.

The cPanel MySQL and Node-host instructions were removed when this migration
landed. See `HOSTING-AUDIT.md` for why Workers plus external MySQL was not
viable, and git history for the previous deployment guide.
