-- Phase 9: fixed-point procurement and an immutable stock/payment ledger.
CREATE TABLE PurchaseOrder (
 id TEXT PRIMARY KEY NOT NULL, company TEXT NOT NULL, branch TEXT NOT NULL,
 orderId TEXT NOT NULL REFERENCES BusinessRecord(id), supplierId TEXT NOT NULL REFERENCES BusinessRecord(id), productId TEXT NOT NULL REFERENCES BusinessRecord(id),
 warehouse TEXT NOT NULL, unit TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0 AND quantity<=1000000000000),
 priceCents INTEGER NOT NULL CHECK(priceCents>0 AND priceCents<=1000000000), totalCents INTEGER NOT NULL CHECK(totalCents>0 AND totalCents<=1000000000000000), currency TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('Draft','Approved','Closed','Cancelled')), expectedDate TEXT NOT NULL, notes TEXT NOT NULL,
 createdBy TEXT NOT NULL REFERENCES User(id), approvedBy TEXT REFERENCES User(id), version INTEGER NOT NULL CHECK(version>0), createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX PurchaseOrder_scope ON PurchaseOrder(company,branch,createdAt);
--> statement-breakpoint
CREATE TABLE StockMovement (
 id TEXT PRIMARY KEY NOT NULL, purchaseId TEXT NOT NULL REFERENCES PurchaseOrder(id),
 kind TEXT NOT NULL CHECK(kind IN ('Receipt','Dispatch','Receipt reversal','Dispatch reversal')),
 quantity INTEGER NOT NULL CHECK(quantity!=0 AND abs(quantity)<=1000000000000),
 shipmentId TEXT REFERENCES BusinessRecord(id), reversalOf TEXT UNIQUE REFERENCES StockMovement(id),
 reference TEXT NOT NULL, date TEXT NOT NULL, notes TEXT NOT NULL, createdBy TEXT NOT NULL REFERENCES User(id), createdAt INTEGER NOT NULL,
 CHECK((kind IN ('Receipt','Dispatch reversal') AND quantity>0) OR (kind IN ('Dispatch','Receipt reversal') AND quantity<0)),
 CHECK((kind IN ('Receipt reversal','Dispatch reversal'))=(reversalOf IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX StockMovement_purchase ON StockMovement(purchaseId,createdAt);
--> statement-breakpoint
CREATE TABLE SupplierInvoice (
 id TEXT PRIMARY KEY NOT NULL, purchaseId TEXT NOT NULL REFERENCES PurchaseOrder(id), company TEXT NOT NULL, supplierId TEXT NOT NULL REFERENCES BusinessRecord(id),
 reference TEXT NOT NULL, normalized TEXT NOT NULL, amountCents INTEGER NOT NULL CHECK(amountCents>0 AND amountCents<=1000000000000000),
 date TEXT NOT NULL, dueDate TEXT NOT NULL, notes TEXT NOT NULL, createdBy TEXT NOT NULL REFERENCES User(id), createdAt INTEGER NOT NULL,
 UNIQUE(company,supplierId,normalized)
);
--> statement-breakpoint
CREATE INDEX SupplierInvoice_purchase ON SupplierInvoice(purchaseId);
--> statement-breakpoint
CREATE TABLE SupplierPayment (
 id TEXT PRIMARY KEY NOT NULL, invoiceId TEXT NOT NULL REFERENCES SupplierInvoice(id), amountCents INTEGER NOT NULL CHECK(amountCents>0 AND amountCents<=1000000000000000),
 reference TEXT NOT NULL, date TEXT NOT NULL, notes TEXT NOT NULL, createdBy TEXT NOT NULL REFERENCES User(id), createdAt INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX SupplierPayment_invoice ON SupplierPayment(invoiceId);
--> statement-breakpoint
CREATE TRIGGER PurchaseOrder_scope_insert BEFORE INSERT ON PurchaseOrder BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM BusinessRecord WHERE id=NEW.orderId AND kind='orders' AND company=NEW.company AND branch=NEW.branch AND json_extract(payload,'$.deletedAt') IS NULL AND status IN ('Confirmed','In Progress','Completed'))
 OR NOT EXISTS(SELECT 1 FROM BusinessRecord WHERE id=NEW.supplierId AND kind='suppliers' AND company=NEW.company AND branch=NEW.branch AND json_extract(payload,'$.deletedAt') IS NULL)
 OR NOT EXISTS(SELECT 1 FROM BusinessRecord WHERE id=NEW.productId AND kind='products' AND company=NEW.company AND branch=NEW.branch AND json_extract(payload,'$.deletedAt') IS NULL)
 THEN RAISE(ABORT,'operations_scope') END;
 SELECT CASE WHEN NEW.status!='Draft' OR NEW.approvedBy IS NOT NULL THEN RAISE(ABORT,'operations_approval') END;
END;
--> statement-breakpoint
CREATE TRIGGER PurchaseOrder_update BEFORE UPDATE ON PurchaseOrder BEGIN
 SELECT CASE WHEN NEW.id!=OLD.id OR NEW.company!=OLD.company OR NEW.branch!=OLD.branch OR NEW.orderId!=OLD.orderId OR NEW.supplierId!=OLD.supplierId OR NEW.productId!=OLD.productId OR NEW.warehouse!=OLD.warehouse OR NEW.unit!=OLD.unit OR NEW.quantity!=OLD.quantity OR NEW.priceCents!=OLD.priceCents OR NEW.totalCents!=OLD.totalCents OR NEW.currency!=OLD.currency OR NEW.expectedDate!=OLD.expectedDate OR NEW.notes!=OLD.notes OR NEW.createdBy!=OLD.createdBy OR NEW.createdAt!=OLD.createdAt THEN RAISE(ABORT,'operations_immutable') END;
 SELECT CASE WHEN NEW.version!=OLD.version+1 THEN RAISE(ABORT,'operations_stale') END;
 SELECT CASE WHEN NOT ((OLD.status='Draft' AND NEW.status IN ('Approved','Cancelled')) OR (OLD.status='Approved' AND NEW.status IN ('Closed','Cancelled'))) THEN RAISE(ABORT,'operations_transition') END;
 SELECT CASE WHEN NEW.status='Approved' AND (NEW.approvedBy IS NULL OR NEW.approvedBy=NEW.createdBy) THEN RAISE(ABORT,'operations_approval') END;
 SELECT CASE WHEN OLD.status='Approved' AND NEW.approvedBy IS NOT OLD.approvedBy THEN RAISE(ABORT,'operations_immutable') END;
 SELECT CASE WHEN NEW.status='Cancelled' AND (EXISTS(SELECT 1 FROM StockMovement WHERE purchaseId=OLD.id) OR EXISTS(SELECT 1 FROM SupplierInvoice WHERE purchaseId=OLD.id)) THEN RAISE(ABORT,'operations_history') END;
END;
--> statement-breakpoint
CREATE TRIGGER StockMovement_guard BEFORE INSERT ON StockMovement BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM PurchaseOrder WHERE id=NEW.purchaseId AND (status='Approved' OR (status='Closed' AND NEW.reversalOf IS NOT NULL))) THEN RAISE(ABORT,'operations_not_approved') END;
 SELECT CASE WHEN NEW.reversalOf IS NOT NULL AND NOT EXISTS(SELECT 1 FROM StockMovement WHERE id=NEW.reversalOf AND purchaseId=NEW.purchaseId AND quantity=-NEW.quantity AND reversalOf IS NULL AND ((kind='Receipt' AND NEW.kind='Receipt reversal') OR (kind='Dispatch' AND NEW.kind='Dispatch reversal')) AND shipmentId IS NEW.shipmentId) THEN RAISE(ABORT,'operations_reversal') END;
 SELECT CASE WHEN NEW.kind='Receipt' AND NEW.shipmentId IS NOT NULL THEN RAISE(ABORT,'operations_scope') END;
 SELECT CASE WHEN NEW.kind IN ('Dispatch','Dispatch reversal') AND NOT EXISTS(SELECT 1 FROM BusinessRecord s JOIN PurchaseOrder p ON p.id=NEW.purchaseId WHERE s.id=NEW.shipmentId AND s.kind='logistics' AND s.company=p.company AND s.branch=p.branch AND json_extract(s.payload,'$.parentId')=p.orderId AND json_extract(s.payload,'$.deletedAt') IS NULL) THEN RAISE(ABORT,'operations_scope') END;
 SELECT CASE WHEN coalesce((SELECT sum(quantity) FROM StockMovement WHERE purchaseId=NEW.purchaseId),0)+NEW.quantity<0 THEN RAISE(ABORT,'operations_stock') END;
 SELECT CASE WHEN NEW.kind IN ('Receipt','Receipt reversal') AND (coalesce((SELECT sum(quantity) FROM StockMovement WHERE purchaseId=NEW.purchaseId AND kind IN ('Receipt','Receipt reversal')),0)+NEW.quantity NOT BETWEEN 0 AND (SELECT quantity FROM PurchaseOrder WHERE id=NEW.purchaseId)) THEN RAISE(ABORT,'operations_receipt_limit') END;
END;
--> statement-breakpoint
CREATE TRIGGER SupplierInvoice_guard BEFORE INSERT ON SupplierInvoice BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM PurchaseOrder p WHERE p.id=NEW.purchaseId AND p.company=NEW.company AND p.supplierId=NEW.supplierId AND p.status IN ('Approved','Closed') AND coalesce((SELECT sum(amountCents) FROM SupplierInvoice WHERE purchaseId=p.id),0)+NEW.amountCents<=p.totalCents) THEN RAISE(ABORT,'operations_invoice_limit') END;
END;
--> statement-breakpoint
CREATE TRIGGER SupplierPayment_guard BEFORE INSERT ON SupplierPayment BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM SupplierInvoice i WHERE i.id=NEW.invoiceId AND coalesce((SELECT sum(amountCents) FROM SupplierPayment WHERE invoiceId=i.id),0)+NEW.amountCents<=i.amountCents) THEN RAISE(ABORT,'operations_payment_limit') END;
END;
--> statement-breakpoint
CREATE TRIGGER PurchaseOrder_retain BEFORE DELETE ON PurchaseOrder BEGIN SELECT RAISE(ABORT,'operations_history'); END;
--> statement-breakpoint
CREATE TRIGGER StockMovement_immutable BEFORE UPDATE ON StockMovement BEGIN SELECT RAISE(ABORT,'operations_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER StockMovement_retain BEFORE DELETE ON StockMovement BEGIN SELECT RAISE(ABORT,'operations_history'); END;
--> statement-breakpoint
CREATE TRIGGER SupplierInvoice_immutable BEFORE UPDATE ON SupplierInvoice BEGIN SELECT RAISE(ABORT,'operations_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER SupplierInvoice_retain BEFORE DELETE ON SupplierInvoice BEGIN SELECT RAISE(ABORT,'operations_history'); END;
--> statement-breakpoint
CREATE TRIGGER SupplierPayment_immutable BEFORE UPDATE ON SupplierPayment BEGIN SELECT RAISE(ABORT,'operations_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER SupplierPayment_retain BEFORE DELETE ON SupplierPayment BEGIN SELECT RAISE(ABORT,'operations_history'); END;
--> statement-breakpoint
CREATE TRIGGER BusinessRecord_operations_retain BEFORE UPDATE OF payload,company,branch,kind ON BusinessRecord
WHEN EXISTS(SELECT 1 FROM PurchaseOrder WHERE orderId=OLD.id OR supplierId=OLD.id OR productId=OLD.id) OR EXISTS(SELECT 1 FROM StockMovement WHERE shipmentId=OLD.id)
BEGIN
 SELECT CASE WHEN NEW.company!=OLD.company OR NEW.branch!=OLD.branch OR NEW.kind!=OLD.kind OR (json_extract(NEW.payload,'$.deletedAt') IS NOT NULL AND json_extract(OLD.payload,'$.deletedAt') IS NULL) THEN RAISE(ABORT,'operations_history') END;
END;
