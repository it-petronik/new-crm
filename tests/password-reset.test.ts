import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createResetToken, hashResetToken, looksLikeToken, resetLink,
  mayIssueReset, RESET_TTL_MINUTES, MIN_PASSWORD_LENGTH,
  safeErrorSummary, confirmationFailureLog,
} from "../src/lib/password-reset";
import { RESET_TTL_MS } from "../src/lib/data";
import type { Actor } from "../src/lib/domain";
import { branchesForRole, mayAssign } from "../src/lib/access-control";

const md: Actor = { id: "md-1", name: "MD", role: "MD", companies: ["Petronik", "Afrilube"], branches: [] };
const itAdmin: Actor = { id: "it-1", name: "IT", role: "IT Administrator", companies: ["Petronik"], branches: [] };
const sales: Actor = { id: "s-1", name: "Sales", role: "Sales Manager", companies: ["Petronik"], branches: [] };
const target = (over: Partial<{ id: string; role: string; companies: string[]; branches: string[]; active: boolean }> = {}) =>
  ({ id: "u-1", role: "Sales Executive", companies: ["Petronik"], branches: [], active: true, ...over });

test("tokens carry 256 bits of randomness and never repeat", () => {
  const a = createResetToken();
  assert.equal(a.length, 64, "32 bytes as hex");
  assert.ok(/^[a-f0-9]{64}$/.test(a));
  const many = new Set(Array.from({ length: 200 }, createResetToken));
  assert.equal(many.size, 200, "every token must be distinct");
});

test("only the hash is derivable from a token, not the reverse", async () => {
  const token = createResetToken();
  const hash = await hashResetToken(token);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, token, "the stored value must differ from the token");
  // Deterministic, so lookup by hash works.
  assert.equal(await hashResetToken(token), hash);
  assert.notEqual(await hashResetToken(createResetToken()), hash);
});

test("malformed tokens are rejected before any database lookup", () => {
  for (const bad of ["", "short", "g".repeat(64), "A".repeat(64), "0".repeat(63), "0".repeat(65)])
    assert.equal(looksLikeToken(bad), false, `${bad.slice(0, 8)} must be rejected`);
  assert.equal(looksLikeToken(createResetToken()), true);
});

test("the link points at the configured origin and carries the token once", () => {
  const token = createResetToken();
  assert.equal(
    resetLink(token, "https://crm.enercore.ae"),
    `https://crm.enercore.ae/reset-password?token=${token}`,
  );
  // A trailing slash must not produce a double slash.
  assert.equal(resetLink(token, "https://crm.enercore.ae/").split("?")[0], "https://crm.enercore.ae/reset-password");
});

test("expiry is exactly 30 minutes", () => {
  assert.equal(RESET_TTL_MINUTES, 30);
  assert.equal(RESET_TTL_MS, 30 * 60_000);
});

test("only authorised administrators may issue a reset", () => {
  assert.equal(mayIssueReset(md, target()), true, "MD may reset a user in scope");
  assert.equal(mayIssueReset(itAdmin, target()), true, "IT admin may reset a user in scope");
  // A non-administrator never may.
  assert.equal(mayIssueReset(sales, target()), false);
});

test("an administrator cannot issue a reset outside their scope", () => {
  // Company the actor does not administer.
  assert.equal(mayIssueReset(itAdmin, target({ companies: ["Petronex"] })), false);
  // Only an MD may act on another leadership account.
  assert.equal(mayIssueReset(itAdmin, target({ role: "Group Manager" })), false);
  assert.equal(mayIssueReset(md, target({ role: "Group Manager" })), true);
});

test("self-issue and inactive targets are refused", () => {
  assert.equal(mayIssueReset(md, target({ id: md.id })), false, "no self-issued reset");
  assert.equal(mayIssueReset(md, target({ active: false })), false, "no reset for a disabled account");
});

test("the password minimum matches bootstrap", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 14);
});

test("a new MD inherits the creator's group-wide scope, not a single branch", () => {
  // The MD fixture is group-wide (branches: []). A new MD must match it,
  // otherwise scope checks make it a subordinate that cannot reach its peer.
  assert.deepEqual(branchesForRole(md, "MD"), []);
  // Every other role keeps the previous default.
  assert.deepEqual(branchesForRole(md, "Sales Executive"), ["Main"]);
  // A branch-scoped administrator can only ever confer its own branches.
  const branchAdmin: Actor = { ...md, branches: ["Dubai"] };
  assert.deepEqual(branchesForRole(branchAdmin, "MD"), ["Dubai"]);
  assert.deepEqual(branchesForRole(branchAdmin, "Sales Executive"), ["Dubai"]);
});

