CREATE TABLE "HrRevision" ("id" INTEGER PRIMARY KEY CHECK ("id" = 1), "revision" INTEGER NOT NULL DEFAULT 0, "token" TEXT NOT NULL DEFAULT '');
INSERT INTO "HrRevision" ("id", "revision", "token") VALUES (1, 0, '');
CREATE TABLE "HrEntry" (
 "id" TEXT PRIMARY KEY NOT NULL, "recordKey" TEXT NOT NULL UNIQUE,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('employment','attendance','compensation','bonus','review','probation','payroll','document')),
 "employeeId" TEXT REFERENCES "BusinessRecord"("id") ON DELETE RESTRICT,
 "company" TEXT NOT NULL, "branch" TEXT NOT NULL,
 "status" TEXT NOT NULL CHECK ("status" IN ('Recorded','Draft','Submitted','Approved','Rejected','Paid','Archived')),
 "payload" TEXT NOT NULL CHECK (json_valid("payload")),
 "createdBy" TEXT NOT NULL REFERENCES "User"("id"), "preparedBy" TEXT NOT NULL REFERENCES "User"("id"), "approvedBy" TEXT REFERENCES "User"("id"),
 "version" INTEGER NOT NULL DEFAULT 1, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL
);
CREATE INDEX "HrEntry_scope" ON "HrEntry"("company", "branch", "kind");
CREATE INDEX "HrEntry_employee" ON "HrEntry"("employeeId", "kind");
CREATE UNIQUE INDEX "HrEntry_approved_salary_date" ON "HrEntry"("employeeId", json_extract("payload", '$.effectiveDate')) WHERE "kind" = 'compensation' AND "status" = 'Approved';
CREATE TABLE "HrFile" (
 "id" TEXT PRIMARY KEY NOT NULL, "entryId" TEXT NOT NULL REFERENCES "HrEntry"("id") ON DELETE RESTRICT,
 "storageKey" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "mime" TEXT NOT NULL,
 "size" INTEGER NOT NULL CHECK ("size" > 0 AND "size" <= 10485760), "sha256" TEXT NOT NULL,
 "createdBy" TEXT NOT NULL REFERENCES "User"("id"), "createdAt" INTEGER NOT NULL
);
CREATE INDEX "HrFile_entry" ON "HrFile"("entryId", "createdAt");
CREATE TABLE "HrHistory" (
 "id" TEXT PRIMARY KEY NOT NULL, "entryId" TEXT NOT NULL REFERENCES "HrEntry"("id"),
 "company" TEXT NOT NULL, "branch" TEXT NOT NULL, "actorId" TEXT NOT NULL REFERENCES "User"("id"), "actorName" TEXT NOT NULL,
 "action" TEXT NOT NULL, "reason" TEXT NOT NULL DEFAULT '', "before" TEXT, "after" TEXT, "at" INTEGER NOT NULL
);
CREATE INDEX "HrHistory_entry" ON "HrHistory"("entryId", "at");
CREATE TRIGGER "HrEntry_no_delete" BEFORE DELETE ON "HrEntry" BEGIN SELECT RAISE(ABORT, 'HR history must be retained'); END;
CREATE TRIGGER "HrEntry_final_locked" BEFORE UPDATE ON "HrEntry"
 WHEN OLD."status" IN ('Approved','Paid') AND (NEW."payload" != OLD."payload" OR NEW."employeeId" IS NOT OLD."employeeId" OR NEW."kind" != OLD."kind" OR NEW."company" != OLD."company" OR NEW."branch" != OLD."branch" OR (OLD."status" = 'Approved' AND NEW."status" NOT IN ('Approved','Paid')) OR (OLD."status" = 'Paid' AND NEW."status" != 'Paid'))
 BEGIN SELECT RAISE(ABORT, 'Approved HR records are locked'); END;
CREATE TRIGGER "HrFile_no_delete" BEFORE DELETE ON "HrFile" BEGIN SELECT RAISE(ABORT, 'HR files must be retained'); END;
CREATE TRIGGER "HrHistory_no_update" BEFORE UPDATE ON "HrHistory" BEGIN SELECT RAISE(ABORT, 'HR audit history is immutable'); END;
CREATE TRIGGER "HrHistory_no_delete" BEFORE DELETE ON "HrHistory" BEGIN SELECT RAISE(ABORT, 'HR audit history is immutable'); END;
CREATE TRIGGER "HrEmployee_scope_locked" BEFORE UPDATE ON "BusinessRecord"
 WHEN OLD."kind" = 'hr' AND EXISTS(SELECT 1 FROM "HrEntry" WHERE "employeeId" = OLD."id") AND (NEW."company" != OLD."company" OR NEW."branch" != OLD."branch" OR json_extract(NEW."payload", '$.deletedAt') IS NOT NULL)
 BEGIN SELECT RAISE(ABORT, 'Employee has HR history; keep its company and record'); END;
