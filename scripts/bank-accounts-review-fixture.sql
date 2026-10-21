-- Fictional isolated review database only. Never apply this to production.
INSERT INTO User(id,email,name,passwordHash,role,companies,branches,moduleAccess,active,createdAt)
SELECT 'bank-review-readonly','bankreadonly@collab.test','Fictional Read-only Accountant',passwordHash,
  'Accountant','["Petronik"]','[]','{"accounts":"read"}',1,createdAt
FROM User WHERE id='collab-user-release9'
ON CONFLICT(id) DO NOTHING;
