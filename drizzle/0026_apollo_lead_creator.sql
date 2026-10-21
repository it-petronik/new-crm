-- Apollo import receipts are immutable creation evidence. Do not infer a
-- creator from contact/customer matches, current ownership or free-text notes.
UPDATE BusinessRecord
SET payload=json_set(payload,'$.attributes.leadCapturedById',(
  SELECT i.actorId FROM ApolloImport i
  WHERE i.leadId=BusinessRecord.id AND i.company=BusinessRecord.company
    AND i.branch=BusinessRecord.branch
  ORDER BY i.createdAt ASC,i.id ASC LIMIT 1
))
WHERE kind='leads'
  AND COALESCE(json_extract(payload,'$.attributes.leadCapturedById'),'')=''
  AND EXISTS (
    SELECT 1 FROM ApolloImport i WHERE i.leadId=BusinessRecord.id
      AND i.company=BusinessRecord.company AND i.branch=BusinessRecord.branch
  );