test("a branch-scoped MD cannot reach a group-wide one, in either direction", () => {
  const groupWide = { id: "md-1", role: "MD", companies: ["Petronik"], branches: [], active: true };
  const branchBound = { id: "md-2", role: "MD", companies: ["Petronik"], branches: ["Main"], active: true };
  const branchActor: Actor = { id: "md-2", name: "Second", role: "MD", companies: ["Petronik"], branches: ["Main"] };

  // This is the asymmetry branchesForRole exists to prevent: the group-wide MD
  // can act on the branch-bound one, but not the reverse, so recovery would
  // only work one way.
  assert.equal(mayIssueReset(md, branchBound), true);
  assert.equal(mayIssueReset(branchActor, groupWide), false);

  // The same asymmetry governs access changes, not just reset issuance.
  assert.equal(mayAssign(branchActor, groupWide, {
    role: "Employee", companies: ["Petronik"], branches: ["Main"],
  }), false, "a branch-scoped MD must not be able to demote a group-wide peer");

  // With the scope corrected, both directions work.
  const peer = { ...branchBound, branches: branchesForRole(md, "MD") };
  assert.equal(mayIssueReset(md, peer), true);
  assert.equal(mayIssueReset({ ...branchActor, branches: [] }, groupWide), true);
});

test("no administrator can act on its own account", () => {
  const self = { id: md.id, role: "MD", companies: ["Petronik"], branches: [], active: true };
  assert.equal(mayIssueReset(md, self), false, "no self-issued reset link");
  assert.equal(
    mayAssign(md, self, { role: "MD", companies: ["Petronik"], branches: [] }),
    false,
    "no self-editing of access",
  );
});

test("a non-MD administrator cannot manufacture an MD", () => {
  // Creation: role is leadership, actor is not an MD.
  assert.equal(mayAssign(itAdmin, null, { role: "MD", companies: ["Petronik"], branches: [] }), false);
  // Promotion of an existing ordinary account is refused for the same reason.
  assert.equal(
    mayAssign(itAdmin, { id: "u-1", role: "Employee", companies: ["Petronik"], branches: [] },
      { role: "MD", companies: ["Petronik"], branches: [] }),
    false,
  );
  // And an MD may do both.
  assert.equal(mayAssign(md, null, { role: "MD", companies: ["Petronik"], branches: [] }), true);
});

test("a failure log carries a stable event name and no secret material", () => {
  const token = createResetToken();
  const secrets = [token, "CorrectHorseBattery26", "$argon2id$v=19$m=4096,t=1,p=1$abc$def"];

  // A post-claim failure is marked, so an operator can tell that the link was
  // spent and the password was not changed.
  const consumed = confirmationFailureLog("redeem", true, new Error("D1_ERROR: NOT NULL constraint failed: AuditEvent.company"));
  assert.equal(consumed.event, "password_reset_confirmation_failed");
  assert.equal(consumed.stage, "consequences");
  assert.equal(consumed.tokenConsumed, true);
  assert.match(String(consumed.detail), /NOT NULL constraint failed/);

  // A caller-caused failure records no detail at all, because a parse error
  // can quote the request body, which holds the token and the password.
  const malformed = confirmationFailureLog("body", false, new Error(`Unexpected token in JSON: {"token":"${token}","password":"${secrets[1]}"}`));
  assert.equal(malformed.stage, "body");
  assert.equal(malformed.tokenConsumed, false);
  assert.ok(!("detail" in malformed), "caller-stage failures must record no detail");
  for (const secret of secrets)
    assert.ok(!JSON.stringify(malformed).includes(secret), "no secret may reach the log");

  // Origin failures are likewise caller-caused.
  assert.ok(!("detail" in confirmationFailureLog("origin", false, new Error("Invalid request origin."))));
});

test("error summaries redact token-shaped material and stay bounded", () => {
  const token = createResetToken();
  // A token, its hash and the limiter key derived from it are all long hex.
  const summary = safeErrorSummary(new Error(`lookup failed for ${token} and ${token.slice(0, 32)}`));
  assert.ok(!summary.includes(token), "a raw token must never survive");
  assert.ok(!summary.includes(token.slice(0, 32)), "nor the limiter key derived from it");
  assert.match(summary, /\[redacted\]/);

  // One line, bounded length, and non-Errors do not throw.
  const noisy = safeErrorSummary(new Error("a\n\nb   c".padEnd(500, "x")));
  assert.ok(!noisy.includes("\n"));
  assert.ok(noisy.length <= 200, "a log line stays bounded");
  assert.equal(safeErrorSummary("a bare string"), "Unknown error");
  assert.equal(safeErrorSummary(null), "Unknown error");
});
