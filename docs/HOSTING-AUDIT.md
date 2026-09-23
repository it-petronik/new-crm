# Hosting architecture audit

Audit of this repository against the goal of hosting on Cloudflare while
keeping the existing cPanel MySQL database. No architectural change has been
made. `APP_MODE` remains `preview`. No database was migrated as part of this
audit.

Target domain: `crm.enercore.ae` (DNS on Cloudflare).

---

## Headline finding

**Cloudflare Workers cannot run this application against a traditional MySQL
database today.** The blocker is not Next.js and it is not Hyperdrive — it is
Prisma. Prisma's own documentation states that a MySQL driver adapter for
Workers does not exist yet:

> "There's also work being done on the `node-mysql2` driver which will enable
> access to traditional MySQL databases from Cloudflare Workers and Pages in
> the future as well."
> — [Prisma: Deploy to Cloudflare Workers & Pages](https://www.prisma.io/docs/orm/v7/prisma-client/deployment/edge/deploy-to-cloudflare)

Supported Workers adapters are Prisma Postgres, PostgreSQL (`pg`), PlanetScale,
Neon, Turso and D1. MySQL is absent.

Hyperdrive does support MySQL, but with the `mysql2` driver directly — it is a
connection pooler and does not make Prisma work on Workers. Confirming the
caution in the brief: **Hyperdrive does not make Prisma + MySQL compatible.**

---

## A. Compatibility

Evidence gathered from this repository.

| Component | Evidence | Node host | Cloudflare Workers |
|---|---|---|---|
| Next.js 16 app | `next 16.3.5` | Works unchanged | **Works** via `@opennextjs/cloudflare` (supports Next 14/15/16) |
| Prisma 6 + MySQL | `@prisma/client 6.19.3`, `provider = "mysql"`, no `driverAdapters` preview flag | Works unchanged | **Blocker** — no MySQL adapter exists |
| Prisma query engine | `libquery_engine-*.node` native binary | Works unchanged | **Blocker** — native binaries cannot run on Workers |
| Interactive transactions | `$transaction(async (tx) => …)` in 5 places: `api/auth`, `api/records` ×2, `api/users` ×2, `api/intake` | Works unchanged | **Blocker** — depends on the above |
| `node:crypto` | `createHash`, `randomBytes` (`lib/auth.ts`); `createHmac`, `timingSafeEqual`, `createHash` (`api/intake`) | Works unchanged | Works with `nodejs_compat` |
| `bcryptjs` cost 12 | `api/auth`, `api/users`, `scripts/bootstrap` | Works unchanged | **Needs verification** — pure JS but CPU-heavy; a cost-12 hash is a long CPU burst and Workers bills/limits CPU time |
| Database-backed sessions | `Session` table, `httpOnly`/`Secure` cookie via `next/headers` | Works unchanged | Would work, but requires the DB access that is blocked |
| Middleware | None present | n/a | n/a |
| Filesystem access | None in `src/` (only `scripts/load-env.ts`, build-time) | Works unchanged | Works — nothing to port |
| Background jobs | None — no `setInterval`, cron, workers or queues | Works unchanged | Works — nothing to port |
| `output: "standalone"` | `next.config.ts` | Required | Requires modification — Workers uses its own build |
| Security headers/CSP | `next.config.ts` `headers()` | Works unchanged | Works |
| `prisma migrate` / `generate` | CLI, Node-only | Runs on server or CI | Runs on server or CI either way |

**Summary:** everything except the data layer is Workers-compatible. The data
layer is the whole application's reason for existing.

---

## B. Architecture options

| # | Option | Code changes | Ops complexity | Cost | DB security | Migration risk |
|---|---|---|---|---|---|---|
| 1 | **Workers + cPanel MySQL** | **Not possible today.** Would require replacing Prisma with raw `mysql2` across every query, or waiting for the adapter | High | Low | Poor — DB must accept Cloudflare egress; cPanel allowlisting is impractical | **Very high** |
| 2 | **Node host + cPanel MySQL** | **None** | Low | ~$5–20/mo | Good — one static origin IP to allowlist | **Very low** |
| 3 | **VPS + cPanel MySQL** | None | Medium — you patch the OS | ~$5–12/mo | Good — one static IP | Low |
| 4 | **VPS running app *and* MySQL** | None | Highest — you own backups, tuning, patching | ~$10–20/mo | Best — DB never leaves localhost | Medium — must move the data |
| 5 | **Workers + edge-compatible DB** | Moderate — change Prisma provider, re-migrate, move data | Medium | Varies | Good | High — leaves cPanel MySQL behind, contradicts the stated goal |

Option 1 is not viable. Option 5 is viable but abandons the database you asked
to keep, and changing the Prisma provider is explicitly out of scope.

---

## C. Minimum-change path

**Option 2 — a normal Node host, keeping cPanel MySQL. Zero application code
changes.**

The repository already builds a standalone Node server, already talks to MySQL
over TCP, and already has working migrations and bootstrap. Nothing in `src/`
needs to change.

Cloudflare still stays in the picture, which addresses the original preference:
point `crm.enercore.ae` at the Node host and leave Cloudflare proxying enabled.
You keep Cloudflare DNS, TLS, CDN, caching, WAF, rate limiting and DDoS
protection — only code execution moves. This is the standard arrangement and
requires no adapter.

```
Browser → Cloudflare (DNS, TLS, WAF, CDN)
             ↓ origin
        Node host (Next.js standalone)
             ↓ TCP 3306, allowlisted static IP
        cPanel MySQL (afrigcug_crm)
```

---

## D. Cloudflare Workers path

Not recommended, and not currently possible without one of these:

1. **Wait** for the Prisma `mysql2` driver adapter to ship, then add
   `previewFeatures = ["driverAdapters"]`, install the adapter, and construct
   `PrismaClient` with it. No timeline is published. The interactive
   transactions in five routes would still need verifying against the adapter.
2. **Drop Prisma** and rewrite every query with `mysql2` over Hyperdrive. This
   touches all five API routes, all transactions, and the session layer — a
   rewrite of the working data layer, which the brief rules out.
3. **Change database** to Postgres/PlanetScale/D1 (option 5) — abandons the
   cPanel MySQL you want to keep.

There is also a practical security problem specific to your host. Hyperdrive
connects from Cloudflare's network, so cPanel's Remote MySQL would need to
allow Cloudflare's egress ranges. cPanel allowlisting is per-IP; the usual
workaround is `%` (allow any host), which exposes MySQL to the whole internet.
That is a worse security position than today.

---

## E. Node hosting requirements

Any host must provide:

- **Node.js 20+**, long-running process (not serverless/edge)
- Ability to run `npm ci` **on the server**, or a matching Linux build
  environment — Prisma's query engine is a per-platform native binary. A macOS
  build produces `libquery_engine-darwin-arm64` and will not run on Linux.
- **Outbound TCP to port 3306** to reach cPanel MySQL
- A **static outbound IP**, so cPanel Remote MySQL can allowlist exactly one
  address
- Environment variable configuration (`DATABASE_URL`, `APP_URL`, `APP_MODE`,
  `NODE_ENV`)
- **HTTPS** at the edge — session cookies are `Secure`, so login silently fails
  over plain HTTP
- Persistent disk not required; no filesystem writes at runtime
- Roughly 512 MB RAM is comfortable for this build

Cloudflare in front of such a host is fully supported — proxying a Node origin
is ordinary Cloudflare usage.

---

## F. Security findings

Nothing sensitive is committed. Verified, values not displayed:

| Check | Result |
|---|---|
| `.env` tracked by git? | **No** — ignored via `.gitignore:3` (`.env*`, with `!.env.example`) |
| Secrets in tracked files? | **None found** — scanned all tracked files for connection strings, bootstrap passwords and hashes |
| `.env` inside the deployable bundle? | **No** — `.next/standalone/` contains only `node_modules`, `package.json`, `server.js` plus the copied `public/` and static assets |
| `.env.example` | Placeholders only |

**Issues to act on:**

1. **Rotate the database password.** It was pasted into a chat session and is
   the same password used for the GitHub account earlier in this session.
   Credential reuse across a source-control account and a production database
   is the highest-severity item here. Give the database its own generated
   password, then update the deployment environment.
2. **MySQL 5.7 is end-of-life** (October 2023) — no security patches. Both
   servers seen are 5.7 (`5.7.44-48` and `5.7.23-23`). Not an immediate
   blocker; plan an upgrade with the host.
3. **Remote MySQL is currently allowlisted to a dynamic residential IP.** Fine
   for setup, unusable for production. Replace with the Node host's static IP
   and remove the residential entry once deployed.
4. **Do not set Remote MySQL to `%`.** If a platform ever seems to require it,
   that platform is the wrong choice.

---

## Discrepancy to resolve

Two different databases on two different servers are in play:

| Database | Server | State |
|---|---|---|
| `afrilcux_crm` | `108.167.146.21` (MySQL 5.7.44) | **Migrated** — all 5 tables, no users |
| `afrigcug_crm` | `162.241.123.54` (MySQL 5.7.23) | **Empty** — currently the one in `.env` |

Migrations were applied to the first. The configuration now points at the
second, which is untouched. Confirm which is the real target before going
further; the unused one should be dropped so it cannot be connected to by
mistake.

---

## Recommendation

**Option 2: a normal Node host, keeping cPanel MySQL, with Cloudflare proxying
`crm.enercore.ae`.**

It needs zero application code changes, keeps the database you already have,
keeps Cloudflare in front for TLS/CDN/WAF, and carries the lowest migration
risk. Workers is the wrong platform for this stack today, for a reason outside
your control and outside this codebase.

### Implementation plan (pending approval)

1. Confirm the target database, drop the unused one.
2. Rotate the database password; update `.env` locally.
3. Choose a Node host that meets section E, note its static outbound IP.
4. Replace the residential IP in cPanel Remote MySQL with the host's IP.
5. Deploy: `npm ci` → `npm run build:standalone` → start
   `.next/standalone/server.js`, with `APP_MODE=preview` initially.
6. Point `crm.enercore.ae` at the host in Cloudflare DNS, proxy enabled, SSL
   mode Full (strict).
7. Run `npm run db:check` from the host; apply migrations if it is the database
   that has not had them.
8. Run `npm run db:bootstrap` once to create the administrator.
9. Verify login, a record write and an audit entry over HTTPS.
10. **Only then** set `APP_MODE=production` and restart.

Steps 2–10 await explicit approval.

## Sources

- [Prisma: Deploy to Cloudflare Workers & Pages](https://www.prisma.io/docs/orm/v7/prisma-client/deployment/edge/deploy-to-cloudflare)
- [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare)
- [Cloudflare Workers: Next.js framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/)


---

# Addendum — Cloudflare Workers migration, Phase 1 (23 September)

Architecture change to Workers was approved. Phase 1 research was completed
**before** any code was written, because the outcome decides whether the data
layer rewrite is worth doing. No application code has been changed. Prisma is
intact, `APP_MODE` is still `preview`, and `db:bootstrap` has not been run.

## Phase 1 result: which data layer

| Approach | Verdict | Evidence |
|---|---|---|
| **C. Prisma + traditional MySQL on Workers** | **Not available** | `@prisma/adapter-mariadb` cannot run on Workers — it depends on `mariadb-connector-nodejs`, which is Workers-incompatible ([prisma#28986](https://github.com/prisma/prisma/issues/28986)). Prisma's own docs still describe the mysql2 adapter as future work |
| **A. mysql2 + Hyperdrive** | Works | Cloudflare documents `mysql2` ≥ 3.13.0 with `disableEval: true` and the `nodejs_compat` flag |
| **B. Drizzle + mysql2 + Hyperdrive** | Works, and preferred | Rides on the same supported `mysql2` driver while keeping type safety and a schema-aware query builder, which matters for a rewrite of this size |

So retaining Prisma at runtime is not an option. The runtime data layer would
have to become **Drizzle + mysql2**, with Prisma retained as migration-only
tooling (no schema change, existing migration history preserved).

This is a large change: it touches authentication, database-backed sessions,
five interactive `$transaction` blocks, audit logging and login-attempt
tracking. It is therefore gated on the connectivity question below.

## The blocker: how Hyperdrive reaches cPanel MySQL

Hyperdrive originates connections from
[Cloudflare's published IP ranges](https://www.cloudflare.com/ips/). Measured
from the live list:

```
15 CIDR blocks = 1,524,736 IPv4 addresses
```

Allowlisting these in cPanel Remote MySQL would let **any Cloudflare tenant's
Worker** open a TCP connection to the MySQL port, with only the username and
password standing in the way. That is not the same as `%`, but it is a very
large shared network — and the server runs **MySQL 5.7, which is end of life
and receives no security patches**.

### The secure alternative, and its cost

Cloudflare's documented answer for databases that cannot be publicly exposed is
**Cloudflare Tunnel**. Requirements, from the official page:

1. The database must be configured for **TLS/SSL**
2. A hostname on the Cloudflare account for routing
3. **`cloudflared` running persistently inside the private network where the
   database is reachable** — i.e. on the cPanel server itself
4. A **Cloudflare Access application with service token** authentication
   (Zero Trust)
5. Hyperdrive configured with those Access credentials

Requirement 3 is the problem. The plan already cannot run Node.js, which
strongly suggests it cannot run an arbitrary persistent daemon either.

**And note the circularity:** if `cloudflared` is instead run on some other
always-on machine, that machine has its own static IP — at which point the
database could simply allowlist that one IP, and the application could run
there directly. Workers stops being necessary. A separate host for the tunnel
makes the Workers architecture pointless rather than enabling it.

## Questions for the hosting provider

Ask support, verbatim:

1. Does my plan allow running a persistent background process / daemon, started
   over SSH, that stays running after I disconnect?
2. Specifically, may I run Cloudflare's `cloudflared` connector on the server?
3. Is SSH access with long-running processes permitted, or are processes killed
   on logout?
4. Is MySQL configured to accept **TLS/SSL** connections, and can you provide
   the CA certificate?
5. Does Remote MySQL "Add Access Host" accept **CIDR ranges** (e.g.
   `104.16.0.0/13`), or only single IPs and `%` wildcards?

**If the answer to 1–3 is no, the Workers architecture is blocked** and the
recommendation reverts to the Node host in section C, which needs no code
change at all.

## Status

- No data-layer rewrite started — deliberately gated on the above
- Prisma untouched, existing implementation intact and rollback-safe
- `afrigcug_crm` migrated and verified, zero rows, no admin
- `APP_MODE` remains `preview`

## Additional sources

- [Prisma adapter-mariadb not supported on Workers (prisma#28986)](https://github.com/prisma/prisma/issues/28986)
- [Cloudflare: Build global MySQL apps with Workers and Hyperdrive](https://blog.cloudflare.com/building-global-mysql-apps-with-cloudflare-workers-and-hyperdrive/)
- [Hyperdrive: firewall and networking configuration](https://developers.cloudflare.com/hyperdrive/configuration/firewall-and-networking-configuration/)
- [Hyperdrive: connect to a private database](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/)
- [Cloudflare IP ranges](https://www.cloudflare.com/ips/)
