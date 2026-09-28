"""Targeted fictional Phase 7 upgrade, export/reload and data validation only."""
import importlib.util, pathlib, sqlite3, json
root=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('recovery',root/'scripts/d1-recovery.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
work=root/'work/phase7';work.mkdir(parents=True,exist_ok=True)
# Use Phase 6's schema and populated identities, then apply only 0014.
data=(work/'fictional-data.sql').read_text().splitlines()
old=m.expected_schema('phase6')
for line in data:
 if any(line.startswith('INSERT INTO "'+table+'"') for table in ['BusinessRecord','Contact','Deal','SupplierProductCapability']):old.execute(line)
old.commit();before=old.execute('SELECT count(*) FROM BusinessRecord').fetchone()[0]
old.executescript((root/'drizzle/0014_deal_execution.sql').read_text())
# Historical offer rows are already superseded in the export; restores load data before guards.
guards=list(old.execute("SELECT name,sql FROM sqlite_master WHERE type='trigger'"))
for name,_ in guards:old.execute('DROP TRIGGER "'+name+'"')
for line in data:
 if not any(line.startswith('INSERT INTO "'+table+'"') for table in ['BusinessRecord','Contact','Deal','SupplierProductCapability']):old.execute(line)
for _,sql in guards:old.execute(sql)
old.commit()
backup=work/'phase7-fictional-backup.sql';backup.write_text('\n'.join(old.iterdump()))
restored=m.load_backup(backup,'phase7')
# load_backup returns the validated SQLite connection.
if isinstance(restored,tuple):restored=restored[0]
assert m.snapshot(old)==m.snapshot(restored)
plan=m.plan(restored)
ordered=sqlite3.connect(":memory:");ordered.execute("PRAGMA foreign_keys=ON")
for section in plan.values():
 for statement in section:ordered.execute(statement)
ordered.commit();m.validate(ordered,"phase7")
assert m.snapshot(ordered)==m.snapshot(restored)
assert old.execute('SELECT count(*) FROM BusinessRecord').fetchone()[0]==before
result={'phase6_populated_upgrade':'passed','fresh_schema':'passed','snapshot_roundtrip':'equal','foreign_key_check':restored.execute('PRAGMA foreign_key_check').fetchall(),'integrity_check':restored.execute('PRAGMA integrity_check').fetchone()[0],'new_entity_rows':{t:restored.execute('SELECT count(*) FROM '+t).fetchone()[0] for t in ['DealSupplier','SupplierRFQ','SupplierOffer','CommercialScenario','ApolloStage','ApolloImport']}}
(work/'recovery.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
