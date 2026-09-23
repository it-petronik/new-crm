/**
 * Creates the first administrator in D1. Explicit, one-time, and refuses to
 * run if any user already exists.
 *
 *   BOOTSTRAP_EMAIL=... BOOTSTRAP_PASSWORD=... BOOTSTRAP_CONFIRM=CREATE_INITIAL_ADMIN \
 *   npm run db:bootstrap -- --remote
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadEnv } from "./load-env";
import { hashPassword } from "../src/lib/password";
import { companies } from "../src/lib/domain";

loadEnv();

const remote = process.argv.includes("--remote");
const target = remote ? "--remote" : "--local";

function execute(sql: string) {
  const output = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "enercore-crm", target, "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(output.slice(output.indexOf("[")))[0]?.results ?? [];
}

/**
 * Runs SQL from a temporary file rather than a command-line argument, so the
 * password hash never appears in the process list. The file is removed even if
 * wrangler fails.
 */
function executePrivately(sql: string) {
  const file = join(tmpdir(), `enercore-bootstrap-${randomUUID()}.sql`);
  writeFileSync(file, sql, { mode: 0o600 });
  try {
    execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "enercore-crm", target, "--json", "--file", file],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } finally {
    rmSync(file, { force: true });
  }
}

async function main() {
  if (process.env.BOOTSTRAP_CONFIRM !== "CREATE_INITIAL_ADMIN")
    throw new Error("Explicit bootstrap confirmation is required.");
  const email = process.env.BOOTSTRAP_EMAIL;
  const password = process.env.BOOTSTRAP_PASSWORD;
  if (!email || !password || password.length < 14)
    throw new Error(
      "Provide an email and a password of at least 14 characters through environment variables.",
    );
  // A typo here creates an administrator nobody can sign in as.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()))
    throw new Error(`That does not look like an email address: ${email}`);
  const [{ total }] = execute('SELECT COUNT(*) AS total FROM "User"') as { total: number }[];
  if (Number(total) > 0) throw new Error("Users already exist. Initial bootstrap is disabled.");

  const passwordHash = await hashPassword(password);
  const escape = (value: string) => value.replace(/'/g, "''");
  executePrivately(
    `INSERT INTO "User" ("id","email","name","passwordHash","role","companies","branches","moduleAccess","active","createdAt") VALUES (` +
      `'${randomUUID()}','${escape(email.trim().toLowerCase())}','Enercore Administrator',` +
      `'${escape(passwordHash)}','MD','${escape(JSON.stringify([...companies]))}','[]',NULL,1,${Date.now()});`,
  );
  console.log("Initial administrator created. No demonstration records were added.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
