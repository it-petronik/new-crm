import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type { HrEntry } from "./model";

export const hrEntries = sqliteTable("HrEntry", {
  id: text().primaryKey(),
  recordKey: text().notNull(),
  kind: text().notNull(),
  employeeId: text(),
  company: text().notNull(),
  branch: text().notNull(),
  status: text().notNull(),
  payload: text({ mode: "json" }).$type<HrEntry["payload"]>().notNull(),
  createdBy: text().notNull(),
  preparedBy: text().notNull(),
  approvedBy: text(),
  version: integer().notNull(),
  createdAt: integer().notNull(),
  updatedAt: integer().notNull(),
});
export const hrFiles = sqliteTable("HrFile", {
  id: text().primaryKey(),
  entryId: text().notNull(),
  storageKey: text().notNull(),
  name: text().notNull(),
  mime: text().notNull(),
  size: integer().notNull(),
  sha256: text().notNull(),
  createdBy: text().notNull(),
  createdAt: integer().notNull(),
});
export const hrHistory = sqliteTable("HrHistory", {
  id: text().primaryKey(),
  entryId: text().notNull(),
  company: text().notNull(),
  branch: text().notNull(),
  actorId: text().notNull(),
  actorName: text().notNull(),
  action: text().notNull(),
  reason: text().notNull(),
  before: text({ mode: "json" }).$type<unknown>(),
  after: text({ mode: "json" }).$type<unknown>(),
  at: integer().notNull(),
});
export const hrRevision = sqliteTable("HrRevision", {
  id: integer().primaryKey(),
  revision: integer().notNull(),
  token: text().notNull(),
});
