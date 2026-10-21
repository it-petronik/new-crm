-- Add the fifth brand only to group-view roles already covering every existing
-- brand. Partial company scopes and all ordinary staff memberships stay intact.
-- Revoke credentials before expanding scope; application reads fresh access.
DELETE FROM Session WHERE userId IN (
  SELECT id FROM User WHERE role IN ('MD','MD Assistant','IT Administrator')
    AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Petronik')
    AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Afrilube')
    AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Petronex')
    AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Istanegry')
    AND NOT EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Enercore')
);
DELETE FROM RefreshToken WHERE userId IN (
  SELECT id FROM User WHERE role IN ('MD','MD Assistant','IT Administrator')
    AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Petronik')
    AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Afrilube')
    AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Petronex')
    AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Istanegry')
    AND NOT EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Enercore')
);
DELETE FROM PasswordReset WHERE userId IN (
  SELECT id FROM User WHERE role IN ('MD','MD Assistant','IT Administrator')
    AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Petronik')
    AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Afrilube')
    AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Petronex')
    AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Istanegry')
    AND NOT EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Enercore')
);
INSERT INTO AuditEvent(id,company,actorId,actor,action,recordId,at,subject,branch)
SELECT 'MIG0025:' || id,'Enercore','system:migration:0025','System migration',
  'Added Enercore brand to existing all-brand group access',id,unixepoch()*1000,'account',NULL
FROM User WHERE role IN ('MD','MD Assistant','IT Administrator')
  AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Petronik')
  AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Afrilube')
  AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Petronex')
  AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Istanegry')
  AND NOT EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Enercore')
ON CONFLICT(id) DO NOTHING;
UPDATE User SET companies=json_insert(companies,'$[#]','Enercore')
WHERE role IN ('MD','MD Assistant','IT Administrator')
  AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Petronik')
  AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Afrilube')
  AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Petronex')
  AND EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Istanegry')
  AND NOT EXISTS (SELECT 1 FROM json_each(User.companies) WHERE value='Enercore');
