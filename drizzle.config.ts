import type { Config } from "drizzle-kit";

/** D1 migrations live separately from the retained Prisma MySQL migrations. */
export default {
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  driver: "d1-http",
} satisfies Config;
