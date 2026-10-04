-- Fictional local review only. Not a production migration.
CREATE TABLE IF NOT EXISTS MailSandbox (
  ownerId TEXT NOT NULL REFERENCES User(id),
  id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  folder TEXT NOT NULL CHECK(folder IN ('inbox','drafts','outbox')),
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY(ownerId,id)
);
INSERT OR IGNORE INTO MailSandbox
SELECT id, 'e31869ca-b985-4a08-bf7f-98d834dd44e2', id || '@example.invalid', 'buyer@example.invalid',
  'Sample enquiry: Base Oil SN 500',
  'This is a fictional message for local testing. Please share availability and a quotation for 200 MT of SN 500.',
  'inbox', 1791014400000 FROM User;
INSERT OR IGNORE INTO MailSandbox VALUES
('collab-user-studio','6f688534-917a-4bf5-9e3c-2838b6333011','studio@example.invalid','logistics@example.invalid','Sample shipment update — Mombasa','Fictional message: the sample shipment documents are ready for review. Nothing was dispatched.','inbox',1791021600000),
('collab-user-studio','6f688534-917a-4bf5-9e3c-2838b6333012','studio@example.invalid','support@example.invalid','Sample IT request — email setup','Fictional message: please help set up email on my laptop. This is only a local design fixture.','inbox',1791025200000),
('collab-user-studio','6f688534-917a-4bf5-9e3c-2838b6333013','buyer@example.invalid','studio@example.invalid','Quotation follow-up — draft','Hello, thank you for your enquiry. This fictional draft has not been sent.','drafts',1791028800000),
('collab-user-studio','6f688534-917a-4bf5-9e3c-2838b6333014','buyer@example.invalid','studio@example.invalid','Sample captured reply','This fictional outbox item was captured locally. It was never delivered.','outbox',1791032400000);
