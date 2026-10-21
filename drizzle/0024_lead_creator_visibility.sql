-- Restore creator visibility only when an authentic creation audit identifies
-- the person. Never guess from the current owner or classify legacy demand.
UPDATE BusinessRecord
SET payload = json_set(payload, '$.attributes.leadCapturedById', (
  SELECT a.actorId FROM AuditEvent a
  WHERE a.recordId = BusinessRecord.id AND a.company = BusinessRecord.company
    AND a.subject IS NULL AND a.action LIKE 'Created leads%'
    AND a.actorId IS NOT NULL AND a.actorId <> ''
  ORDER BY a.at ASC, a.id ASC LIMIT 1
))
WHERE kind = 'leads'
  AND COALESCE(json_extract(payload, '$.attributes.leadCapturedById'), '') = ''
  AND EXISTS (
    SELECT 1 FROM AuditEvent a
    WHERE a.recordId = BusinessRecord.id AND a.company = BusinessRecord.company
      AND a.subject IS NULL AND a.action LIKE 'Created leads%'
      AND a.actorId IS NOT NULL AND a.actorId <> ''
  );
CREATE INDEX IF NOT EXISTS BusinessRecord_lead_creator_idx
  ON BusinessRecord(kind, json_extract(payload, '$.attributes.leadCapturedById'));
