CREATE TABLE DealSupplier (id TEXT PRIMARY KEY NOT NULL, dealId TEXT NOT NULL REFERENCES Deal(id) ON DELETE RESTRICT, supplierId TEXT NOT NULL REFERENCES BusinessRecord(id) ON DELETE RESTRICT, productId TEXT NOT NULL REFERENCES BusinessRecord(id) ON DELETE RESTRICT, company TEXT NOT NULL, branch TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), createdBy TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, CHECK(status IN ('Candidate','No response','Declined','Removed')));

--> statement-breakpoint
CREATE INDEX DealSupplier_scope ON DealSupplier(company,branch,dealId);

--> statement-breakpoint
CREATE INDEX DealSupplier_supplier_product ON DealSupplier(supplierId,productId);

--> statement-breakpoint
CREATE TRIGGER DealSupplier_insert_guard BEFORE INSERT ON DealSupplier BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM Deal d WHERE d.id=NEW.dealId AND d.company=NEW.company AND d.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.supplierId AND b.kind='suppliers' AND b.company=NEW.company AND b.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.productId AND b.kind='products' AND b.company=NEW.company AND b.branch=NEW.branch) THEN RAISE(ABORT,'execution_scope') END);

 END;

--> statement-breakpoint
CREATE TRIGGER DealSupplier_update_guard BEFORE UPDATE ON DealSupplier BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM Deal d WHERE d.id=NEW.dealId AND d.company=NEW.company AND d.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.supplierId AND b.kind='suppliers' AND b.company=NEW.company AND b.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.productId AND b.kind='products' AND b.company=NEW.company AND b.branch=NEW.branch) THEN RAISE(ABORT,'execution_scope') END);
 SELECT (CASE WHEN NEW.dealId IS NOT OLD.dealId OR NEW.supplierId IS NOT OLD.supplierId OR NEW.productId IS NOT OLD.productId OR NEW.company IS NOT OLD.company OR NEW.branch IS NOT OLD.branch OR NEW.createdBy IS NOT OLD.createdBy OR NEW.createdAt IS NOT OLD.createdAt THEN RAISE(ABORT,'execution_identity_immutable') END);
 END;

--> statement-breakpoint
CREATE TRIGGER DealSupplier_retain BEFORE DELETE ON DealSupplier BEGIN SELECT RAISE(ABORT,'execution_history_retained'); END;

--> statement-breakpoint
CREATE TABLE SupplierRFQ (id TEXT PRIMARY KEY NOT NULL, dealId TEXT NOT NULL REFERENCES Deal(id) ON DELETE RESTRICT, supplierId TEXT NOT NULL REFERENCES BusinessRecord(id) ON DELETE RESTRICT, productId TEXT NOT NULL REFERENCES BusinessRecord(id) ON DELETE RESTRICT, company TEXT NOT NULL, branch TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), createdBy TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, details TEXT NOT NULL CHECK(json_valid(details)), CHECK(status IN ('Draft','Prepared','Sent externally','Responded','Closed')));

--> statement-breakpoint
CREATE INDEX SupplierRFQ_scope ON SupplierRFQ(company,branch,dealId);

--> statement-breakpoint
CREATE INDEX SupplierRFQ_supplier_product ON SupplierRFQ(supplierId,productId);

--> statement-breakpoint
CREATE TRIGGER SupplierRFQ_insert_guard BEFORE INSERT ON SupplierRFQ BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM Deal d WHERE d.id=NEW.dealId AND d.company=NEW.company AND d.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.supplierId AND b.kind='suppliers' AND b.company=NEW.company AND b.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.productId AND b.kind='products' AND b.company=NEW.company AND b.branch=NEW.branch) THEN RAISE(ABORT,'execution_scope') END);

 END;

--> statement-breakpoint
CREATE TRIGGER SupplierRFQ_update_guard BEFORE UPDATE ON SupplierRFQ BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM Deal d WHERE d.id=NEW.dealId AND d.company=NEW.company AND d.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.supplierId AND b.kind='suppliers' AND b.company=NEW.company AND b.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.productId AND b.kind='products' AND b.company=NEW.company AND b.branch=NEW.branch) THEN RAISE(ABORT,'execution_scope') END);
 SELECT (CASE WHEN NEW.dealId IS NOT OLD.dealId OR NEW.supplierId IS NOT OLD.supplierId OR NEW.productId IS NOT OLD.productId OR NEW.company IS NOT OLD.company OR NEW.branch IS NOT OLD.branch OR NEW.createdBy IS NOT OLD.createdBy OR NEW.createdAt IS NOT OLD.createdAt THEN RAISE(ABORT,'execution_identity_immutable') END);
 END;

