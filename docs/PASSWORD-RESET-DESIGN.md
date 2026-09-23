# Password reset — design

Design only. Nothing here is implemented, no migration is applied, no
infrastructure or production data is touched.

Target architecture: Cloudflare Workers + Next.js 16 (OpenNext) + Drizzle +
D1 + Argon2id, on the Workers **Free** plan.

---

## 1. Proposed architecture

Two phases, so the token never travels with the new password and the request
step reveals nothing.

```
Phase 1 — request
  POST /api/password-reset  { email }
    -> rate limit by email hash and by IP
    -> look up user (may not exist)
    -> if it exists: create token, store ONLY its hash, send link
    -> ALWAYS return the same 200 response

Phase 2 — complete
  POST /api/password-reset/confirm  { token, password }
    -> hash the token, look it up
    -> reject if missing, expired, or user inactive
    -> hash the new password with the existing Argon2id
    -> in one batch:  update password
                      delete ALL sessions for that user
                      delete ALL reset tokens for that user
                      write the audit event
    -> return generic success
```

The reset link points at a page, not the API: `/reset?token=<raw token>`. The
page posts to the confirm endpoint.

**Why a separate table rather than columns on `User`:** a user may have more
than one outstanding request, expired rows need cleaning, and keeping reset
state off the `User` row means a bug in this feature cannot corrupt
authentication data.

---

## 2. D1 schema changes

One new table. **No change to any existing table**, so the migration is
additive and cannot affect current rows.

```ts
// src/lib/schema.ts
export const passwordResets = sqliteTable(
  "PasswordReset",
  {
    // SHA-256 of the raw token. The raw token is never stored.
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    // Recorded for the audit trail only; never used to authorise anything.
    requestedIp: text("requestedIp"),
  },
  (table) => [
    index("PasswordReset_userId_idx").on(table.userId),
    index("PasswordReset_expiresAt_idx").on(table.expiresAt),
  ],
);
```

Generated with `npm run db:generate`, producing `drizzle/0001_password_reset.sql`.
Applied with `npm run db:migrate` (local) then `npm run db:migrate:remote`.

**Single use is enforced by deletion, not a flag.** A consumed token's row is
removed, so replay is structurally impossible rather than dependent on
correctly checking a `usedAt` column.

---

## 3. API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/password-reset` | none | Request a reset link |
| `POST` | `/api/password-reset/confirm` | none | Set a new password using a token |
| `POST` | `/api/users/reset-link` | MD / IT admin | Admin-issued link (see §8 option A) |

Both public endpoints:

- call `checkOrigin(request)`, as every other write does
- return **503** when `isPreview()`, matching `/api/auth`
- validate with `zod`
- never disclose whether an account exists

### Request

```
POST /api/password-reset
{ "email": "person@company.com" }

200  { "ok": true }      // always, regardless of outcome
429  { "error": "Too many requests. Try again in 15 minutes." }
```

### Confirm

```
POST /api/password-reset/confirm
{ "token": "<64 hex chars>", "password": "<14+ chars>" }

200  { "ok": true }
400  { "error": "That reset link is invalid or has expired. Request a new one." }
```

One message for missing, expired and already-used tokens — the distinction is
useless to a legitimate user and useful to an attacker.

---

## 4. UI flow

1. **`/login`** — add a "Forgot your password?" link under the password field.
2. **`/forgot-password`** — single email field. On submit, always shows:
   > If that email belongs to an account, a reset link is on its way. The link
   > expires in 30 minutes.
3. **Email** — one link: `https://crm.enercore.ae/reset?token=…`
4. **`/reset`** — new password + confirmation. Enforces the same 14-character
   minimum as bootstrap. On success, redirects to `/login` with:
   > Password updated. Sign in with your new password.
5. **All other sessions end.** If the user was signed in elsewhere, those
   sessions are gone and they must sign in again.

Preview mode shows the forgot-password link but the endpoint returns 503 with
the existing "requires a configured database" wording.

---

## 5. Token generation and storage

```ts
// 32 bytes = 256 bits of entropy, same as the session token
const raw = [...crypto.getRandomValues(new Uint8Array(32))]
  .map((b) => b.toString(16).padStart(2, "0")).join("");

// Stored value — reuses hashToken() from src/lib/auth.ts
const id = await hashToken(raw);
```

| | |
|---|---|
| Entropy | 256 bits — brute force is not a realistic attack |
| In the database | SHA-256 hash only |
| In the email | the raw token, once |
| In logs | never — the token is never logged or echoed in a response |
| Lookup | by hash, so a database leak does not yield usable tokens |

