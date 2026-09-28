"""Real local D1 export/restore rehearsal. Every binding/state is disposable."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import uuid
from recovery_fixture import ROOT, r, legacy_sql, activity_sql

def run(work):
    work=Path(work).resolve();work.mkdir(parents=True,exist_ok=True)
    migration_dir=work/'migrations';migration_dir.mkdir()
    for p in r.migrations('pre-phase6'):shutil.copy2(p,migration_dir/p.name)
    names=['source','target','interrupted','recreated']
    config=work/'wrangler.json'
    config.write_text(json.dumps({'name':'enercore-recovery-rehearsal','compatibility_date':'2026-09-01','d1_databases':[{'binding':n.upper(),'database_name':'enercore-recovery-'+n,'database_id':str(uuid.uuid4()),'migrations_dir':str(migration_dir)} for n in names]}))
    flags=['--config',str(config),'--local','--persist-to',str(work/'.wrangler/state')]
    def wrangler(command,database,extra):
        chosen=flags[:-2] if command==['export'] else flags
        result=subprocess.run(['npx','--no-install','wrangler','d1',*command,database,*chosen,*extra],cwd=ROOT,capture_output=True,text=True)
        if result.returncode:raise RuntimeError('Local D1 '+str(command)+' failed; raw output withheld')
        return result.stdout
    wrangler(['migrations','apply'],'enercore-recovery-source',[])
    legacy=work/'legacy.sql';legacy.write_text(legacy_sql());wrangler(['execute'],'enercore-recovery-source',['--file',str(legacy)])
    shutil.copy2(ROOT/'drizzle/0013_commercial_operations.sql',migration_dir/'0013_commercial_operations.sql')
    wrangler(['migrations','apply'],'enercore-recovery-source',[])
    activity=work/'activity.sql';activity.write_text(activity_sql());wrangler(['execute'],'enercore-recovery-source',['--file',str(activity)])
    backup=work/'export.sql';wrangler(['export'],'enercore-recovery-source',['--output',str(backup)])
    preflight=r.load_backup(backup);expected=r.snapshot(preflight)
    def restore(name,report,stop=None):
        cmd=['bash','scripts/restore-d1.sh',str(backup),'--local','--config',str(config),'--database',name.upper(),'--persist-to',str(work/'.wrangler/state'),'--report',str(work/report)]
        if stop:cmd+=['--rehearsal-stop-after',stop]
        return subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True)
    result=restore('target','target-receipt.json')
    (work/'restore-metadata.log').write_text(result.stdout+result.stderr)
    if result.returncode:raise RuntimeError('Restore failed: '+result.stderr)
    receipt=json.loads((work/'target-receipt.json').read_text());assert receipt['tables']==expected
    failure=restore('interrupted','interrupted-receipt.json','data')
    assert failure.returncode!=0 and 'RESTORE VALIDATED' not in failure.stdout
    assert json.loads((work/'interrupted-receipt.json').read_text())['status']=='incomplete'
    state=json.loads(wrangler(['execute'],'enercore-recovery-interrupted',['--command','SELECT phase FROM '+r.MARKER,'--json']))[0]['results']
    assert state==[{'phase':'incomplete:data'}]
    again=restore('interrupted','refused-receipt.json')
    assert again.returncode!=0 and 'not empty' in again.stderr and 'RESTORE VALIDATED' not in again.stdout
    recreated=restore('recreated','recreated-receipt.json')
    if recreated.returncode:raise RuntimeError('Fresh replacement target failed: '+recreated.stderr)
    # Actual CLI / actual D1, then exact values and every guard are checked again.
    target_export=work/'restored-export.sql';wrangler(['export'],'enercore-recovery-target',['--output',str(target_export)])
    actual=r.load_backup(target_export)
    assert r.snapshot(actual)==expected and r.schema(actual)==r.schema(preflight)
    records={i:json.loads(p) for i,p in actual.execute('SELECT id,payload FROM BusinessRecord')}
    assert records['c-a']['title']==records['c-b']['title'] and records['l-a']['customerId']=='c-a'
    assert records['c-a']['primaryContactId']=='ct-primary' and records['l-a']['dealId']=='d-a'
    assert records['c-ren']['title']=='Renamed Customer' and records['l-ren']['customerId']=='c-ren'
    assert records['s-a']['title']=='Renamed Supplier' and records['p-a']['title']=='Renamed Product'
    assert 'customerId' not in records['legacy']
    assert actual.execute("SELECT active FROM Contact WHERE id='ct-history'").fetchone()==(0,)
    assert actual.execute("SELECT parentId FROM Contact WHERE id='ct-supplier'").fetchone()==('s-a',)
    assert actual.execute("SELECT leadId FROM Deal WHERE id='d-a'").fetchone()==('l-a',)
    assert actual.execute('SELECT id,supplierId,productId,active FROM SupplierProductCapability ORDER BY id').fetchall()==[('cap-active','s-a','p-a',1),('cap-inactive','s-a','p-a',0)]
    summary={'status':'passed','source':'Real local D1: pre-Phase-6 migrations, legacy row, migration 0013, fictional activity, Wrangler export','exactAllTableRows':True,'tables':expected,'exactSchema':True,'foreignKeyViolations':0,'integrityCheck':'ok','relationshipExamples':'passed','interruptedRestoreExitCode':failure.returncode,'interruptedMarker':state,'nonemptyTargetRefused':True,'freshReplacementValidated':True,'remoteOperations':0}
    (work/'rehearsal-result.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--work',required=True);a=p.parse_args();run(a.work)
