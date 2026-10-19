ALTER TABLE MailboxConnection ADD COLUMN folderState TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE MailboxConnection ADD COLUMN folderLeaseAt INTEGER;
--> statement-breakpoint
CREATE TABLE MailboxRemoteMessage (
 id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
 connectionId TEXT NOT NULL REFERENCES MailboxConnection(id) ON DELETE CASCADE,
 folder TEXT NOT NULL CHECK(folder IN ('drafts','sent')), path TEXT NOT NULL,
 uid INTEGER NOT NULL, uidValidity TEXT NOT NULL, sender TEXT NOT NULL,
 recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
 receivedAt INTEGER NOT NULL,isRead INTEGER NOT NULL DEFAULT 0,
 UNIQUE(connectionId,path,uidValidity,uid)
);
--> statement-breakpoint
CREATE INDEX MailboxRemoteMessage_owner ON MailboxRemoteMessage(ownerId,folder,receivedAt DESC);
--> statement-breakpoint
CREATE TRIGGER MailboxRemoteMessage_scope BEFORE INSERT ON MailboxRemoteMessage
WHEN NOT EXISTS(SELECT 1 FROM MailboxConnection WHERE id=NEW.connectionId AND ownerId=NEW.ownerId)
BEGIN SELECT RAISE(ABORT,'Private mailbox owner mismatch'); END;
