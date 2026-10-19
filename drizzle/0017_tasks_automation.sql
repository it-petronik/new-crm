-- Phase 8: internal tasks and configurable task automation. Additive only:
-- no existing table, column, index or trigger is changed, and no row is
-- written. Automation rules start disabled and are created by people.

-- One rule per preset per company. The preset fixes the trigger; people
-- choose conditions, an explicit assignee (lead follow-ups go to the lead's
-- owner), the due date offset and time, and whether it is enabled.
CREATE TABLE "AutomationRule" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "company" TEXT NOT NULL,
  "name" TEXT NOT NULL CHECK (length("name") BETWEEN 2 AND 120),
  "preset" TEXT NOT NULL CHECK ("preset" IN ('lead_follow_up', 'it_ticket_triage', 'quotation_handoff')),
  "enabled" INTEGER NOT NULL DEFAULT 0 CHECK ("enabled" IN (0, 1)),
  "conditions" TEXT NOT NULL DEFAULT '{}',
  "assigneeId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT,
  "dueDays" INTEGER NOT NULL DEFAULT 0 CHECK ("dueDays" BETWEEN 0 AND 30),
  "dueTime" TEXT CHECK ("dueTime" IS NULL OR "dueTime" GLOB '[0-2][0-9]:[0-5][0-9]'),
  "priority" TEXT NOT NULL DEFAULT 'normal' CHECK ("priority" IN ('low', 'normal', 'high', 'urgent')),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "updatedBy" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  -- Only the lead preset may assign by record owner; the others need a person.
  CHECK ("preset" = 'lead_follow_up' OR "assigneeId" IS NOT NULL OR "enabled" = 0)
);
CREATE UNIQUE INDEX "AutomationRule_company_preset_key" ON "AutomationRule" ("company", "preset");

CREATE TABLE "Task" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "company" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "title" TEXT NOT NULL CHECK (length("title") BETWEEN 2 AND 160),
  "description" TEXT NOT NULL DEFAULT '',
  "assigneeId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "createdBy" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "priority" TEXT NOT NULL DEFAULT 'normal' CHECK ("priority" IN ('low', 'normal', 'high', 'urgent')),
  "status" TEXT NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'in_progress', 'completed', 'cancelled')),
  "dueDate" TEXT NOT NULL CHECK ("dueDate" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  "dueTime" TEXT CHECK ("dueTime" IS NULL OR "dueTime" GLOB '[0-2][0-9]:[0-5][0-9]'),
  "linkedRecordId" TEXT REFERENCES "BusinessRecord"("id") ON DELETE RESTRICT,
  "ruleId" TEXT REFERENCES "AutomationRule"("id") ON DELETE RESTRICT,
  -- Set only for automation: one task per rule and triggering condition.
  "dedupeKey" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  "completedAt" INTEGER,
  CHECK (("status" = 'completed') = ("completedAt" IS NOT NULL)),
  CHECK (("ruleId" IS NULL) = ("dedupeKey" IS NULL))
);
CREATE UNIQUE INDEX "Task_dedupeKey_key" ON "Task" ("dedupeKey") WHERE "dedupeKey" IS NOT NULL;
CREATE INDEX "Task_assignee_status_due_idx" ON "Task" ("assigneeId", "status", "dueDate");
CREATE INDEX "Task_scope_due_idx" ON "Task" ("company", "branch", "dueDate");
CREATE INDEX "Task_linkedRecord_idx" ON "Task" ("linkedRecordId");
CREATE INDEX "Task_createdBy_idx" ON "Task" ("createdBy");

-- What each rule did with each triggering condition: one row per
-- (rule, condition), so a repeated scheduled run or replayed event adds none.
CREATE TABLE "AutomationRun" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "ruleId" TEXT NOT NULL REFERENCES "AutomationRule"("id") ON DELETE RESTRICT,
  "company" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "recordId" TEXT REFERENCES "BusinessRecord"("id") ON DELETE RESTRICT,
  "taskId" TEXT REFERENCES "Task"("id") ON DELETE RESTRICT,
  "status" TEXT NOT NULL CHECK ("status" IN ('success', 'skipped', 'failed')),
  "message" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  CHECK (("status" = 'success') = ("taskId" IS NOT NULL))
);
CREATE UNIQUE INDEX "AutomationRun_rule_key" ON "AutomationRun" ("ruleId", "dedupeKey");
CREATE INDEX "AutomationRun_company_at_idx" ON "AutomationRun" ("company", "createdAt");

