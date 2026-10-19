CREATE TABLE CommunicationTemplate (
 id TEXT PRIMARY KEY, company TEXT NOT NULL, name TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('email','whatsapp')),
 subject TEXT NOT NULL, body TEXT NOT NULL, createdBy TEXT NOT NULL REFERENCES User(id),
 version INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)), createdAt INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX CommunicationTemplate_company ON CommunicationTemplate(company,archived);
--> statement-breakpoint
CREATE TABLE OutboundMessage (
 id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES User(id), recordId TEXT NOT NULL REFERENCES BusinessRecord(id),
 company TEXT NOT NULL, branch TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('email','whatsapp')),
 recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
 templateId TEXT REFERENCES CommunicationTemplate(id),
 status TEXT NOT NULL CHECK(status IN ('draft','scheduled','ready','sending','accepted','captured','uncertain','rejected','cancelled')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), scheduledAt INTEGER,
 createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, providerId TEXT, consent TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX OutboundMessage_owner ON OutboundMessage(ownerId,updatedAt DESC);
--> statement-breakpoint
CREATE TABLE OutboundEvent (
 id TEXT PRIMARY KEY, messageId TEXT NOT NULL REFERENCES OutboundMessage(id), action TEXT NOT NULL, at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX OutboundEvent_message ON OutboundEvent(messageId,at);
--> statement-breakpoint
CREATE TRIGGER OutboundMessage_insert BEFORE INSERT ON OutboundMessage
WHEN NEW.status!='draft' OR NEW.version!=1
 OR NOT EXISTS(SELECT 1 FROM BusinessRecord r WHERE r.id=NEW.recordId AND r.company=NEW.company AND r.branch=NEW.branch AND json_extract(r.payload,'$.deletedAt') IS NULL)
 OR (NEW.templateId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM CommunicationTemplate t WHERE t.id=NEW.templateId AND t.company=NEW.company AND t.channel=NEW.channel AND t.archived=0))
BEGIN SELECT RAISE(ABORT,'Invalid communication scope'); END;
--> statement-breakpoint
CREATE TRIGGER OutboundMessage_rate BEFORE UPDATE OF status ON OutboundMessage
WHEN NEW.status='sending' AND (length(trim(NEW.consent))<8 OR (SELECT count(*) FROM OutboundMessage WHERE ownerId=NEW.ownerId AND status IN ('sending','accepted','captured','uncertain','rejected') AND updatedAt>NEW.updatedAt-3600000)>=20)
BEGIN SELECT RAISE(ABORT,'Communication confirmation or hourly limit'); END;
--> statement-breakpoint
CREATE TRIGGER CommunicationTemplate_guard BEFORE UPDATE ON CommunicationTemplate
WHEN NEW.id!=OLD.id OR NEW.company!=OLD.company OR NEW.name!=OLD.name OR NEW.channel!=OLD.channel OR NEW.subject!=OLD.subject OR NEW.body!=OLD.body OR NEW.createdBy!=OLD.createdBy OR NEW.createdAt!=OLD.createdAt OR OLD.archived!=0 OR NEW.archived!=1 OR NEW.version!=OLD.version+1
BEGIN SELECT RAISE(ABORT,'Create a new template revision instead'); END;
--> statement-breakpoint
CREATE TRIGGER CommunicationTemplate_no_delete BEFORE DELETE ON CommunicationTemplate BEGIN SELECT RAISE(ABORT,'Archive templates instead'); END;
--> statement-breakpoint
CREATE TRIGGER OutboundEvent_no_update BEFORE UPDATE ON OutboundEvent BEGIN SELECT RAISE(ABORT,'Communication history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER OutboundEvent_no_delete BEFORE DELETE ON OutboundEvent BEGIN SELECT RAISE(ABORT,'Communication history is retained'); END;
--> statement-breakpoint
CREATE TRIGGER OutboundMessage_no_delete BEFORE DELETE ON OutboundMessage BEGIN SELECT RAISE(ABORT,'Communication history is retained'); END;
--> statement-breakpoint
CREATE TRIGGER OutboundMessage_guard BEFORE UPDATE ON OutboundMessage
WHEN NEW.id!=OLD.id OR NEW.ownerId!=OLD.ownerId OR NEW.recordId!=OLD.recordId OR NEW.company!=OLD.company OR NEW.branch!=OLD.branch OR NEW.channel!=OLD.channel OR NEW.recipient!=OLD.recipient OR NEW.templateId IS NOT OLD.templateId OR NEW.createdAt!=OLD.createdAt
 OR NEW.version!=OLD.version+1
 OR (OLD.status NOT IN ('draft','scheduled','ready') AND (NEW.body!=OLD.body OR NEW.subject!=OLD.subject))
 OR NOT (
   (OLD.status IN ('draft','scheduled','ready') AND NEW.status IN ('draft','scheduled','ready','cancelled'))
   OR (OLD.status='ready' AND NEW.status='sending')
   OR (OLD.status='sending' AND NEW.status IN ('accepted','captured','uncertain','rejected'))
 )
BEGIN SELECT RAISE(ABORT,'Invalid communication transition'); END;
