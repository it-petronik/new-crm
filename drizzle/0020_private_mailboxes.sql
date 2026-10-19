CREATE TABLE MailboxConnection (
 ownerId TEXT PRIMARY KEY REFERENCES User(id) ON DELETE CASCADE,
 id TEXT NOT NULL UNIQUE, address TEXT NOT NULL, host TEXT NOT NULL, passwordSeal TEXT NOT NULL,
 createdAt INTEGER NOT NULL, lastSyncAt INTEGER, lastAttemptAt INTEGER,
 uidValidity TEXT NOT NULL DEFAULT '', lastUid INTEGER NOT NULL DEFAULT 0,
 syncLease TEXT, syncLeaseAt INTEGER, lastError TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)
);
--> statement-breakpoint
CREATE TABLE MailboxMessage (
 id TEXT PRIMARY KEY, connectionId TEXT NOT NULL REFERENCES MailboxConnection(id) ON DELETE CASCADE,
 ownerId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE, uid INTEGER NOT NULL,
 uidValidity TEXT NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL,
 subject TEXT NOT NULL, body TEXT NOT NULL, receivedAt INTEGER NOT NULL,
 isRead INTEGER NOT NULL DEFAULT 0 CHECK(isRead IN (0,1)),
 candidate INTEGER NOT NULL DEFAULT 0 CHECK(candidate IN (0,1)),
 truncated INTEGER NOT NULL DEFAULT 0 CHECK(truncated IN (0,1)),
 UNIQUE(connectionId,uidValidity,uid)
);
--> statement-breakpoint
CREATE INDEX MailboxMessage_owner_date ON MailboxMessage(ownerId,receivedAt DESC);
--> statement-breakpoint
CREATE TRIGGER MailboxMessage_scope BEFORE INSERT ON MailboxMessage
WHEN NOT EXISTS(SELECT 1 FROM MailboxConnection c WHERE c.id=NEW.connectionId AND c.ownerId=NEW.ownerId)
BEGIN SELECT RAISE(ABORT,'Private mailbox owner mismatch'); END;
--> statement-breakpoint
CREATE TABLE MailboxConnectAttempt (
 ownerId TEXT PRIMARY KEY REFERENCES User(id) ON DELETE CASCADE,
 startedAt INTEGER NOT NULL, attempts INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE MailboxDraft (
 id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
 connectionId TEXT NOT NULL REFERENCES MailboxConnection(id) ON DELETE CASCADE,
 recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','sending','accepted','captured','uncertain','rejected')),
 version INTEGER NOT NULL DEFAULT 1, updatedAt INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX MailboxDraft_owner ON MailboxDraft(ownerId,updatedAt DESC);
--> statement-breakpoint
CREATE TRIGGER MailboxDraft_scope BEFORE INSERT ON MailboxDraft
WHEN NOT EXISTS(SELECT 1 FROM MailboxConnection WHERE id=NEW.connectionId AND ownerId=NEW.ownerId)
BEGIN SELECT RAISE(ABORT,'Private mailbox owner mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER MailboxDraft_identity BEFORE UPDATE ON MailboxDraft
WHEN NEW.ownerId!=OLD.ownerId OR NEW.connectionId!=OLD.connectionId OR NEW.id!=OLD.id
BEGIN SELECT RAISE(ABORT,'Private mailbox identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER MailboxDraft_submitted BEFORE UPDATE ON MailboxDraft
WHEN OLD.status!='draft' AND (NEW.recipient!=OLD.recipient OR NEW.subject!=OLD.subject OR NEW.body!=OLD.body OR NEW.status='draft' OR NEW.status='sending' OR OLD.status!='sending')
BEGIN SELECT RAISE(ABORT,'Submitted email is immutable'); END;