SHA-256 rather than Argon2id here is deliberate: the token is already
high-entropy random, so there is nothing to brute force, and a slow hash on a
public unauthenticated endpoint would be a CPU-exhaustion vector on the 10ms
Workers Free budget.

---

## 6. Expiry and rate limiting

**Expiry: 30 minutes.** Long enough to find the email, short enough to limit
exposure. Checked on use; expired rows are also deleted opportunistically when
a user requests a new link.

**Rate limiting** reuses the existing `recordLoginAttempt` helper, which is a
generic keyed counter with a 15-minute window, namespaced by key prefix:

| Key | Limit | Protects against |
|---|---|---|
| `reset:<sha256(email)>` | 3 per 15 min | Mailbombing one person |
| `reset-ip:<sha256(ip)>` | 10 per 15 min | Enumerating many addresses |
| `reset-confirm:<sha256(ip)>` | 10 per 15 min | Token guessing |

Reusing that helper matters: it is one atomic SQLite `UPSERT … RETURNING`, so
it cannot double-count under concurrency.

**Cleanup.** No cron is needed on the free plan. Expired rows are deleted
whenever that user requests another reset, and all of a user's rows are deleted
on successful reset. The table stays small for an internal CRM.

---

## 7. Session invalidation

Already solved by an existing helper. `updateUserAndRevokeSessions` updates the
user and deletes every session in one `batch()`. The reset extends that to four
statements:

```ts
await db.batch([
  db.update(users).set({ passwordHash }).where(eq(users.id, userId)),
  db.delete(sessions).where(eq(sessions.userId, userId)),          // all devices
  db.delete(passwordResets).where(eq(passwordResets.userId, userId)), // all tokens
  db.insert(auditEvents).values({ …, action: "Password reset completed" }),
]);
```

D1 has no interactive transactions, but `batch()` is atomic: if any statement
fails the whole batch rolls back, so there is no state where the password
changed but sessions survived.

### Strict single use under concurrency — as built

The batch above is atomic but not sufficient on its own: two simultaneous
requests carrying the same token could each read a valid row and each commit a
batch, so both would succeed and the later password would silently win.

The redemption is therefore split into a claim and its consequences:

```ts
// 1. Claim. A single statement, so SQLite settles the race: of any number of
//    concurrent requests exactly one gets a row back.
const claimed = await db
  .delete(passwordResets)
  .where(and(eq(passwordResets.id, tokenHash), gt(passwordResets.expiresAt, new Date())))
  .returning({ userId: passwordResets.userId });
if (!claimed[0]) return false;            // expired, already spent, or lost

// 2. Consequences, atomic as before.
await db.batch([
  db.update(users).set({ passwordHash }).where(eq(users.id, claimed[0].userId)),
  db.delete(sessions).where(eq(sessions.userId, claimed[0].userId)),
  insertAudit(db, event),
]);
```

Deleting the token *is* the claim, so single use is structural rather than a
check that can be raced. Losers get the byte-identical generic message an
unknown or expired token gets, so the race outcome is indistinguishable from
any other failure and leaks nothing about which request won.

Note that raw ``sql`` fragments cannot be passed to `db.batch()` through the
Drizzle D1 driver — only query builders — which is why the guard is expressed
as a separate claim rather than as guarded statements inside one batch.

**Residual behaviour, deliberately fail-closed:** if step 2 fails after step 1
succeeded, the token is spent and the password is unchanged; the user asks for
a new link. The alternative ordering — claiming last — would admit two winners,
which is worse.

Covered by `e2e/password-reset.spec.ts`, which fires six simultaneous
redemptions of one token and requires exactly one `200`, five `400`s that are
genuine race losses rather than throttling, and exactly one of the six
candidate passwords to be live afterwards.

**Audit:** two events, neither containing the password or the token.

| Action | When | Contains |
|---|---|---|
| `Password reset requested` | Phase 1, only if the user exists | user, time, IP |
| `Password reset completed` | Phase 2 | user, time |

---

## 8. Email delivery options

This is the hard part, and the honest summary is that **there is no longer a
free unlimited path from Workers**. MailChannels ended its free Workers
integration in August 2024 and SendGrid retired its free tier in May 2025.

### Option A — Admin-issued reset link (no email at all) ★ recommended first

The MD or IT admin opens Access Control, clicks "Generate reset link" for a
user, and receives a one-time link to pass on in person, by WhatsApp, or by
phone.

