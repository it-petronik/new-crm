import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, dummyHash, MEMORY_KIB, TIME_COST } from "../src/lib/password";

test("a password verifies against its own hash and nothing else", async () => {
  const hash = await hashPassword("CorrectHorseBatteryStaple2026");
  assert.equal(await verifyPassword("CorrectHorseBatteryStaple2026", hash), true);
  assert.equal(await verifyPassword("correcthorsebatterystaple2026", hash), false);
  assert.equal(await verifyPassword("", hash), false);
  assert.equal(await verifyPassword("CorrectHorseBatteryStaple2027", hash), false);
});

test("hashes are Argon2id in PHC format, recording their own parameters", async () => {
  const hash = await hashPassword("some-password");
  assert.ok(hash.startsWith("$argon2id$"), `expected argon2id, got ${hash.slice(0, 20)}`);
  // The parameters travel with the hash, so they can be raised later.
  assert.match(hash, /\$m=\d+,t=\d+,p=\d+\$/);
  assert.ok(hash.includes(`m=${MEMORY_KIB}`), "memory cost must be recorded");
  assert.ok(hash.includes(`t=${TIME_COST}`), "time cost must be recorded");
});

test("each hash uses a fresh salt, so identical passwords differ", async () => {
  const [a, b] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same-password", a), true);
  assert.equal(await verifyPassword("same-password", b), true);
});

test("a hash made with different parameters still verifies", async () => {
  // Raising the cost later must not lock existing accounts out.
  const weaker = await hashPassword("portable-password", 8 * 1024);
  assert.ok(weaker.includes("m=8192"));
  assert.equal(await verifyPassword("portable-password", weaker), true);
});

test("malformed and foreign hashes are rejected rather than throwing", async () => {
  for (const bad of [
    "",
    "not-a-hash",
    "$argon2id$garbage",
    "pbkdf2$sha256$100000$c2FsdA==$a2V5", // the superseded scheme
    "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW", // bcrypt
  ])
    assert.equal(await verifyPassword("anything", bad), false);
});

test("the decoy hash is a real hash that matches no supplied password", async () => {
  const decoy = await dummyHash();
  assert.ok(decoy.startsWith("$argon2id$"));
  assert.equal(await verifyPassword("", decoy), false);
  assert.equal(await verifyPassword("admin", decoy), false);
  // Stable within an isolate, so the failure path has a predictable cost.
  assert.equal(await dummyHash(), decoy);
});

test("the cost stays inside the Workers free CPU budget", () => {
  // 10ms CPU per request on the free plan. Pure-JS argon2id measured:
  // m=4MiB 7.9ms (fits), m=8MiB 15.2ms, m=16MiB 30.4ms (both exceed it).
  assert.ok(MEMORY_KIB >= 4 * 1024, "memory cost must not be weakened silently");
  assert.ok(MEMORY_KIB <= 4 * 1024, "memory cost must stay within the free CPU budget");
  assert.equal(TIME_COST, 1);
});

test("a hash is memory-hard, not merely iterated", async () => {
  // The scheme itself is the security property being asserted: Argon2id
  // forces memory per guess, which PBKDF2 does not.
  const hash = await hashPassword("memory-hard-check");
  assert.ok(hash.startsWith("$argon2id$"), "must not silently fall back to a CPU-only scheme");
  const memory = Number(hash.match(/m=(\d+)/)![1]);
  assert.ok(memory >= 4096, "each guess must cost at least 4MiB of memory");
});