--> statement-breakpoint
CREATE TRIGGER SupplierRFQ_retain BEFORE DELETE ON SupplierRFQ BEGIN SELECT RAISE(ABORT,'execution_history_retained'); END;

--> statement-breakpoint
CREATE TABLE SupplierOffer (id TEXT PRIMARY KEY NOT NULL, dealId TEXT NOT NULL REFERENCES Deal(id) ON DELETE RESTRICT, supplierId TEXT NOT NULL REFERENCES BusinessRecord(id) ON DELETE RESTRICT, productId TEXT NOT NULL REFERENCES BusinessRecord(id) ON DELETE RESTRICT, company TEXT NOT NULL, branch TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), createdBy TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, rfqId TEXT REFERENCES SupplierRFQ(id) ON DELETE RESTRICT, seriesId TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), previousId TEXT REFERENCES SupplierOffer(id) ON DELETE RESTRICT, details TEXT NOT NULL CHECK(json_valid(details)), CHECK(status IN ('Received','Under review','Superseded','Declined','Selected')));

--> statement-breakpoint
CREATE INDEX SupplierOffer_scope ON SupplierOffer(company,branch,dealId);

--> statement-breakpoint
CREATE INDEX SupplierOffer_supplier_product ON SupplierOffer(supplierId,productId);

--> statement-breakpoint
CREATE TRIGGER SupplierOffer_insert_guard BEFORE INSERT ON SupplierOffer BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM Deal d WHERE d.id=NEW.dealId AND d.company=NEW.company AND d.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.supplierId AND b.kind='suppliers' AND b.company=NEW.company AND b.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.productId AND b.kind='products' AND b.company=NEW.company AND b.branch=NEW.branch) THEN RAISE(ABORT,'execution_scope') END);

 END;

--> statement-breakpoint
CREATE TRIGGER SupplierOffer_update_guard BEFORE UPDATE ON SupplierOffer BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM Deal d WHERE d.id=NEW.dealId AND d.company=NEW.company AND d.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.supplierId AND b.kind='suppliers' AND b.company=NEW.company AND b.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.productId AND b.kind='products' AND b.company=NEW.company AND b.branch=NEW.branch) THEN RAISE(ABORT,'execution_scope') END);
 SELECT (CASE WHEN NEW.dealId IS NOT OLD.dealId OR NEW.supplierId IS NOT OLD.supplierId OR NEW.productId IS NOT OLD.productId OR NEW.company IS NOT OLD.company OR NEW.branch IS NOT OLD.branch OR NEW.createdBy IS NOT OLD.createdBy OR NEW.createdAt IS NOT OLD.createdAt THEN RAISE(ABORT,'execution_identity_immutable') END);
 END;

--> statement-breakpoint
CREATE TRIGGER SupplierOffer_retain BEFORE DELETE ON SupplierOffer BEGIN SELECT RAISE(ABORT,'execution_history_retained'); END;

--> statement-breakpoint
CREATE TABLE CommercialScenario (id TEXT PRIMARY KEY NOT NULL, dealId TEXT NOT NULL REFERENCES Deal(id) ON DELETE RESTRICT, supplierId TEXT NOT NULL REFERENCES BusinessRecord(id) ON DELETE RESTRICT, productId TEXT NOT NULL REFERENCES BusinessRecord(id) ON DELETE RESTRICT, company TEXT NOT NULL, branch TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), createdBy TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, offerId TEXT NOT NULL REFERENCES SupplierOffer(id) ON DELETE RESTRICT, quotationId TEXT REFERENCES BusinessRecord(id) ON DELETE RESTRICT, selectedBy TEXT, selectedAt INTEGER, details TEXT NOT NULL CHECK(json_valid(details)), CHECK(status IN ('Draft','Reviewed','Selected')));

--> statement-breakpoint
CREATE INDEX CommercialScenario_scope ON CommercialScenario(company,branch,dealId);

--> statement-breakpoint
CREATE INDEX CommercialScenario_supplier_product ON CommercialScenario(supplierId,productId);

--> statement-breakpoint
CREATE TRIGGER CommercialScenario_insert_guard BEFORE INSERT ON CommercialScenario BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM Deal d WHERE d.id=NEW.dealId AND d.company=NEW.company AND d.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.supplierId AND b.kind='suppliers' AND b.company=NEW.company AND b.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.productId AND b.kind='products' AND b.company=NEW.company AND b.branch=NEW.branch) THEN RAISE(ABORT,'execution_scope') END);

 END;

