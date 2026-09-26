import { test } from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/lib/schema";
import type { Database } from "../src/lib/d1";
import {
  claimRefreshToken,
  deactivateUnlessLastAdmin,
  findRefreshBySession,
  purgeRefreshTokens,
  redeemPasswordReset,
  revokeAllSessions,
  revokeRefreshFamily,
  rotateDevice,
  updateUserAndRevokeSessions,
} from "../src/lib/data";
import { deriveToken, hashToken, looksLikeToken } from "../src/lib/meeting-guests";
import { d1, migratedDatabase } from "./support/sqlite-d1";

/**
 * "Keep me signed in" storage, on SQLite built from the real migrations
 * (0000–0008) through the real Drizzle D1 driver.
 */

const NOW = Date.now();
const DAY = 86_400_000;

function setup() {
  const sqlite = migratedDatabase();
  for (const id of ["md", "u1", "u2"])
    sqlite
      .prepare(`INSERT INTO "User" VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, `${id}@x.test`, id, "h", id === "md" ? "MD" : "Sales Manager", '["Petronik"]', "[]", "{}", 1, NOW);
  const db = drizzle(d1(sqlite) as never, { schema }) as unknown as Database;
  return { sqlite, db };
}

let n = 0;
/** One device signing in: a session plus the first token of a new family. */
async function device(db: Database, userId: string, familyCreatedAt = NOW) {
  const sessionId = `s${++n}`.padEnd(64, "0");
  const tokenId = `t${n}`.padEnd(64, "0");
  const familyId = `family-${n}`;
  await rotateDevice(
    db,
    { sessionId, userId, sessionExpiresAt: new Date(NOW + 8 * 3600_000), token: { id: tokenId, familyId, userId, sessionId, createdAt: new Date(NOW), expiresAt: new Date(NOW + 30 * DAY), familyCreatedAt: new Date(familyCreatedAt), usedAt: null } },
    null,
  );
  return { sessionId, tokenId, familyId };
}
const count = (sqlite: ReturnType<typeof setup>["sqlite"], table: string, where = "1=1", ...args: unknown[]) =>
  (sqlite.prepare(`SELECT COUNT(*) n FROM "${table}" WHERE ${where}`).get(...(args as never[])) as { n: number }).n;
const cutoff = (now: number) => new Date(now - 90 * DAY);

test("a refresh token is claimed exactly once, even by simultaneous requests", async () => {
  const { db } = setup();
  const d = await device(db, "u1");
  const claims = await Promise.all([1, 2, 3, 4].map(() => claimRefreshToken(db, d.tokenId, new Date(NOW + 1000), cutoff(NOW))));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(claims.find(Boolean)!.familyId, d.familyId);
  // Used now: never again.
  assert.equal(await claimRefreshToken(db, d.tokenId, new Date(NOW + 2000), cutoff(NOW)), null);
});

test("expired tokens, and families past 90 days, cannot be claimed", async () => {
  const { db } = setup();
  const d = await device(db, "u1");
  assert.equal(await claimRefreshToken(db, d.tokenId, new Date(NOW + 31 * DAY), cutoff(NOW + 31 * DAY)), null);
  const old = await device(db, "u1", NOW - 91 * DAY);
  assert.equal(await claimRefreshToken(db, old.tokenId, new Date(NOW), cutoff(NOW)), null);
});

test("rotation: the new pair in, the replaced session out, one family", async () => {
  const { db, sqlite } = setup();
  const d = await device(db, "u1");
  const claimed = (await claimRefreshToken(db, d.tokenId, new Date(NOW), cutoff(NOW)))!;
  await rotateDevice(
    db,
    { sessionId: "n".repeat(64), userId: "u1", sessionExpiresAt: new Date(NOW + 8 * 3600_000), token: { id: "m".repeat(64), familyId: claimed.familyId, userId: "u1", sessionId: "n".repeat(64), createdAt: new Date(NOW), expiresAt: new Date(NOW + 30 * DAY), familyCreatedAt: claimed.familyCreatedAt, usedAt: null } },
    claimed.sessionId,
  );
  assert.equal(count(sqlite, "Session", `"id" = ?`, d.sessionId), 0);
  assert.equal(count(sqlite, "Session", `"id" = ?`, "n".repeat(64)), 1);
  assert.equal(count(sqlite, "RefreshToken", `"familyId" = ?`, d.familyId), 2);
  assert.equal((await findRefreshBySession(db, "n".repeat(64)))?.familyId, d.familyId);
});

test("signing out one device leaves the others; everywhere ends all", async () => {
  const { db, sqlite } = setup();
  const [a, b] = [await device(db, "u1"), await device(db, "u1")];
  const other = await device(db, "u2");
  await revokeRefreshFamily(db, a.familyId);
  assert.equal(count(sqlite, "RefreshToken", `"familyId" = ?`, a.familyId), 0);
  assert.equal(count(sqlite, "Session", `"id" = ?`, a.sessionId), 0);
  assert.equal(count(sqlite, "Session", `"id" = ?`, b.sessionId), 1);
  await revokeAllSessions(db, "u1");
  assert.equal(count(sqlite, "Session", `"userId" = 'u1'`), 0);
  assert.equal(count(sqlite, "RefreshToken", `"userId" = 'u1'`), 0);
  assert.equal(count(sqlite, "Session", `"id" = ?`, other.sessionId), 1);
});

test("access changes, deactivation and password resets revoke every device's refresh family", async () => {
  const { db, sqlite } = setup();
  await device(db, "u1");
  await updateUserAndRevokeSessions(db, "u1", { role: "Sales Executive" });
  assert.equal(count(sqlite, "RefreshToken", `"userId" = 'u1'`), 0);

  await device(db, "u2");
  assert.equal(await deactivateUnlessLastAdmin(db, "u2"), true);
  assert.equal(count(sqlite, "RefreshToken", `"userId" = 'u2'`), 0);
  assert.equal(count(sqlite, "Session", `"userId" = 'u2'`), 0);

  await device(db, "md");
  sqlite.prepare(`INSERT INTO "PasswordReset" VALUES (?,?,?,?,?,?)`).run("r".repeat(64), "md", "md", "md", NOW + 3600_000, NOW);
  const ok = await redeemPasswordReset(db, "r".repeat(64), "newhash", { id: "audit-1", company: "Petronik", actor: "md", actorId: "md", action: "Reset password", recordId: "md" });
  assert.equal(ok, true);
  assert.equal(count(sqlite, "RefreshToken", `"userId" = 'md'`), 0);
  assert.equal(count(sqlite, "Session", `"userId" = 'md'`), 0);
});

test("housekeeping drops expired tokens and used ones past the reuse window", async () => {
  const { db, sqlite } = setup();
  const d = await device(db, "u1");
  await claimRefreshToken(db, d.tokenId, new Date(NOW), cutoff(NOW));
  const live = await device(db, "u1");
  await purgeRefreshTokens(db, new Date(NOW), new Date(NOW + 60_000));
  assert.equal(count(sqlite, "RefreshToken", `"id" = ?`, d.tokenId), 0);
  assert.equal(count(sqlite, "RefreshToken", `"id" = ?`, live.tokenId), 1);
});

test("guest-link tokens: derived per invite, 256 bits, useless without the secret", async () => {
  const secret = "a-server-secret-of-some-length";
  const a = await deriveToken(secret, "invite-1");
  assert.ok(looksLikeToken(a));
  assert.equal(await deriveToken(secret, "invite-1"), a); // shown again: the same link
  assert.notEqual(await deriveToken(secret, "invite-2"), a); // regenerated: a new one
  assert.notEqual(await deriveToken("another-secret-entirely", "invite-1"), a);
  assert.notEqual(await hashToken(a), a);
  assert.match(await hashToken(a), /^[0-9a-f]{64}$/);
});

test("after signing in, only same-site paths are followed", async () => {
  const { safeNext } = await import("../src/lib/auth");
  assert.equal(safeNext("/workspace/all-companies/collaboration?tab=meetings&meeting=x"), "/workspace/all-companies/collaboration?tab=meetings&meeting=x");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", undefined, ["/x"], "/" + "a".repeat(2001)])
    assert.equal(safeNext(bad), "/", String(bad));
});
