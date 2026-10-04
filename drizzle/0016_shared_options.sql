-- Additive vocabulary registry. Records keep their saved text snapshots.
CREATE TABLE "SharedOption" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "company" TEXT NOT NULL,
  "catalog" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "normalized" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "User"("id"),
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" INTEGER NOT NULL
);
CREATE UNIQUE INDEX "SharedOption_scope_key" ON "SharedOption" ("company", "catalog", "normalized");
