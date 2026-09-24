import { argon2id } from "@noble/hashes/argon2.js";

/**
 * Password hashing for the Workers runtime.
 *
 * Constraint: the Workers Free plan allows 10ms of CPU per request, so bcrypt
 * (cost 12, ~250ms) is impossible. Two candidates fit that budget, and the
 * choice between them matters:
 *
 *   argon2id m=4MiB  t=1  (pure JS)   7.9ms   memory-hard   <- chosen
 *   pbkdf2-sha256 100k    (WebCrypto) 7.5ms   not memory-hard
 *
 * Argon2id is preferred because it is memory-hard. PBKDF2 needs almost no
 * memory, so an attacker runs millions of guesses in parallel on a GPU. Forcing
 * 4MiB per guess cuts that parallelism by orders of magnitude, which buys more
 * real resistance than extra PBKDF2 iterations would at the same CPU cost.
 *
 * A WASM Argon2 would allow m=16MiB in the same time, but Workers only accepts
 * statically imported WebAssembly, not modules compiled from bytes at runtime,
 * so `hash-wasm` silently fails there. This is a pure-JS implementation for
 * that reason.
 *
 * 4MiB is still below OWASP's 19MiB recommendation. That is a deliberate
 * trade-off forced by the free plan, not an oversight. The parameters are
 * stored inside each hash, so raising them later does not invalidate existing
 * accounts. On a paid Workers plan, raise MEMORY_KIB to 19456 and TIME_COST
 * to 2.
 */

export const MEMORY_KIB = 4 * 1024;
export const TIME_COST = 1;
export const PARALLELISM = 1;
const HASH_BYTES = 32;

/** Accepted ranges when verifying a stored hash; see verifyPassword. */
export const MAX_MEMORY_KIB = 64 * 1024;
export const MAX_TIME_COST = 10;
export const MAX_PARALLELISM = 4;
const SALT_BYTES = 16;

/** Base64 without padding, as the PHC string format requires. */
const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/=+$/, "");
const unb64 = (value: string) =>
  Uint8Array.from(atob(value + "=".repeat((4 - (value.length % 4)) % 4)), (c) => c.charCodeAt(0));

export async function hashPassword(
  password: string,
  memory = MEMORY_KIB,
  time = TIME_COST,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = argon2id(password, salt, { m: memory, t: time, p: PARALLELISM, dkLen: HASH_BYTES });
  return `$argon2id$v=19$m=${memory},t=${time},p=${PARALLELISM}$${b64(salt)}$${b64(key)}`;
}

/** Constant-time comparison, so a wrong password cannot be found by timing. */
function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = String(stored || "").split("$");
  // ["", "argon2id", "v=19", "m=..,t=..,p=..", salt, hash]
  if (parts.length !== 6 || parts[1] !== "argon2id") return false;
  const options = Object.fromEntries(
    parts[3].split(",").map((pair) => pair.split("=") as [string, string]),
  );
  const m = Number(options.m), t = Number(options.t), p = Number(options.p);
  if (![m, t, p].every((n) => Number.isInteger(n) && n > 0)) return false;
  // Parameters come from the stored hash, so a database-write compromise could
  // otherwise turn every login into a memory-exhaustion attempt. The ceilings
  // are well above anything this application writes (4 MiB, t=1, p=1) and well
  // below what would exhaust a Worker, so raising the real cost later needs no
  // change here.
  if (m > MAX_MEMORY_KIB || t > MAX_TIME_COST || p > MAX_PARALLELISM) return false;
  try {
    const expected = unb64(parts[5]);
    const key = argon2id(password, unb64(parts[4]), { m, t, p, dkLen: expected.length });
    return equal(key, expected);
  } catch {
    return false;
  }
}

/**
 * A real hash of a value nobody can supply, so the "no such account" path
 * costs the same as a real verification and does not reveal whether an
 * account exists. Computed once per isolate.
 */
let decoy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  decoy ??= hashPassword(crypto.randomUUID() + crypto.randomUUID());
  return decoy;
}