--> statement-breakpoint
CREATE TRIGGER CommercialScenario_update_guard BEFORE UPDATE ON CommercialScenario BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM Deal d WHERE d.id=NEW.dealId AND d.company=NEW.company AND d.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.supplierId AND b.kind='suppliers' AND b.company=NEW.company AND b.branch=NEW.branch) OR NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.productId AND b.kind='products' AND b.company=NEW.company AND b.branch=NEW.branch) THEN RAISE(ABORT,'execution_scope') END);
 SELECT (CASE WHEN NEW.dealId IS NOT OLD.dealId OR NEW.supplierId IS NOT OLD.supplierId OR NEW.productId IS NOT OLD.productId OR NEW.company IS NOT OLD.company OR NEW.branch IS NOT OLD.branch OR NEW.createdBy IS NOT OLD.createdBy OR NEW.createdAt IS NOT OLD.createdAt THEN RAISE(ABORT,'execution_identity_immutable') END);
 END;

--> statement-breakpoint
CREATE TRIGGER CommercialScenario_retain BEFORE DELETE ON CommercialScenario BEGIN SELECT RAISE(ABORT,'execution_history_retained'); END;

--> statement-breakpoint
CREATE UNIQUE INDEX DealSupplier_pair ON DealSupplier(dealId,supplierId,productId);

--> statement-breakpoint
CREATE INDEX SupplierRFQ_deal ON SupplierRFQ(dealId);

--> statement-breakpoint
CREATE INDEX SupplierOffer_deal ON SupplierOffer(dealId);

--> statement-breakpoint
CREATE UNIQUE INDEX SupplierOffer_revision ON SupplierOffer(seriesId,revision);

--> statement-breakpoint
CREATE UNIQUE INDEX SupplierOffer_latest ON SupplierOffer(seriesId) WHERE status != 'Superseded';

--> statement-breakpoint
CREATE INDEX CommercialScenario_deal ON CommercialScenario(dealId);

--> statement-breakpoint
CREATE UNIQUE INDEX CommercialScenario_selected ON CommercialScenario(dealId) WHERE status='Selected';

--> statement-breakpoint
CREATE TRIGGER SupplierOffer_revision_guard BEFORE INSERT ON SupplierOffer BEGIN SELECT (CASE WHEN (NEW.revision=1 AND (NEW.previousId IS NOT NULL OR NEW.seriesId!=NEW.id)) OR (NEW.revision>1 AND NOT EXISTS(SELECT 1 FROM SupplierOffer o WHERE o.id=NEW.previousId AND o.seriesId=NEW.seriesId AND o.revision=NEW.revision-1 AND o.dealId=NEW.dealId AND o.supplierId=NEW.supplierId AND o.productId=NEW.productId AND o.status='Superseded')) OR (NEW.rfqId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM SupplierRFQ r WHERE r.id=NEW.rfqId AND r.dealId=NEW.dealId AND r.supplierId=NEW.supplierId AND r.productId=NEW.productId)) THEN RAISE(ABORT,'offer_revision_relationship') END); END;

--> statement-breakpoint
CREATE TRIGGER SupplierOffer_immutable BEFORE UPDATE ON SupplierOffer BEGIN SELECT (CASE WHEN NEW.details IS NOT OLD.details OR NEW.seriesId IS NOT OLD.seriesId OR NEW.revision IS NOT OLD.revision OR NEW.previousId IS NOT OLD.previousId OR NEW.rfqId IS NOT OLD.rfqId THEN RAISE(ABORT,'offer_terms_immutable') END); END;

--> statement-breakpoint
CREATE TRIGGER CommercialScenario_relationship_insert BEFORE INSERT ON CommercialScenario BEGIN SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM SupplierOffer o WHERE o.id=NEW.offerId AND o.dealId=NEW.dealId AND o.supplierId=NEW.supplierId AND o.productId=NEW.productId) OR (NEW.quotationId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM BusinessRecord q WHERE q.id=NEW.quotationId AND q.kind='quotations' AND q.company=NEW.company AND q.branch=NEW.branch AND json_extract(q.payload,'$.dealId')=NEW.dealId)) THEN RAISE(ABORT,'scenario_relationship') END); END;

--> statement-breakpoint
CREATE TRIGGER CommercialScenario_relationship_update BEFORE UPDATE ON CommercialScenario BEGIN SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM SupplierOffer o WHERE o.id=NEW.offerId AND o.dealId=NEW.dealId AND o.supplierId=NEW.supplierId AND o.productId=NEW.productId) OR (NEW.quotationId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM BusinessRecord q WHERE q.id=NEW.quotationId AND q.kind='quotations' AND q.company=NEW.company AND q.branch=NEW.branch AND json_extract(q.payload,'$.dealId')=NEW.dealId)) THEN RAISE(ABORT,'scenario_relationship') END); END;

