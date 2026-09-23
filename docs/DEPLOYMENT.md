# Deployment — Cloudflare Workers + D1

Current architecture. Runs entirely on Cloudflare's free tier: no card, no VPS,
no cPanel dependency.

```
Browser -> crm.enercore.ae -> Cloudflare Worker -> Next.js 16
                                    |
                                    v
                            Drizzle ORM -> D1 (SQLite)
```

`APP_MODE` stays `preview` until production is explicitly approved. In preview
the app runs on fictional in-browser data and never touches D1.

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

## 11. Rollback

Deployments are versioned, so the fastest rollback is:

```
npx wrangler deployments list
npx wrangler rollback [deployment-id]
```

To go back to preview data without redeploying code, set `APP_MODE` back to
`preview` and deploy. The previous MySQL/Prisma implementation remains in git
history, and `prisma/` with its migrations is retained for reference.

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

- **Password hashing changed from bcrypt to PBKDF2-SHA256** (WebCrypto,
  100,000 iterations). bcrypt cost 12 needs roughly 250 ms of CPU and the free
  plan allows 10 ms; PBKDF2 through WebCrypto measured about 7.5 ms. The stored
  format records its own iteration count, so the cost can be raised later
  without invalidating existing accounts. 100,000 is below OWASP's 600,000
  recommendation for PBKDF2 — raise it if you move to a paid Workers plan.
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

## Previous architectures

The cPanel MySQL and Node-host instructions were removed when this migration
landed. See `HOSTING-AUDIT.md` for why Workers plus external MySQL was not
viable, and git history for the previous deployment guide.