| | |
|---|---|
| Cost | **₹0**, no account, no card, no domain setup |
| Deliverability | Not applicable — nothing is sent |
| Effort | Lowest: one admin-only endpoint, no provider, no DNS |
| Fits | An internal CRM with a handful of staff |
| Weakness | Not self-service; an admin must be reachable. Out-of-band channel must be trusted |

This uses the same token machinery, so adding email later is purely additive.

### Option B — Resend

| | |
|---|---|
| Free tier | 100 emails/day, 3,000/month, 3 domains |
| Integration | REST API over `fetch` — works on Workers |
| Requires | API key as a Worker secret, plus SPF/DKIM DNS records on `enercore.ae` |
| Weakness | Needs an account; DNS records must be added; card requirement unverified |

### Option C — MailChannels Email API

Free plan around 100/day. Same REST-over-`fetch` shape. Successor to the old
free integration, now requiring an account and API key.

### Option D — Cloudflare `send_email` binding — **not viable**

Requires the **Workers Paid** plan and can only send to **pre-verified**
addresses. It is designed for Email Workers replying to received mail, not for
sending to arbitrary user inboxes. It fails both the ₹0 constraint and the
functional requirement.

### Option E — SMTP via cPanel — **not practical**

Workers cannot use Node SMTP libraries, and raw SMTP over `connect()` would
mean implementing the protocol and TLS negotiation by hand.

### Recommendation

Ship **Option A** first. It satisfies every security requirement, costs
nothing, needs no third party, and suits the current user count. Add **Option
B** behind a `RESEND_API_KEY` secret when self-service becomes worth the DNS
and account setup — the design below is identical either way, differing only in
how the link reaches the user.

---

## 9. Security risks

| Risk | Mitigation |
|---|---|
| **Account enumeration** | Identical 200 response and wording in all cases. Do the same work on both paths so timing does not differ measurably |
| **Token in URL** | Tokens land in browser history and `Referer`. Mitigated by 30-minute expiry, single use, and the existing `Referrer-Policy: strict-origin-when-cross-origin`. The `/reset` page should replace history state after reading the token |
| **Token replay** | Row deleted on use — replay is structurally impossible |
| **Token leak from database** | Only the SHA-256 hash is stored |
| **Mailbombing** | 3 requests per email per 15 minutes |
| **Distributed enumeration** | Per-IP limit as well as per-email; accepted residual risk since Workers sees the real client IP via `CF-Connecting-IP` |
| **CPU exhaustion** | Argon2id runs only on confirm, after a valid token is found. An invalid token costs one indexed lookup, so an attacker cannot force expensive hashing |
| **Stale sessions after reset** | All sessions deleted in the same atomic batch |
| **Weak new password** | Same 14-character minimum as bootstrap, enforced server-side |
| **Inactive or deleted user** | Checked at confirm time, not only at request time |
| **Clock skew** | Expiry compared against D1's own `Date.now()` in the Worker; no client time is trusted |
| **Reset link phishing** | Email must state the expiry and that it can be ignored if unexpected |

---

## 10. Tests required

**Unit** (`tests/password-reset.test.ts`)
- token is 64 hex chars and differs every call
- stored id is the SHA-256 of the raw token, and the raw token never appears in the stored row
- expiry boundary: valid at T+29 min, invalid at T+31 min
- rate-limit counter increments and resets after the window

**Integration against the Workers runtime** (`e2e/password-reset.spec.ts`)
- unknown email returns the same status, body and approximate timing as a known one
- a valid token sets the new password and the user can sign in with it
- the old password no longer works
- the same token used twice fails the second time
- an expired token fails
- a tampered token fails
- **all pre-existing sessions are gone after reset**
- two audit events exist, containing neither the password nor the token
- 4th request within 15 minutes returns 429
- both endpoints return 503 in preview mode
- cross-origin request is rejected

No existing assertion should be weakened; the current 66 unit and 84 browser
tests must still pass.

---

## 11. Files that would change

**New (7)**
```
src/app/api/password-reset/route.ts            request endpoint
src/app/api/password-reset/confirm/route.ts    confirm endpoint
src/app/forgot-password/page.tsx               request form
src/app/reset/page.tsx                         new-password form
src/lib/password-reset.ts                      token create/verify/consume
drizzle/0001_password_reset.sql                generated migration
tests/password-reset.test.ts                   unit tests
e2e/password-reset.spec.ts                     integration tests
```

**Modified (5)**
```
src/lib/schema.ts            add the PasswordReset table
src/lib/data.ts              reset queries + extend the revoke batch
src/components/login-form.tsx  "Forgot your password?" link
src/components/user-admin.tsx  admin "Generate reset link" (option A)
docs/DEPLOYMENT.md           reset runbook + any email secret
```

