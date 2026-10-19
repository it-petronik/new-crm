import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
// Migration 0019 owns the checks, references, indexes and immutable guards.
export const communicationTemplates = sqliteTable("CommunicationTemplate", {
  id: text().primaryKey(),
  company: text().notNull(),
  name: text().notNull(),
  channel: text().notNull(),
  subject: text().notNull(),
  body: text().notNull(),
  createdBy: text().notNull(),
  version: integer().notNull(),
  archived: integer().notNull(),
  createdAt: integer().notNull(),
});
export const outboundMessages = sqliteTable("OutboundMessage", {
  id: text().primaryKey(),
  ownerId: text().notNull(),
  recordId: text().notNull(),
  company: text().notNull(),
  branch: text().notNull(),
  channel: text().notNull(),
  recipient: text().notNull(),
  subject: text().notNull(),
  body: text().notNull(),
  templateId: text(),
  status: text().notNull(),
  version: integer().notNull(),
  scheduledAt: integer(),
  createdAt: integer().notNull(),
  updatedAt: integer().notNull(),
  providerId: text(),
  consent: text().notNull(),
});
export const outboundEvents = sqliteTable("OutboundEvent", {
  id: text().primaryKey(),
  messageId: text().notNull(),
  action: text().notNull(),
  at: integer().notNull(),
});
