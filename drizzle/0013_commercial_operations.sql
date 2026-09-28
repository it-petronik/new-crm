CREATE TABLE Contact (id TEXT PRIMARY KEY NOT NULL, parentId TEXT NOT NULL REFERENCES BusinessRecord(id) ON DELETE RESTRICT, company TEXT NOT NULL, branch TEXT NOT NULL, details TEXT NOT NULL CHECK(json_valid(details)), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE INDEX Contact_parent_idx ON Contact(parentId);
CREATE INDEX Contact_scope_idx ON Contact(company,branch);
CREATE TABLE Deal (id TEXT PRIMARY KEY NOT NULL, leadId TEXT NOT NULL REFERENCES BusinessRecord(id) ON DELETE RESTRICT, company TEXT NOT NULL, branch TEXT NOT NULL, createdAt INTEGER NOT NULL);
CREATE UNIQUE INDEX Deal_lead_idx ON Deal(leadId);
CREATE INDEX Deal_scope_idx ON Deal(company,branch);
CREATE TABLE SupplierProductCapability (id TEXT PRIMARY KEY NOT NULL, supplierId TEXT NOT NULL REFERENCES BusinessRecord(id) ON DELETE RESTRICT, productId TEXT NOT NULL REFERENCES BusinessRecord(id) ON DELETE RESTRICT, company TEXT NOT NULL, branch TEXT NOT NULL, details TEXT NOT NULL CHECK(json_valid(details)), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE INDEX Capability_supplier_idx ON SupplierProductCapability(supplierId);
CREATE INDEX Capability_product_active_idx ON SupplierProductCapability(productId,active);
--> statement-breakpoint
CREATE INDEX BusinessRecord_customerId_idx ON BusinessRecord(json_extract(payload,'$.customerId'),company,branch,kind);
--> statement-breakpoint
CREATE INDEX BusinessRecord_productId_idx ON BusinessRecord(json_extract(payload,'$.productId'),company,branch,kind);
--> statement-breakpoint
CREATE INDEX BusinessRecord_dealId_idx ON BusinessRecord(json_extract(payload,'$.dealId'),company,branch,kind);
--> statement-breakpoint
CREATE INDEX BusinessRecord_parentId_idx ON BusinessRecord(json_extract(payload,'$.parentId'),company,branch,kind);
--> statement-breakpoint
CREATE TRIGGER Contact_insert_guard BEFORE INSERT ON Contact BEGIN
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM BusinessRecord WHERE id=NEW.parentId AND kind IN ('customers','suppliers') AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_parent_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER Contact_update_guard BEFORE UPDATE ON Contact BEGIN
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM BusinessRecord WHERE id=NEW.parentId AND kind IN ('customers','suppliers') AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_parent_invalid') END;
SELECT CASE WHEN NEW.parentId <> OLD.parentId OR NEW.company <> OLD.company OR NEW.branch <> OLD.branch THEN RAISE(ABORT,'commercial_parent_immutable') END;
END;
--> statement-breakpoint
CREATE TRIGGER Deal_insert_guard BEFORE INSERT ON Deal BEGIN
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM BusinessRecord WHERE id=NEW.leadId AND kind = 'leads' AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_parent_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER Deal_update_guard BEFORE UPDATE ON Deal BEGIN
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM BusinessRecord WHERE id=NEW.leadId AND kind = 'leads' AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_parent_invalid') END;
SELECT CASE WHEN NEW.leadId <> OLD.leadId OR NEW.company <> OLD.company OR NEW.branch <> OLD.branch THEN RAISE(ABORT,'commercial_parent_immutable') END;
END;
--> statement-breakpoint
CREATE TRIGGER SupplierProductCapability_insert_guard BEFORE INSERT ON SupplierProductCapability BEGIN
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM BusinessRecord WHERE id=NEW.supplierId AND kind = 'suppliers' AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_parent_invalid') END;
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM BusinessRecord WHERE id=NEW.productId AND kind = 'products' AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_parent_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER SupplierProductCapability_update_guard BEFORE UPDATE ON SupplierProductCapability BEGIN
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM BusinessRecord WHERE id=NEW.supplierId AND kind = 'suppliers' AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_parent_invalid') END;
SELECT CASE WHEN NEW.supplierId <> OLD.supplierId OR NEW.company <> OLD.company OR NEW.branch <> OLD.branch THEN RAISE(ABORT,'commercial_parent_immutable') END;
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM BusinessRecord WHERE id=NEW.productId AND kind = 'products' AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_parent_invalid') END;
SELECT CASE WHEN NEW.productId <> OLD.productId OR NEW.company <> OLD.company OR NEW.branch <> OLD.branch THEN RAISE(ABORT,'commercial_parent_immutable') END;
END;
--> statement-breakpoint
CREATE TRIGGER BusinessRecord_insert_commercial BEFORE INSERT ON BusinessRecord BEGIN
SELECT CASE WHEN json_extract(NEW.payload,'$.customerId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM BusinessRecord WHERE id=json_extract(NEW.payload,'$.customerId') AND kind='customers' AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_link_invalid') END;
SELECT CASE WHEN json_extract(NEW.payload,'$.productId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM BusinessRecord WHERE id=json_extract(NEW.payload,'$.productId') AND kind='products' AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_link_invalid') END;
SELECT CASE WHEN json_extract(NEW.payload,'$.contactId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Contact WHERE id=json_extract(NEW.payload,'$.contactId') AND parentId=json_extract(NEW.payload,'$.customerId') AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_contact_invalid') END;
SELECT CASE WHEN json_extract(NEW.payload,'$.primaryContactId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Contact WHERE id=json_extract(NEW.payload,'$.primaryContactId') AND parentId=NEW.id AND active=1) THEN RAISE(ABORT,'commercial_primary_invalid') END;
SELECT CASE WHEN json_extract(NEW.payload,'$.dealId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Deal WHERE id=json_extract(NEW.payload,'$.dealId') AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_deal_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER BusinessRecord_update_commercial BEFORE UPDATE ON BusinessRecord BEGIN
SELECT CASE WHEN json_extract(NEW.payload,'$.customerId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM BusinessRecord WHERE id=json_extract(NEW.payload,'$.customerId') AND kind='customers' AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_link_invalid') END;
SELECT CASE WHEN json_extract(NEW.payload,'$.productId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM BusinessRecord WHERE id=json_extract(NEW.payload,'$.productId') AND kind='products' AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_link_invalid') END;
SELECT CASE WHEN json_extract(NEW.payload,'$.contactId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Contact WHERE id=json_extract(NEW.payload,'$.contactId') AND parentId=json_extract(NEW.payload,'$.customerId') AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_contact_invalid') END;
SELECT CASE WHEN json_extract(NEW.payload,'$.primaryContactId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Contact WHERE id=json_extract(NEW.payload,'$.primaryContactId') AND parentId=NEW.id AND active=1) THEN RAISE(ABORT,'commercial_primary_invalid') END;
SELECT CASE WHEN json_extract(NEW.payload,'$.dealId') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Deal WHERE id=json_extract(NEW.payload,'$.dealId') AND company=NEW.company AND branch=NEW.branch) THEN RAISE(ABORT,'commercial_deal_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER Contact_deactivate_primary AFTER UPDATE OF active ON Contact WHEN NEW.active=0 AND OLD.active=1 BEGIN
UPDATE BusinessRecord SET payload=json_set(payload,'$.primaryContactId',NULL,'$.updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')),version=version+1,updatedAt=NEW.updatedAt WHERE id=NEW.parentId AND json_extract(payload,'$.primaryContactId')=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER BusinessRecord_delete_commercial BEFORE DELETE ON BusinessRecord WHEN EXISTS (SELECT 1 FROM BusinessRecord WHERE json_extract(payload,'$.customerId')=OLD.id OR json_extract(payload,'$.productId')=OLD.id) BEGIN SELECT RAISE(ABORT,'commercial_history_retained'); END;

--> statement-breakpoint
CREATE TRIGGER Contact_delete_history BEFORE DELETE ON Contact WHEN EXISTS (SELECT 1 FROM BusinessRecord WHERE json_extract(payload,'$.contactId')=OLD.id OR json_extract(payload,'$.primaryContactId')=OLD.id) BEGIN SELECT RAISE(ABORT,'commercial_history_retained'); END;
--> statement-breakpoint
CREATE TRIGGER BusinessRecord_contact_active_insert BEFORE INSERT ON BusinessRecord WHEN json_extract(NEW.payload,'$.contactId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM Contact WHERE id=json_extract(NEW.payload,'$.contactId') AND active=1) AND NOT (NEW.kind IN ('orders','logistics','accounts') AND EXISTS(SELECT 1 FROM BusinessRecord WHERE id=json_extract(NEW.payload,'$.parentId') AND json_extract(payload,'$.contactId')=json_extract(NEW.payload,'$.contactId'))) BEGIN SELECT RAISE(ABORT,'commercial_contact_inactive'); END;
--> statement-breakpoint
CREATE TRIGGER BusinessRecord_contact_active_update BEFORE UPDATE OF payload ON BusinessRecord WHEN json_extract(NEW.payload,'$.contactId') IS NOT NULL AND json_extract(NEW.payload,'$.contactId') IS NOT json_extract(OLD.payload,'$.contactId') AND NOT EXISTS(SELECT 1 FROM Contact WHERE id=json_extract(NEW.payload,'$.contactId') AND active=1) BEGIN SELECT RAISE(ABORT,'commercial_contact_inactive'); END;