--> statement-breakpoint
CREATE TRIGGER CommercialScenario_reviewed_guard BEFORE UPDATE ON CommercialScenario WHEN OLD.status!='Draft' BEGIN SELECT (CASE WHEN NEW.details IS NOT OLD.details OR NEW.offerId IS NOT OLD.offerId OR NEW.status='Draft' THEN RAISE(ABORT,'reviewed_scenario_immutable') END); END;

--> statement-breakpoint
CREATE TABLE ApolloStage (id TEXT PRIMARY KEY NOT NULL, actorId TEXT NOT NULL, company TEXT NOT NULL, branch TEXT NOT NULL, fingerprint TEXT NOT NULL, expiresAt INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));

--> statement-breakpoint
CREATE INDEX ApolloStage_expiry ON ApolloStage(expiresAt);

--> statement-breakpoint
CREATE UNIQUE INDEX ApolloStage_cache ON ApolloStage(actorId,company,branch,fingerprint);

--> statement-breakpoint
CREATE TABLE ApolloImport (id TEXT PRIMARY KEY NOT NULL, actorId TEXT NOT NULL, company TEXT NOT NULL, branch TEXT NOT NULL, providerId TEXT NOT NULL, providerKind TEXT NOT NULL CHECK(providerKind IN ('company','person')), customerId TEXT NOT NULL REFERENCES BusinessRecord(id) ON DELETE RESTRICT, contactId TEXT REFERENCES Contact(id) ON DELETE RESTRICT, leadId TEXT REFERENCES BusinessRecord(id) ON DELETE RESTRICT, createdAt INTEGER NOT NULL);

--> statement-breakpoint
CREATE UNIQUE INDEX ApolloImport_source ON ApolloImport(company,branch,providerKind,providerId);

--> statement-breakpoint
CREATE INDEX BusinessRecord_apollo_company ON BusinessRecord(company,branch,json_extract(payload,'$.attributes.apolloCompanyId'));

--> statement-breakpoint
CREATE TRIGGER ApolloImport_guard BEFORE INSERT ON ApolloImport BEGIN SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.customerId AND b.kind='customers' AND b.company=NEW.company AND b.branch=NEW.branch) OR (NEW.contactId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM Contact c WHERE c.id=NEW.contactId AND c.parentId=NEW.customerId)) OR (NEW.leadId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM BusinessRecord b WHERE b.id=NEW.leadId AND b.kind='leads' AND b.company=NEW.company AND b.branch=NEW.branch AND json_extract(b.payload,'$.customerId')=NEW.customerId)) THEN RAISE(ABORT,'apollo_import_relationship') END); END;

--> statement-breakpoint
CREATE TRIGGER BusinessRecord_execution_scope BEFORE UPDATE OF company,branch,kind ON BusinessRecord WHEN (NEW.company IS NOT OLD.company OR NEW.branch IS NOT OLD.branch OR NEW.kind IS NOT OLD.kind) AND (EXISTS(SELECT 1 FROM DealSupplier WHERE supplierId=OLD.id OR productId=OLD.id) OR EXISTS(SELECT 1 FROM SupplierRFQ WHERE supplierId=OLD.id OR productId=OLD.id) OR EXISTS(SELECT 1 FROM SupplierOffer WHERE supplierId=OLD.id OR productId=OLD.id) OR EXISTS(SELECT 1 FROM CommercialScenario WHERE supplierId=OLD.id OR productId=OLD.id) OR EXISTS(SELECT 1 FROM ApolloImport WHERE customerId=OLD.id OR leadId=OLD.id)) BEGIN SELECT RAISE(ABORT,'execution_scope_retained'); END;

--> statement-breakpoint
CREATE TRIGGER SupplierRFQ_sent_terms BEFORE UPDATE ON SupplierRFQ WHEN OLD.status IN ('Sent externally','Responded','Closed') AND NEW.details IS NOT OLD.details BEGIN SELECT RAISE(ABORT,'execution_sent_terms_retained'); END;

--> statement-breakpoint
CREATE TRIGGER ApolloImport_immutable BEFORE UPDATE ON ApolloImport BEGIN SELECT (CASE WHEN NEW.company IS NOT OLD.company OR NEW.branch IS NOT OLD.branch OR NEW.providerId IS NOT OLD.providerId OR NEW.providerKind IS NOT OLD.providerKind OR NEW.customerId IS NOT OLD.customerId OR NEW.contactId IS NOT OLD.contactId OR NEW.leadId IS NOT OLD.leadId THEN RAISE(ABORT,'apollo_import_identity_retained') END); END;
