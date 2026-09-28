"""Fictional recovery dataset; no credentials or production connections."""
import importlib.util
import json
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('d1_recovery', ROOT/'scripts/d1-recovery.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
NOW = 1700000000000

def insert(table, **row):
    return 'INSERT INTO '+r.quote_name(table)+'('+','.join(r.quote_name(k) for k in row)+') VALUES('+','.join(r.literal(v) for v in row.values())+');'

def record(ident, kind, title=None, **extra):
    payload = {'id':ident,'kind':kind,'company':'Petronik','branch':'Main','title':title or ident,'ownerId':'recovery-user','owner':'Fictional Recovery User','status':'Active' if kind in ('customers','suppliers','products') else 'Draft','contact':'','product':'','quantity':0,'unit':'MT','amount':0,'currency':'USD','due':'','detail':'Fictional; notes with \'quotes\' and\nnewlines','source':'Recovery test','createdAt':'2023-11-14T22:13:20Z','updatedAt':'2023-11-14T22:13:20Z',**extra}
    return insert('BusinessRecord',id=ident,kind=kind,company=payload['company'],branch=payload['branch'],ownerId='recovery-user',status=payload['status'],payload=json.dumps(payload,ensure_ascii=False),version=1,createdAt=NOW,updatedAt=NOW)

def legacy_sql():
    return '\n'.join([
        insert('User',id='recovery-user',email='recovery@example.test',name='Fictional Recovery User',passwordHash='unusable-fictional-fixture-hash',role='MD',companies='["Petronik"]',branches='[]',moduleAccess='{}',active=1,createdAt=NOW),
        record('legacy','leads','Same Name Customer'),
    ])

def activity_sql():
    sql = [record('c-a','customers','Same Name Customer'),record('c-b','customers','Same Name Customer'),record('c-ren','customers','Before rename'),record('s-a','suppliers','Before supplier rename'),record('p-a','products','Before product rename')]
    for ident,parent,active in [('ct-primary','c-a',1),('ct-history','c-a',1),('ct-supplier','s-a',1),('ct-ren','c-ren',1)]:
        sql.append(insert('Contact',id=ident,parentId=parent,company='Petronik',branch='Main',details=json.dumps({'name':'Fictional '+ident,'notes':"Unicode Δ; apostrophe ' and\nnewline",'active':True}),active=active,version=1,createdAt=NOW,updatedAt=NOW))
    sql += ["UPDATE BusinessRecord SET payload=json_set(payload,'$.primaryContactId','ct-primary') WHERE id='c-a';",record('l-a','leads',customerId='c-a',contactId='ct-primary',productId='p-a'),record('l-history','leads',customerId='c-a',contactId='ct-history',deletedAt='2023-11-15T00:00:00Z'),record('l-ren','leads',customerId='c-ren',contactId='ct-ren',productId='p-a')]
    sql.append(insert('Deal',id='d-a',leadId='l-a',company='Petronik',branch='Main',createdAt=NOW))
    sql.append("UPDATE BusinessRecord SET payload=json_set(payload,'$.dealId','d-a') WHERE id='l-a';")
    links={'customerId':'c-a','contactId':'ct-primary','productId':'p-a','dealId':'d-a'}
    for ident,kind,parent in [('q-a','quotations','l-a'),('o-a','orders','q-a'),('shp-a','logistics','o-a'),('inv-a','accounts','o-a')]:
        sql.append(record(ident,kind,parentId=parent,**links))
    sql += ["UPDATE Contact SET active=0,details=json_set(details,'$.active',json('false')) WHERE id='ct-history';"]
    for ident,active in [('cap-active',1),('cap-inactive',0)]:
        sql.append(insert('SupplierProductCapability',id=ident,supplierId='s-a',productId='p-a',company='Petronik',branch='Main',details=json.dumps({'grade':'SN500','originCountry':'UAE','active':bool(active)}),active=active,version=1,createdAt=NOW,updatedAt=NOW))
    # Capabilities and Lead/Contact links exist BEFORE names change.
    for ident,title in [('c-ren','Renamed Customer'),('s-a','Renamed Supplier'),('p-a','Renamed Product')]:
        sql.append('UPDATE BusinessRecord SET payload=json_set(payload,\'$.title\','+r.literal(title)+') WHERE id='+r.literal(ident)+';')
    sql += [insert('AuditEvent',id='audit-1',company='Petronik',actor='Fictional Recovery User',actorId='recovery-user',action='customer renamed',recordId='c-ren',before='{"title":"Before rename"}',after='{"title":"Renamed Customer"}',at=NOW),
        insert('Meeting',id='meeting-1',createdBy='recovery-user',title='Fictional commercial review',kind='scheduled',media='video',status='ended',scheduledAt=NOW,durationMin=30,startedAt=NOW,endedAt=NOW+1800000,providerRoom='fictional-recovery-room',createdAt=NOW,guestAccess='off',relatedRecordId='l-a',relatedRecordKind='leads'),
        insert('MeetingActivity',id='meeting-activity-1',meetingId='meeting-1',type='ended',actorName='Fictional Recovery User',at=NOW),
        insert('MeetingNote',id='meeting-note-1',meetingId='meeting-1',authorId='recovery-user',kind='note',text="Fictional note; 'quoted'\nSecond line",createdAt=NOW),
        insert('MeetingReport',meetingId='meeting-1',version=1,fingerprint='fictional-fingerprint',report='{"summary":"Fictional reviewed requirement"}',models='[]',generatedBy='recovery-user',generatedAt=NOW),
        insert('AiUsage',id='ai-usage-1',userId='recovery-user',feature='deal_brief',model='fictional-model',status='success',durationMs=10,promptChars=25,outputChars=20,promptTokens=5,completionTokens=4,flaggedBlocks=0,createdAt=NOW)]
    return '\n'.join(sql)

def database(phase6=True):
    db=r.expected_schema('pre-phase6')
    db.executescript(legacy_sql())
    if phase6:
        db.executescript((ROOT/'drizzle/0013_commercial_operations.sql').read_text())
        db.executescript(activity_sql())
    db.execute('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)')
    db.executemany('INSERT INTO d1_migrations(name) VALUES(?)',[(p.name,) for p in r.migrations('phase6' if phase6 else 'pre-phase6')])
    db.commit()
    return db

def export(db,path):
    Path(path).write_text('\n'.join(db.iterdump())+'\n')

if __name__=='__main__':
    import sys
    print(legacy_sql() if sys.argv[1]=='legacy' else activity_sql())
