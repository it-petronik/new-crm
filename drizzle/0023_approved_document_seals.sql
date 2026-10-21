CREATE TABLE ApprovedDocumentSeal (
 id TEXT PRIMARY KEY NOT NULL,
 company TEXT NOT NULL,
 signaturePng TEXT NOT NULL,
 stampPng TEXT NOT NULL,
 sourceSha256 TEXT NOT NULL,
 createdAt INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER ApprovedDocumentSeal_immutable BEFORE UPDATE ON ApprovedDocumentSeal
BEGIN SELECT RAISE(ABORT, 'Approved document seal versions are immutable'); END;
