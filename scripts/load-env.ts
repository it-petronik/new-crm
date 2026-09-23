import { existsSync, readFileSync } from "node:fs";

/**
 * Loads .env into process.env for standalone scripts. The Prisma CLI does this
 * automatically but tsx does not, so db:check and db:bootstrap need it to see
 * the same configuration as db:migrate. Variables already set win, so an
 * explicit DATABASE_URL on the command line still overrides the file.
 */
export function loadEnv(file = ".env") {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length > 1) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
