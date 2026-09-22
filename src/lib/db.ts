import { PrismaClient } from "@prisma/client";
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalDb.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalDb.prisma = db;
export function isPreview() {
  return (
    process.env.APP_MODE === "preview" ||
    (process.env.NODE_ENV !== "production" && !process.env.DATABASE_URL)
  );
}
