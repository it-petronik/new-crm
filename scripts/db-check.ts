/**
 * Read-only D1 check. Reports which tables exist and whether an administrator
 * has been created. It never creates, alters or deletes anything.
 *
 *   npm run db:check           (local D1, used by `next dev`)
 *   npm run db:check -- --remote   (the real Cloudflare D1 database)
 */
import { execFileSync } from "node:child_process";

const expected = ["User", "Session", "BusinessRecord", "AuditEvent", "LoginAttempt"];
const remote = process.argv.includes("--remote");
const target = remote ? "--remote" : "--local";

function query<T>(sql: string): T[] {
  const output = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "enercore-crm", target, "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  // wrangler prints a JSON array of result sets.
  const parsed = JSON.parse(output.slice(output.indexOf("[")));
  return parsed[0]?.results ?? [];
}

try {
  console.log(`Checking ${remote ? "remote Cloudflare D1" : "local D1"} database "enercore-crm"`);
  const tables = query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  ).map((r) => r.name);

  if (!tables.length) {
    console.log("The database is empty. Apply migrations with: npm run db:migrate" + (remote ? " -- --remote" : ""));
    process.exit(0);
  }
  const missing = expected.filter((t) => !tables.includes(t));
  if (missing.length) {
    console.log(`Tables found: ${tables.join(", ")}`);
    console.log(`Missing: ${missing.join(", ")}. Apply migrations with: npm run db:migrate${remote ? " -- --remote" : ""}`);
    process.exit(1);
  }
  console.log("All expected tables are present.");
  const [{ total }] = query<{ total: number }>('SELECT COUNT(*) AS total FROM "User"');
  console.log(
    Number(total) === 0
      ? "No users yet. Create the first administrator with: npm run db:bootstrap"
      : `${total} user account(s) exist. Sign in at /login.`,
  );
  console.log("No changes were made by this check.");
} catch (error) {
  console.error("\nCould not read that database.\n");
  console.error(error instanceof Error ? error.message.split("\n").slice(0, 6).join("\n") : String(error));
  console.error(
    "\nIf this is the first run, create the database and apply migrations:\n" +
      "  npx wrangler d1 create enercore-crm\n" +
      "  npm run db:migrate",
  );
  process.exitCode = 1;
}