**Unchanged:** `src/lib/password.ts` (Argon2id reused as-is), `src/lib/auth.ts`
(`hashToken` reused as-is), `wrangler.jsonc` unless an email provider is added,
and every existing table.

---

## Open questions

1. **Option A or B first?** A is ₹0 and needs nothing external; B is
   self-service but needs an account and DNS records on `enercore.ae`.
2. **Expiry**: 30 minutes proposed. 15 is tighter, 60 friendlier.
3. **Should a reset force re-login on the current device too?** Proposed yes —
   all sessions, no exceptions, which is the safer default.
4. **Second administrator.** Still the larger operational gap: with one admin
   and Option A, that admin cannot reset their own password. Bootstrap recovery
   (delete the user row, re-run `db:bootstrap`) remains the fallback.

---

## 12. Follow-up work — deliberately NOT in this deployment

Each item below was identified during the pre-deployment review and is
recorded here rather than implemented, to keep the deployed change narrow.

### 12.1 Administrative audit visibility (`AuditEvent.subject`, migration 0002)

**Cause.** `scopedWorkspace` admits an audit event only when its `recordId`
matches a *visible business record*. Administrative events carry a **User** id,
which is never in `workspace.records`, so they can never match. The filter runs
twice: server-side in the records route and again client-side in
`workspace.tsx`.

**Currently stored but invisible:** `Created user`, `Updated user access`
(carries full before/after of role, companies, branches and module access),
`Issued password reset link`, `Password reset completed`.

Password-reset completion **is** audited and attributable today — subject in
`actor`/`actorId`, issuing administrator named in the action text, no secret
material — it is only hidden from the Activity view.

**Approach.** Add a nullable `subject` TEXT column set to `'account'` at the
three administrative write sites. Existing rows stay NULL and keep today's
behaviour. **Do not infer the event type from action strings** — those have
already been renamed once and the derivation would silently rot.

**Requirements for that work:**
- visible only to administrators authorised to manage the accounts in question;
- company **and** branch scope enforced, which needs the target user's current
  scope at read time, not the event's single `company` field;
- no leakage to Group Manager or Branch Manager, who receive audit data today
  but must not receive account events, nor to unrelated administrators;
- multi-company targets handled deliberately: events are currently filed under
  `target.companies[0]` only, so an event about a user in companies A and B is
  invisible to an MD of B;
- historical rows (NULL `subject`) considered explicitly — backfill or accept;
- the `listAuditEvents` 100-row cap and pagination reviewed, since account
  events will start competing for those slots.

### 12.2 Move the reset token out of the query string

The token reaches the edge in the URL on the first GET, so it can appear in
Workers request logs and any Logpush job. The form already strips it via
`replaceState`, which covers browser history and `Referer`. Moving it to a URL
fragment would keep it off the wire entirely, since fragments are not sent to
the server.

### 12.3 Bound the Argon2 PHC parameters before verification

`verifyPassword` takes `m`, `t` and `p` from the stored hash and passes them
straight to `argon2id`. Only our own code writes hashes today, so this is not
attacker-controlled — but a database-write compromise would turn every login
into a memory-exhaustion attempt. Validate against an accepted range before
deriving.

### 12.4 A concurrency-safe floor of one active MD

Self-modification is blocked, so the system cannot reach zero MDs through a
sequence of individual actions. Two MDs deactivating each other simultaneously
could. Needs an invariant enforced in the database, not a read-then-write
check, which would have the same race.

### 12.5 Intermittent first-run browser-test failure after `cf:build`

Observed twice, and both times on the **first full E2E run immediately after
`npm run cf:build`** — once in `cashbook.spec.ts`, once in
`avatars-dashboards.spec.ts`. Each passed in isolation immediately afterwards,
and the suite then passed on every subsequent run without an intervening build
(three consecutive full green runs after the second occurrence).

Working diagnosis: `cf:build` runs `next build`, which rewrites `.next/` and
invalidates the dev-server compilation cache. The next `next dev` run therefore
compiles every route cold while five parallel Playwright workers request them,
and one UI test exceeds its timeout. That makes it a harness artifact rather
than a product defect — both affected specs use preview/localStorage data and
touch none of the reset code.

Not yet proven, so it is recorded rather than dismissed. The cheap confirmation
is to warm the dev server once after a build before running the suite; the
cheap fix is a longer timeout or fewer workers for the browser projects.
