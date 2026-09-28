import argparse
import contextlib
import io
import json
import os
import shutil
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from recovery_fixture import r, database, export, insert

class LocalTransport:
    target='enercore-recovery-unit'
    def __init__(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.mutate_export=False
    def query(self,sql):
        results=[]
        for statement in r.statements(sql+';'):
            c=self.db.execute(statement);rows=c.fetchall()
            results.extend(dict(zip([d[0] for d in c.description],row)) for row in rows)
        self.db.commit()
        return results
    def execute_file(self,path):
        self.db.executescript(Path(path).read_text())
    def export(self,path):
        if self.mutate_export:self.db.execute("UPDATE BusinessRecord SET payload=json_set(payload,'$.detail','changed') WHERE id='legacy'")
        export(self.db,path)

class Recovery(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.db=database();self.addCleanup(self.db.close);self.backup=self.root/'backup.sql';export(self.db,self.backup)
    def args(self,**extra):
        return argparse.Namespace(backup=str(self.backup),schema='phase6',report=str(self.root/'receipt.json'),rehearsal_stop_after=None,**extra)
    def corrupt(self,sql,tail=''):
        for (name,) in self.db.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall():self.db.execute('DROP TRIGGER '+r.quote_name(name))
        self.db.execute('PRAGMA foreign_keys=OFF');self.db.executescript(sql);export(self.db,self.backup)
        # Put the real schema guards back into the export, not into corrupt data.
        reference=r.expected_schema('phase6')
        guards='\n'.join(row[0]+';' for row in reference.execute("SELECT sql FROM sqlite_master WHERE type='trigger'"));reference.close()
        self.backup.write_text(self.backup.read_text()+guards+'\n'+tail)
    def reject(self):
        with self.assertRaises(r.RecoveryError):r.load_backup(self.backup)
    def restore(self,transport=None,args=None):
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):return r.restore(args or self.args(),transport or LocalTransport())
    def test_schema_first_restore_reproduces_primary_contact_cycle_defect(self):
        target=r.expected_schema('phase6');self.addCleanup(target.close)
        user=self.db.execute('SELECT * FROM User').fetchone()
        target.execute('INSERT INTO User VALUES('+','.join('?' for _ in user)+')',user)
        customer=self.db.execute("SELECT * FROM BusinessRecord WHERE id='c-a'").fetchone()
        with self.assertRaisesRegex(sqlite3.IntegrityError,'commercial_primary_invalid'):
            target.execute('INSERT INTO BusinessRecord VALUES('+','.join('?' for _ in customer)+')',customer)
    def test_round_trip_every_table_and_payload(self):
        t=LocalTransport();result=self.restore(t)
        self.assertEqual(result['status'],'validated');self.assertEqual(r.snapshot(self.db),r.snapshot(t.db));self.assertEqual(r.schema(self.db),r.schema(t.db))
        for table in ['BusinessRecord','Contact','Deal','SupplierProductCapability','AuditEvent','Meeting','MeetingNote','MeetingReport','AiUsage','d1_migrations']:self.assertGreater(result['tables'][table]['rows'],0)
    def test_pre_phase6_profile(self):
        db=database(False);export(db,self.backup);loaded=r.load_backup(self.backup,'pre-phase6');self.assertEqual(r.snapshot(db),r.snapshot(loaded));db.close();loaded.close()
        self.reject() # Never silently call a pre-Phase-6 export Phase-6-ready.
    def test_missing_tables_indexes_and_guards(self):
        original=self.backup.read_text()
        for name in ['Contact','Deal_lead_idx','BusinessRecord_customerId_idx','Contact_insert_guard','BusinessRecord_contact_active_update']:
            with self.subTest(name=name):
                self.backup.write_text('\n'.join(s for s in r.statements(original) if not (r.canonical(s).startswith('create ') and name.lower() in r.canonical(s).split())))
                self.reject()
    def test_broken_contact_parent(self):
        self.corrupt("UPDATE Contact SET parentId='absent' WHERE id='ct-primary';");self.reject()
    def test_inactive_primary_rejected(self):
        self.corrupt("UPDATE Contact SET active=0 WHERE id='ct-primary';");self.reject()
    def test_invalid_contact_scope(self):
        self.corrupt("UPDATE Contact SET branch='Other branch' WHERE id='ct-primary';");self.reject()
    def test_invalid_parent_kind(self):
        self.corrupt("UPDATE Contact SET parentId='p-a' WHERE id='ct-supplier';");self.reject()
    def test_duplicate_deal_per_lead(self):
        self.corrupt("DROP INDEX Deal_lead_idx; INSERT INTO Deal SELECT 'duplicate',leadId,company,branch,createdAt FROM Deal;",'CREATE UNIQUE INDEX Deal_lead_idx ON Deal(leadId);');self.reject()
    def test_invalid_capability_endpoint(self):
        self.corrupt("UPDATE SupplierProductCapability SET productId='c-a' WHERE id='cap-active';");self.reject()
    def test_all_json_relationships_and_ancestry(self):
        for key,value in [('customerId','p-a'),('contactId','ct-supplier'),('productId','s-a'),('dealId','missing'),('primaryContactId','ct-supplier'),('parentId','l-a')]:
            with self.subTest(key=key):
                self.db.close();self.db=database()
                self.corrupt('UPDATE BusinessRecord SET payload=json_set(payload,'+r.literal('$.'+key)+','+r.literal(value)+") WHERE id='l-a';")
                self.reject()
    def test_deal_must_match_originating_lead(self):
        self.corrupt("UPDATE BusinessRecord SET payload=json_set(payload,'$.dealId','d-a') WHERE id='l-ren';");self.reject()
    def test_historical_contacts_names_renames_and_legacy(self):
        t=LocalTransport();self.restore(t)
        rows={ident:json.loads(payload) for ident,payload in t.db.execute('SELECT id,payload FROM BusinessRecord')}
        self.assertEqual(rows['c-a']['title'],rows['c-b']['title']);self.assertEqual(rows['l-a']['customerId'],'c-a');self.assertNotIn('primaryContactId',rows['c-b'])
        self.assertEqual(rows['c-ren']['title'],'Renamed Customer');self.assertEqual(rows['l-ren']['customerId'],'c-ren');self.assertEqual(rows['s-a']['title'],'Renamed Supplier');self.assertEqual(rows['p-a']['title'],'Renamed Product');self.assertNotIn('customerId',rows['legacy'])
        self.assertEqual(t.db.execute("SELECT active FROM Contact WHERE id='ct-history'").fetchone(),(0,));self.assertEqual(rows['l-history']['contactId'],'ct-history');self.assertIn('deletedAt',rows['l-history'])
    def test_malformed_truncated_and_duplicate_json(self):
        original=self.backup.read_text()
        for value in [original+'INSERT INTO User VALUES(',original.replace('"title": "Same Name Customer"','"title": "one", "title": "two"',1),original.replace('"customerId": "c-a"','"customerId": []',1)]:
            self.backup.write_text(value);self.reject()
    def test_interruption_is_incomplete_and_cannot_resume(self):
        for phase in ['tables','data','indexes','guards']:
            with self.subTest(phase=phase):
                args=self.args();args.rehearsal_stop_after=phase;t=LocalTransport()
                with self.assertRaises(r.RecoveryError):self.restore(t,args)
                self.assertEqual(json.loads(Path(args.report).read_text())['status'],'incomplete');self.assertTrue(t.db.execute('SELECT phase FROM '+r.MARKER).fetchone()[0].startswith('incomplete:'))
                args.rehearsal_stop_after=None
                with self.assertRaisesRegex(r.RecoveryError,'not empty'):self.restore(t,args)
    def test_nonempty_target_is_untouched(self):
        for name in ['existing','xcfx_existing']:
            with self.subTest(table=name):
                t=LocalTransport();t.db.execute('CREATE TABLE '+name+'(value TEXT)');t.db.execute('INSERT INTO '+name+" VALUES('keep')");t.db.commit();before=r.snapshot(t.db)
                with self.assertRaisesRegex(r.RecoveryError,'not empty'):self.restore(t)
                self.assertEqual(before,r.snapshot(t.db))
                self.assertEqual(t.db.execute('SELECT value FROM '+name).fetchall(),[('keep',)])
    def test_protected_target_and_remote_confirmation(self):
        config=self.root/'config.json';args=self.args(config=str(config),database='DB',local=True,remote=False,persist_to=str(self.root/'state'),confirm_isolated=None)
        original=json.loads('\n'.join(l for l in (r.ROOT/'wrangler.jsonc').read_text().splitlines() if not l.lstrip().startswith('//')))
        db=original['d1_databases'][0].copy();db['binding']='DB';db['database_name']='enercore-recovery-alias';config.write_text(json.dumps({'d1_databases':[db]}))
        with self.assertRaisesRegex(r.RecoveryError,'protected'):r.D1(args)
        db['database_id']='12345678-1111-4111-8111-123456789000';config.write_text(json.dumps({'d1_databases':[db]}));args.local=False;args.remote=True
        with self.assertRaisesRegex(r.RecoveryError,'confirmation'):r.D1(args)
    def test_backup_script_promotes_only_phase6_validated_exports(self):
        # Exercise the real shell wrapper in a temporary repository. Only the
        # remote exporter is a stand-in; no credentials/config are read live.
        repo=self.root/'backup-repo';(repo/'scripts').mkdir(parents=True)
        shutil.copytree(r.ROOT/'drizzle',repo/'drizzle')
        for name in ['backup-d1.sh','d1-recovery.py']:shutil.copy2(r.ROOT/'scripts'/name,repo/'scripts'/name)
        bin_dir=self.root/'bin';bin_dir.mkdir();stub=bin_dir/'npx'
        stub.write_text('#!'+sys.executable+"\nimport os,shutil,sys\na=sys.argv[1:]\nassert a[:4]==['--no-install','wrangler','d1','export']\nassert '--remote' in a and a[a.index('--env')+1]=='live'\nshutil.copyfile(os.environ['RECOVERY_TEST_EXPORT'],a[a.index('--output')+1])\n")
        stub.chmod(0o700)
        for valid in [True,False]:
            with self.subTest(valid=valid):
                out=self.root/('valid-backup' if valid else 'invalid-backup')
                if not valid:
                    original=self.backup.read_text()
                    broken='\n'.join(sql for sql in r.statements(original) if not r.canonical(sql).startswith('create trigger contact_insert_guard '))
                    self.assertNotEqual(broken,original)
                    self.backup.write_text(broken)
                result=subprocess.run(['bash',str(repo/'scripts/backup-d1.sh')],capture_output=True,text=True,env={**os.environ,'PATH':str(bin_dir)+os.pathsep+os.environ['PATH'],'BACKUP_DIR':str(out),'D1_DATABASE':'enercore-recovery-fixture','RECOVERY_TEST_EXPORT':str(self.backup)})
                if valid:
                    self.assertEqual(result.returncode,0,result.stderr)
                    exported=list(out.glob('*.sql'));self.assertEqual(len(exported),1)
                    self.assertEqual(exported[0].read_bytes(),self.backup.read_bytes())
                    self.assertEqual(json.loads(Path(str(exported[0])+'.validation.json').read_text())['status'],'validated')
                    self.assertEqual(exported[0].stat().st_mode & 0o777,0o600)
                else:
                    self.assertNotEqual(result.returncode,0);self.assertNotIn('BACKUP OK',result.stdout)
                    self.assertEqual(list(out.iterdir()),[])
    def test_cli_failed_preflight_cannot_reuse_success_receipt(self):
        report=self.root/'validation.json'
        cmd=[sys.executable,str(r.ROOT/'scripts/d1-recovery.py'),'validate',str(self.backup),'--report',str(report)]
        valid=subprocess.run(cmd,capture_output=True,text=True)
        self.assertEqual(valid.returncode,0)
        original=report.read_bytes()
        self.backup.write_text('INSERT INTO broken(')
        reused=subprocess.run(cmd,capture_output=True,text=True)
        self.assertNotEqual(reused.returncode,0);self.assertIn('must be new',reused.stderr)
        self.assertEqual(report.read_bytes(),original)
        fresh=self.root/'fresh-validation.json'
        failed=subprocess.run(cmd[:-1]+[str(fresh)],capture_output=True,text=True)
        self.assertNotEqual(failed.returncode,0);self.assertNotIn('BACKUP VALIDATED',failed.stdout)
        self.assertEqual(json.loads(fresh.read_text()),{'status':'incomplete','phase':'preflight'})
    def test_local_export_and_execute_must_address_same_target(self):
        config=self.root/'config.json'
        config.write_text(json.dumps({'d1_databases':[{'binding':'DB','database_name':'enercore-recovery-unit','database_id':'12345678-1111-4111-8111-123456789000'}]}))
        args=self.args(config=str(config),database='DB',local=True,remote=False,persist_to=str(self.root/'different-state'),confirm_isolated=None)
        with self.assertRaisesRegex(r.RecoveryError,'persist directory must'):r.D1(args)
        args.persist_to=str(self.root/'.wrangler/state')
        self.assertEqual(r.D1(args).persist,(self.root/'.wrangler/state').resolve())
        cfg=json.loads(config.read_text());cfg['env']={'live':{}};config.write_text(json.dumps(cfg))
        with self.assertRaisesRegex(r.RecoveryError,'standalone'):r.D1(args)
    def test_migration_history(self):
        self.db.execute("DELETE FROM d1_migrations WHERE name LIKE '0013%'");self.db.commit();export(self.db,self.backup);self.reject()
    def test_unexpected_and_modified_guards(self):
        original=self.backup.read_text();self.backup.write_text(original+"CREATE TRIGGER unexpected AFTER UPDATE ON User BEGIN DELETE FROM User; END;");self.reject()
        self.backup.write_text(original.replace("RAISE(ABORT,'commercial_primary_invalid')","RAISE(ABORT,'different_guard')"));self.reject()
    def test_target_mismatch_never_reports_success(self):
        t=LocalTransport();t.mutate_export=True
        with self.assertRaisesRegex(r.RecoveryError,'differ'):self.restore(t)
        self.assertEqual(json.loads((self.root/'receipt.json').read_text())['status'],'incomplete');self.assertTrue(t.db.execute('SELECT phase FROM '+r.MARKER).fetchone()[0].startswith('incomplete:'))
    def test_restored_constraints_are_active(self):
        t=LocalTransport();self.restore(t)
        for sql in ["INSERT INTO Deal SELECT 'dup',leadId,company,branch,createdAt FROM Deal", "UPDATE Contact SET parentId='c-b' WHERE id='ct-primary'", "UPDATE BusinessRecord SET payload=json_set(payload,'$.customerId','absent') WHERE id='l-a'", "UPDATE SupplierProductCapability SET productId='s-a' WHERE id='cap-active'"]:
            with self.subTest(sql=sql),self.assertRaises(sqlite3.IntegrityError):t.db.execute(sql)
    def test_strings_and_blobs_preserve_exact_values(self):
        self.db.execute('CREATE TABLE xcfx_extra(id TEXT PRIMARY KEY, value BLOB)');self.db.execute('INSERT INTO xcfx_extra VALUES(?,?)',('blob',bytes([0,255,10,39,59])));self.db.commit();export(self.db,self.backup)
        t=LocalTransport();self.restore(t);self.assertEqual(r.snapshot(self.db),r.snapshot(t.db));self.assertEqual(t.db.execute("SELECT value FROM xcfx_extra").fetchone(),(bytes([0,255,10,39,59]),))

if __name__=='__main__':
    import sys
    if '--list' in sys.argv:print(json.dumps(unittest.defaultTestLoader.getTestCaseNames(Recovery)))
    else:unittest.main()
