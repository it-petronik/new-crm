"""Real local D1 export/restore rehearsal. Every binding/state is disposable."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import uuid
from recovery_fixture import ROOT, r, legacy_sql, activity_sql, insert
from operations_fixture import operations_sql
from outbound_fixture import outbound_sql

def tasks_sql():
    now=1700000000000
    return '\n'.join([
        insert('AutomationRule',id='rule-r1',company='Petronik',name='Fictional lead follow-up',preset='lead_follow_up',enabled=1,conditions='{"statuses":[],"lookbackDays":0}',assigneeId=None,dueDays=0,dueTime='10:00',priority='normal',version=1,createdBy='recovery-user',updatedBy='recovery-user',createdAt=now,updatedAt=now),
        insert('Task',id='task-r1',company='Petronik',branch='Main',title="Follow up: fictional 'lead'",description='Δ line\nsecond',assigneeId='recovery-user',createdBy='recovery-user',priority='normal',status='open',dueDate='2026-10-08',dueTime='10:00',linkedRecordId='l-a',ruleId='rule-r1',dedupeKey='rule-r1:FOLLOW_UP_DUE:l-a:2026-10-08',version=1,createdAt=now,updatedAt=now,completedAt=None),
        insert('Task',id='task-r2',company='Petronik',branch='Main',title='Fictional manual task',description='',assigneeId='recovery-user',createdBy='recovery-user',priority='high',status='completed',dueDate='2026-10-07',dueTime=None,linkedRecordId=None,ruleId=None,dedupeKey=None,version=2,createdAt=now,updatedAt=now,completedAt=now),
        insert('AutomationRun',id='run-r1',ruleId='rule-r1',company='Petronik',dedupeKey='FOLLOW_UP_DUE:l-a:2026-10-08',trigger='FOLLOW_UP_DUE',recordId='l-a',taskId='task-r1',status='success',message='Created a task',attempts=1,createdAt=now,updatedAt=now),
        insert('AutomationRun',id='run-r2',ruleId='rule-r1',company='Petronik',dedupeKey='FOLLOW_UP_DUE:legacy:2026-10-08',trigger='FOLLOW_UP_DUE',recordId='legacy',taskId=None,status='skipped',message='Fictional owner is inactive.',attempts=1,createdAt=now,updatedAt=now),
        insert('AutomationEvent',id='RECORD_CREATED:legacy',company='Petronik',trigger='RECORD_CREATED',recordId='legacy',data='{}',attempts=1,lastError=None,createdAt=now,processedAt=now),
    ])+'\n'

def run(work):
    work=Path(work).resolve();work.mkdir(parents=True,exist_ok=True)
    migration_dir=work/'migrations';migration_dir.mkdir()
    for p in r.migrations('pre-phase6'):shutil.copy2(p,migration_dir/p.name)
    names=['source','target','interrupted','recreated','taskstarget','operationstarget','communicationtarget','mailboxtarget','mailfoldertarget']
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
    def restore(name,report,stop=None,source=None,schema='phase6'):
        cmd=['bash','scripts/restore-d1.sh',str(source or backup),'--schema',schema,'--local','--config',str(config),'--database',name.upper(),'--persist-to',str(work/'.wrangler/state'),'--report',str(work/report)]
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
    # Phase 8: the same source, upgraded through 0017 with fictional tasks,
    # automation rules, runs and an outbox event, restores under 'tasks'.
    for p in r.migrations('tasks'):
        if int(p.name[:4])>13:shutil.copy2(p,migration_dir/p.name)
    wrangler(['migrations','apply'],'enercore-recovery-source',[])
    tasks=work/'tasks.sql';tasks.write_text(tasks_sql());wrangler(['execute'],'enercore-recovery-source',['--file',str(tasks)])
    tasks_backup=work/'export-tasks.sql';wrangler(['export'],'enercore-recovery-source',['--output',str(tasks_backup)])
    tasks_expected=r.snapshot(r.load_backup(tasks_backup,'tasks'))
    restored=restore('taskstarget','tasks-receipt.json',source=tasks_backup,schema='tasks')
    if restored.returncode:raise RuntimeError('Tasks-profile restore failed: '+restored.stderr)
    tasks_export=work/'restored-tasks-export.sql';wrangler(['export'],'enercore-recovery-taskstarget',['--output',str(tasks_export)])
    tasks_actual=r.load_backup(tasks_export,'tasks')
    assert r.snapshot(tasks_actual)==tasks_expected
    assert tasks_actual.execute("SELECT linkedRecordId,ruleId,status FROM Task WHERE id='task-r1'").fetchone()==('l-a','rule-r1','open')
    assert tasks_actual.execute("SELECT status FROM AutomationRun ORDER BY id").fetchall()==[('success',),('skipped',)]
    summary={'status':'passed','tasksProfileValidated':True,'source':'Real local D1: pre-Phase-6 migrations, legacy row, migration 0013, fictional activity, Wrangler export','exactAllTableRows':True,'tables':expected,'exactSchema':True,'foreignKeyViolations':0,'integrityCheck':'ok','relationshipExamples':'passed','interruptedRestoreExitCode':failure.returncode,'interruptedMarker':state,'nonemptyTargetRefused':True,'freshReplacementValidated':True,'remoteOperations':0}
    # Phase 9: upgrade the same isolated source and restore the immutable
    # purchase, receipt/reversal and payment ledger with self-reference order.
    shutil.copy2(ROOT/'drizzle/0018_operations.sql',migration_dir/'0018_operations.sql')
    wrangler(['migrations','apply'],'enercore-recovery-source',[])
    ops=work/'operations.sql';ops.write_text(operations_sql());wrangler(['execute'],'enercore-recovery-source',['--file',str(ops)])
    ops_backup=work/'export-operations.sql';wrangler(['export'],'enercore-recovery-source',['--output',str(ops_backup)])
    ops_expected=r.snapshot(r.load_backup(ops_backup,'operations'))
    restored=restore('operationstarget','operations-receipt.json',source=ops_backup,schema='operations')
    if restored.returncode:raise RuntimeError('Operations-profile restore failed: '+restored.stderr)
    ops_export=work/'restored-operations-export.sql';wrangler(['export'],'enercore-recovery-operationstarget',['--output',str(ops_export)])
    ops_actual=r.load_backup(ops_export,'operations')
    assert r.snapshot(ops_actual)==ops_expected
    summary['operationsProfileValidated']=True
    shutil.copy2(ROOT/'drizzle/0019_outbound.sql',migration_dir/'0019_outbound.sql')
    wrangler(['migrations','apply'],'enercore-recovery-source',[])
    outbound=work/'outbound.sql';outbound.write_text(outbound_sql());wrangler(['execute'],'enercore-recovery-source',['--file',str(outbound)])
    comm_backup=work/'export-communication.sql';wrangler(['export'],'enercore-recovery-source',['--output',str(comm_backup)])
    comm_expected=r.snapshot(r.load_backup(comm_backup,'communication'))
    restored=restore('communicationtarget','communication-receipt.json',source=comm_backup,schema='communication')
    if restored.returncode:raise RuntimeError('Communication-profile restore failed: '+restored.stderr)
    comm_export=work/'restored-communication-export.sql';wrangler(['export'],'enercore-recovery-communicationtarget',['--output',str(comm_export)])
    comm_actual=r.load_backup(comm_export,'communication')
    assert r.snapshot(comm_actual)==comm_expected
    summary['communicationProfileValidated']=True
    shutil.copy2(ROOT/'drizzle/0020_private_mailboxes.sql',migration_dir/'0020_private_mailboxes.sql')
    wrangler(['migrations','apply'],'enercore-recovery-source',[])
    mailbox=work/'mailbox.sql'
    mailbox.write_text(insert('MailboxConnection',ownerId='recovery-user',id='fictional-mailbox',address='fixture@example.invalid',host='mail.petronik.ae',passwordSeal='fictional-encrypted-seal',createdAt=1)+'\n'+insert('MailboxMessage',id='fictional-mail',connectionId='fictional-mailbox',ownerId='recovery-user',uid=1,uidValidity='fixture',sender='buyer@example.invalid',recipient='fixture@example.invalid',subject='Private fixture',body='No real mail',receivedAt=1,isRead=0,candidate=1,truncated=0)+'\n')
    wrangler(['execute'],'enercore-recovery-source',['--file',str(mailbox)])
    mail_backup=work/'export-mailboxes.sql';wrangler(['export'],'enercore-recovery-source',['--output',str(mail_backup)])
    mail_expected=r.snapshot(r.load_backup(mail_backup,'mailboxes'))
    restored=restore('mailboxtarget','mailbox-receipt.json',source=mail_backup,schema='mailboxes')
    if restored.returncode:raise RuntimeError('Mailbox-profile restore failed: '+restored.stderr)
    mail_export=work/'restored-mailbox-export.sql';wrangler(['export'],'enercore-recovery-mailboxtarget',['--output',str(mail_export)])
    assert r.snapshot(r.load_backup(mail_export,'mailboxes'))==mail_expected
    summary['mailboxProfileValidated']=True
    shutil.copy2(ROOT/'drizzle/0021_mail_remote_folders.sql',migration_dir/'0021_mail_remote_folders.sql')
    wrangler(['migrations','apply'],'enercore-recovery-source',[])
    folder_sql=work/'mail-folder.sql';folder_sql.write_text(insert('MailboxRemoteMessage',id='folder-fixture',ownerId='recovery-user',connectionId='fictional-mailbox',folder='sent',path='INBOX.Sent',uid=1,uidValidity='folder-v1',sender='fixture@example.invalid',recipient='buyer@example.invalid',subject='Fictional sent email',body='Private sent body',receivedAt=1,isRead=1)+'\n')
    wrangler(['execute'],'enercore-recovery-source',['--file',str(folder_sql)])
    folder_backup=work/'export-mail-folders.sql';wrangler(['export'],'enercore-recovery-source',['--output',str(folder_backup)])
    folder_expected=r.snapshot(r.load_backup(folder_backup,'mail-folders'))
    restored=restore('mailfoldertarget','mail-folder-receipt.json',source=folder_backup,schema='mail-folders')
    if restored.returncode:raise RuntimeError('Mail-folder restore failed: '+restored.stderr)
    folder_export=work/'restored-mail-folder-export.sql';wrangler(['export'],'enercore-recovery-mailfoldertarget',['--output',str(folder_export)])
    assert r.snapshot(r.load_backup(folder_export,'mail-folders'))==folder_expected
    summary['mailFolderProfileValidated']=True
    (work/'rehearsal-result.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--work',required=True);a=p.parse_args();run(a.work)
