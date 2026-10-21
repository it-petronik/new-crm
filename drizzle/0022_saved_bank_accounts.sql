CREATE TABLE SavedBankAccount (
  id TEXT PRIMARY KEY NOT NULL,
  company TEXT NOT NULL,
  label TEXT NOT NULL,
  currency TEXT NOT NULL,
  details TEXT NOT NULL,
  createdBy TEXT NOT NULL REFERENCES User(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  updatedAt INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX SavedBankAccount_company ON SavedBankAccount(company);