-- Outbox: written in the same batch as the business change that raised it,
-- processed after commit and by the scheduled sweep. The id is derived from
-- the trigger and record, so a replayed change cannot enqueue it twice.
CREATE TABLE "AutomationEvent" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "company" TEXT NOT NULL,
  "trigger" TEXT NOT NULL CHECK ("trigger" IN ('RECORD_CREATED', 'STATUS_CHANGED')),
  "recordId" TEXT NOT NULL REFERENCES "BusinessRecord"("id") ON DELETE RESTRICT,
  "data" TEXT NOT NULL DEFAULT '{}',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" INTEGER NOT NULL,
  "processedAt" INTEGER
);
CREATE INDEX "AutomationEvent_pending_idx" ON "AutomationEvent" ("processedAt", "createdAt");

-- A task, its rule and its linked record always share one company (and the
-- record's branch). Company and branch never change on a BusinessRecord.
CREATE TRIGGER "Task_scope_insert" BEFORE INSERT ON "Task"
WHEN (NEW."linkedRecordId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "BusinessRecord" r WHERE r."id" = NEW."linkedRecordId" AND r."company" = NEW."company" AND r."branch" = NEW."branch"))
  OR (NEW."ruleId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "AutomationRule" a WHERE a."id" = NEW."ruleId" AND a."company" = NEW."company"))
BEGIN
  SELECT RAISE(ABORT, 'task_scope_invalid');
END;
CREATE TRIGGER "Task_scope_update" BEFORE UPDATE OF "company", "branch", "linkedRecordId", "ruleId" ON "Task"
WHEN (NEW."linkedRecordId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "BusinessRecord" r WHERE r."id" = NEW."linkedRecordId" AND r."company" = NEW."company" AND r."branch" = NEW."branch"))
  OR (NEW."ruleId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "AutomationRule" a WHERE a."id" = NEW."ruleId" AND a."company" = NEW."company"))
BEGIN
  SELECT RAISE(ABORT, 'task_scope_invalid');
END;
CREATE TRIGGER "AutomationRun_scope_insert" BEFORE INSERT ON "AutomationRun"
WHEN NOT EXISTS (SELECT 1 FROM "AutomationRule" a WHERE a."id" = NEW."ruleId" AND a."company" = NEW."company")
  OR (NEW."taskId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "Task" t WHERE t."id" = NEW."taskId" AND t."company" = NEW."company" AND t."ruleId" = NEW."ruleId"))
  OR (NEW."recordId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "BusinessRecord" r WHERE r."id" = NEW."recordId" AND r."company" = NEW."company"))
BEGIN
  SELECT RAISE(ABORT, 'automation_run_scope_invalid');
END;
CREATE TRIGGER "AutomationRun_scope_update" BEFORE UPDATE OF "ruleId", "company", "taskId", "recordId" ON "AutomationRun"
WHEN NOT EXISTS (SELECT 1 FROM "AutomationRule" a WHERE a."id" = NEW."ruleId" AND a."company" = NEW."company")
  OR (NEW."taskId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "Task" t WHERE t."id" = NEW."taskId" AND t."company" = NEW."company" AND t."ruleId" = NEW."ruleId"))
  OR (NEW."recordId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "BusinessRecord" r WHERE r."id" = NEW."recordId" AND r."company" = NEW."company"))
BEGIN
  SELECT RAISE(ABORT, 'automation_run_scope_invalid');
END;
-- A rule cannot move to another company while its tasks or runs remain.
CREATE TRIGGER "AutomationRule_company_update" BEFORE UPDATE OF "company" ON "AutomationRule"
WHEN NEW."company" <> OLD."company"
BEGIN
  SELECT RAISE(ABORT, 'automation_rule_company_fixed');
END;
