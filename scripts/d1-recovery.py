#!/usr/bin/env python3
"""Validate an Enercore export and restore ONLY into an empty isolated D1 target.

No source SQL is sent to D1 before a complete in-memory rehearsal succeeds.
Logs/receipts contain schema names, counts and hashes, never row contents.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent.parent
MARKER = '_enercore_restore_state'

class RecoveryError(Exception):
    pass


def quote_name(name):
    return '"' + name.replace('"', '""') + '"'


def literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, bytes):
        return "X'" + value.hex() + "'"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


# SQLite's parser recognizes trigger BEGIN/END, quoted semicolons and escapes.
# A lexical scanner only removes comments and normalizes schema comparisons.
TOKEN = re.compile(r"--[^\n]*(?:\n|$)|/\*[\s\S]*?\*/|'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][\w]*|\d+(?:\.\d+)?|[^\s]", re.UNICODE)

def tokens(text):
    return [m.group() for m in TOKEN.finditer(text) if not m.group().startswith(('--', '/*'))]


def canonical(text):
    result = []
    for t in tokens(text):
        if t.startswith("'"):
            result.append(t)
        elif t[0] in '`"[':
            result.append(t[1:-1].replace(t[0]*2, t[0]).lower())
        else:
            result.append(t.lower())
    return ' '.join(result).replace('if not exists ', '').rstrip(' ;')


def statements(text):
    buf = []
    for ch in text:
        buf.append(ch)
        if ch == ';' and sqlite3.complete_statement(''.join(buf)):
            value = ''.join(buf)
            if tokens(value):
                yield value
            buf = []
    if tokens(''.join(buf)):
        raise RecoveryError('Incomplete SQL statement in backup')


def split_export(text):
    parts = {k: [] for k in ('tables', 'data', 'indexes', 'guards')}
    for sql in statements(text):
        words = canonical(sql)
        keywords = [t.lower() for t in tokens(sql) if t[0] not in "'\"`["]
        if re.fullmatch(r'(begin(?: transaction)?|commit|end|pragma defer_foreign_keys = (true|false|on|off|0|1))', words):
            continue
        if words == 'delete from sqlite_sequence':
            parts['data'].append(sql)
        elif words.startswith('create table '):
            if 'select' in keywords:
                raise RecoveryError('CREATE TABLE AS SELECT is not an export schema')
            parts['tables'].append(sql)
        elif words.startswith('insert into '):
            # Only VALUES exports, never INSERT SELECT, OR IGNORE or UPSERT.
            if 'values' not in keywords or any(k in keywords for k in ('select', 'returning', 'conflict')):
                raise RecoveryError('Unsupported INSERT form in backup')
            parts['data'].append(sql)
        elif words.startswith(('create index ', 'create unique index ')):
            parts['indexes'].append(sql)
        elif words.startswith('create trigger '):
            parts['guards'].append(sql)
        else:
            raise RecoveryError('Unsupported SQL statement in backup')
    if not parts['tables']:
        raise RecoveryError('Backup contains no tables')
    return parts


def migrations(profile):
    return [p for p in sorted((ROOT/'drizzle').glob('[0-9][0-9][0-9][0-9]_*.sql')) if int(p.name[:4]) <= {'pre-phase6': 12, 'phase6': 13, 'phase7': 14, 'phase7-apollo': 15}[profile]]


def expected_schema(profile):
    db = sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys=ON')
    for path in migrations(profile):
        db.executescript(path.read_text())
    return db


def schema(db):
    return {(kind, name): (table, canonical(sql)) for kind, name, table, sql in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name <> ?", (MARKER,))}


def check_schema(db, profile):
    reference = expected_schema(profile)
    wanted, found = schema(reference), schema(db)
    reference.close()
    for key, definition in wanted.items():
        if found.get(key) != definition:
            raise RecoveryError('Missing or incompatible schema object: ' + key[1])
    # Never install an unreviewed trigger with side effects during validation.
    if any(key[0] == 'trigger' and key not in wanted for key in found):
        raise RecoveryError('Unexpected trigger in backup')
    if profile == 'pre-phase6' and any(('table', name) in found for name in ['Contact', 'Deal', 'SupplierProductCapability']):
        raise RecoveryError('Phase 6 tables require the phase6 schema profile')
    if ('table', 'd1_migrations') in found:
        names = [r[0] for r in db.execute('SELECT name FROM d1_migrations')]
        if sorted(names) != sorted(p.name for p in migrations(profile)):
            raise RecoveryError('Migration history differs from the selected schema profile')


def json_object(text):
    def pairs(values):
        d = {}
        for k, v in values:
            if k in d:
                raise RecoveryError('Duplicate JSON key in backup')
            d[k] = v
        return d
    try:
        value = json.loads(text, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(RecoveryError('Non-finite JSON value')))
    except (TypeError, ValueError):
        raise RecoveryError('Malformed JSON in backup') from None
    if not isinstance(value, dict):
        raise RecoveryError('Expected a JSON object in backup')
    return value


def validate(db, profile):
    check_schema(db, profile)
    if db.execute('PRAGMA foreign_key_check').fetchall():
        raise RecoveryError('Foreign-key validation failed')
    if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
        raise RecoveryError('SQLite integrity validation failed')
    records = {}
    for ident, kind, company, branch, payload in db.execute('SELECT id,kind,company,branch,payload FROM BusinessRecord'):
        r = json_object(payload)
        if any(r.get(k) != v for k, v in [('id', ident), ('kind', kind), ('company', company), ('branch', branch)]):
            raise RecoveryError('BusinessRecord payload identity or scope differs from its row')
        records[ident] = r
    parents = {'quotations': 'leads', 'orders': 'quotations', 'logistics': 'orders', 'accounts': 'orders'}
    for r in records.values():
        parent_id = r.get('parentId')
        if parent_id is not None and not isinstance(parent_id, str):
            raise RecoveryError('Invalid BusinessRecord parent identifier')
        if parent_id:
            parent = records.get(parent_id) if isinstance(parent_id, str) else None
            if not parent or parent['kind'] != parents.get(r['kind']) or any(parent[k] != r[k] for k in ('company', 'branch')):
                raise RecoveryError('Invalid BusinessRecord parent kind, identity or scope')
        # Every ancestry edge must terminate; primary Contact and Deal cycles
        # are distinct, valid logical cycles handled by deferred guard creation.
        seen, current = set(), r
        while current:
            if current['id'] in seen:
                raise RecoveryError('Cyclic BusinessRecord ancestry')
            seen.add(current['id'])
            current = records.get(current.get('parentId'))
    if profile in ['phase6', 'phase7', 'phase7-apollo']:
        for table in ('Contact', 'SupplierProductCapability'):
            for (details,) in db.execute('SELECT details FROM ' + quote_name(table)):
                obj = json_object(details)
                if table == 'Contact' and (not isinstance(obj.get('name'), str) or not obj['name'].strip()):
                    raise RecoveryError('Contact name is missing')
        deal_leads = dict(db.execute('SELECT id,leadId FROM Deal'))
        for r in records.values():
            for key in ('customerId', 'contactId', 'productId', 'dealId', 'primaryContactId'):
                if r.get(key) is not None and (not isinstance(r[key], str) or not r[key]):
                    raise RecoveryError('Invalid commercial relationship identifier')
            if r.get('dealId'):
                lead = deal_leads.get(r['dealId'])
                current, seen = r, set()
                while current:
                    seen.add(current['id'])
                    current = records.get(current.get('parentId'))
                if lead not in seen:
                    raise RecoveryError('Deal does not belong to the originating Lead')
        # Reuse ALL installed relationship guards. Updating only id avoids
        # treating an unchanged inactive historical Contact as a new selection.
        # Roll back the validation transaction even on success: no row changes.
        db.execute('SAVEPOINT validate_guards')
        try:
            for table in ('Contact', 'Deal', 'SupplierProductCapability', 'BusinessRecord') + (('DealSupplier', 'SupplierRFQ', 'SupplierOffer', 'CommercialScenario', 'ApolloImport') if profile in ['phase7', 'phase7-apollo'] else ()):
                db.execute('UPDATE ' + quote_name(table) + ' SET id=id')
        finally:
            db.execute('ROLLBACK TO validate_guards')
            db.execute('RELEASE validate_guards')
    if profile in ['phase7', 'phase7-apollo']:
        for table in ('SupplierRFQ', 'SupplierOffer', 'CommercialScenario'):
            for (details,) in db.execute('SELECT details FROM '+quote_name(table)):
                json_object(details)
        broken=db.execute("SELECT 1 FROM SupplierOffer o LEFT JOIN SupplierOffer p ON p.id=o.previousId WHERE (o.revision=1 AND (o.previousId IS NOT NULL OR o.seriesId!=o.id)) OR (o.revision>1 AND (p.id IS NULL OR p.revision!=o.revision-1 OR p.seriesId!=o.seriesId OR p.dealId!=o.dealId OR p.supplierId!=o.supplierId OR p.productId!=o.productId OR p.status!='Superseded')) LIMIT 1").fetchone()
        if broken:
            raise RecoveryError('Invalid Supplier Offer revision chain')
    return snapshot(db)


def table_names(db):
    return sorted(r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name <> ?", (MARKER,)))


def snapshot(db):
    result = {}
    for name in table_names(db):
        columns = [r[1] for r in db.execute('PRAGMA table_info(' + quote_name(name) + ')')]
        encoded = []
        for row in db.execute('SELECT * FROM ' + quote_name(name)):
            encoded.append(json.dumps([{'blob': v.hex()} if isinstance(v, bytes) else v for v in row], ensure_ascii=False, separators=(',', ':'), allow_nan=False))
        digest = hashlib.sha256(json.dumps([columns, sorted(encoded)], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        result[name] = {'rows': len(encoded), 'sha256': digest}
    return result


def load_backup(path, profile='phase6'):
    parts = split_export(Path(path).read_text(encoding='utf-8'))
    db = sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys=ON')
    try:
        for sql in parts['tables']:
            db.execute(sql)
        # Metadata from a previous successful restore is not business data.
        if db.execute("SELECT 1 FROM sqlite_master WHERE name=?", (MARKER,)).fetchone():
            raise RecoveryError('Backup includes a recovery journal; export application tables from the validated target explicitly')
        db.execute('BEGIN')
        db.execute('PRAGMA defer_foreign_keys=ON')
        for sql in parts['data']:
            db.execute(sql)
        db.commit()
        for sql in parts['indexes'] + parts['guards']:
            db.execute(sql)
        validate(db, profile)
        return db
    except sqlite3.Error:
        db.close()
        raise RecoveryError('Backup rejected by a schema, data or relationship constraint') from None
    except Exception:
        db.close()
        raise


def plan(db):
    names = table_names(db)
    deps = {t: set(r[2] for r in db.execute('PRAGMA foreign_key_list(' + quote_name(t) + ')')) for t in names}
    ordered, visiting = [], set()
    def visit(t):
        if t in ordered:
            return
        if t in visiting:
            raise RecoveryError('Unsupported physical foreign-key cycle; target was not touched')
        if t not in deps:
            raise RecoveryError('Missing physical foreign-key table')
        visiting.add(t)
        for parent in sorted(deps[t]):
            if parent == t and t == "SupplierOffer":
                continue  # Phase 7 immutable revision chain is loaded oldest first.
            visit(parent)
        visiting.remove(t)
        ordered.append(t)
    for t in names:
        visit(t)
    parts = {'tables': [], 'data': [], 'indexes': [], 'guards': []}
    for t in ordered:
        parts['tables'].append(db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (t,)).fetchone()[0] + ';')
        columns = ','.join(quote_name(r[1]) for r in db.execute('PRAGMA table_info(' + quote_name(t) + ')'))
        rows = sorted(db.execute('SELECT * FROM ' + quote_name(t)).fetchall(), key=repr)
        if t == 'SupplierOffer':
            revision_index = [r[1] for r in db.execute('PRAGMA table_info(' + quote_name(t) + ')')].index('revision')
            rows.sort(key=lambda row: row[revision_index])
        parts['data'].extend('INSERT INTO ' + quote_name(t) + '(' + columns + ') VALUES(' + ','.join(literal(v) for v in row) + ');' for row in rows)
    # Preserve AUTOINCREMENT high-water marks when an export includes them.
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").fetchone():
        parts['data'].append('DELETE FROM sqlite_sequence;')
        parts['data'].extend('INSERT INTO sqlite_sequence(name,seq) VALUES(' + literal(n) + ',' + literal(v) + ');' for n, v in db.execute('SELECT name,seq FROM sqlite_sequence ORDER BY name'))
    for kind, key in [('index', 'indexes'), ('trigger', 'guards')]:
        parts[key] = [sql + ';' for (sql,) in db.execute('SELECT sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL ORDER BY name', (kind,))]
    return parts


class D1:
    def __init__(self, args):
        config = json.loads(Path(args.config).read_text())
        if config.get('env') or config.get('extends'):
            raise RecoveryError('Recovery config must be standalone with no environment overrides')
        candidates = [d for d in config.get('d1_databases', []) if args.database in (d.get('binding'), d.get('database_name'))]
        if len(candidates) != 1:
            raise RecoveryError('Target must identify exactly one binding in an explicit isolated JSON config')
        target = candidates[0]
        checked_in = json.loads('\n'.join(l for l in (ROOT/'wrangler.jsonc').read_text().splitlines() if not l.lstrip().startswith('//')))
        protected = checked_in.get('d1_databases', []) + [d for env in checked_in.get('env', {}).values() for d in env.get('d1_databases', [])]
        if not target.get('database_name', '').startswith('enercore-recovery-') or any(target.get('database_id') == d.get('database_id') or target.get('database_name') == d.get('database_name') for d in protected):
            raise RecoveryError('Refusing a protected or non-recovery target')
        if args.remote and args.confirm_isolated != target['database_name']:
            raise RecoveryError('Remote restore requires the exact isolated target name as confirmation')
        if args.remote and args.rehearsal_stop_after:
            raise RecoveryError('Interruption rehearsal is local only')
        if args.local and not args.persist_to:
            raise RecoveryError('Local restore requires a dedicated persist directory')
        # Wrangler local export has no --persist-to flag. Require its exact
        # default path so export and execute can never address different DBs.
        default_state = Path(args.config).resolve().parent/'.wrangler/state'
        if args.local and Path(args.persist_to).resolve() != default_state:
            raise RecoveryError('Local persist directory must be <isolated-config-directory>/.wrangler/state for Wrangler export')
        self.local = args.local
        self.persist = Path(args.persist_to).resolve() if args.local else None
        self.target = target['database_name']
        self.base = ['npx', '--no-install', 'wrangler', 'd1']
        self.flags = ['--config', str(Path(args.config).resolve()), '--remote' if args.remote else '--local']
        if args.local:
            self.flags += ['--persist-to', str(Path(args.persist_to).resolve())]
    def run(self, command, extra):
        flags = list(self.flags)
        if command == 'export' and '--persist-to' in flags:
            i = flags.index('--persist-to'); del flags[i:i+2]
        r = subprocess.run(self.base + [command, self.target] + flags + extra, cwd=ROOT, capture_output=True, text=True, env={**os.environ, 'CI': '1', 'WRANGLER_SEND_METRICS': 'false'})
        if r.returncode:
            raise RecoveryError('D1 ' + command + ' failed; raw output withheld because it can contain backup data')
        return r.stdout
    def query(self, sql):
        try:
            data = json.loads(self.run('execute', ['--command', sql, '--json']))
            return [row for item in data for row in item.get('results', [])]
        except (ValueError, TypeError):
            raise RecoveryError('D1 returned an invalid query response') from None
    def execute_file(self, path):
        self.run('execute', ['--file', str(path)])
    def export(self, path):
        self.run('export', ['--output', str(path)])
    def physical_integrity(self, run_id):
        if not self.local:
            return None  # Remote D1 exposes quick_check, not integrity_check.
        matches = []
        for path in (self.persist/'v3/d1').rglob('*.sqlite'):
            db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
            try:
                if db.execute("SELECT 1 FROM sqlite_master WHERE name=?", (MARKER,)).fetchone() and db.execute('SELECT 1 FROM ' + MARKER + ' WHERE runId=?', (run_id,)).fetchone():
                    matches.append(db.execute('PRAGMA integrity_check').fetchall())
            finally:
                db.close()
        if matches != [[('ok',)]]:
            raise RecoveryError('Isolated target physical SQLite integrity check failed')
        return 'ok'


def restore(args, transport=None):
    # All validation, planning and target safety checks precede target writes.
    backup_sha = hashlib.sha256(Path(args.backup).read_bytes()).hexdigest()
    source = load_backup(args.backup, args.schema)
    if hashlib.sha256(Path(args.backup).read_bytes()).hexdigest() != backup_sha:
        raise RecoveryError('Backup changed during preflight')
    expected = snapshot(source)
    parts = plan(source)
    source_schema = schema(source)
    d1 = transport or D1(args)
    existing = d1.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'")
    if existing:
        raise RecoveryError('Target is not empty; discard/recreate the isolated target, never resume in place')
    run_id = str(uuid.uuid4())
    stage = 'journal'
    receipt = {'status': 'incomplete', 'target': d1.target, 'phase': stage, 'backupSha256': backup_sha}
    report = Path(args.report)
    report.parent.mkdir(parents=True, exist_ok=True)
    def save():
        report.write_text(json.dumps(receipt, indent=2) + '\n')
        os.chmod(report, 0o600)
    save()
    with tempfile.TemporaryDirectory(prefix='enercore-recovery-') as temp:
        temp = Path(temp)
        try:
            d1.query('CREATE TABLE ' + MARKER + " AS SELECT 'incomplete:journal' AS phase," + literal(run_id) + ' AS runId;')
            # One ordered import avoids a separate Wrangler/runtime startup
            # for every journal update and phase. The journal is already
            # committed, so a failed import cannot leave a healthy target.
            loading = []
            for phase, sqls in parts.items():
                loading.append('UPDATE ' + MARKER + ' SET phase=' + literal('incomplete:' + phase) + ';')
                loading.extend(sqls)
                if args.rehearsal_stop_after == phase:
                    break
            stage = 'loading'
            receipt.update(phase=stage, plannedThrough=phase)
            save()
            path = temp/'ordered-load.sql'
            path.write_text('\n'.join(loading) + '\n')
            os.chmod(path, 0o600)
            d1.execute_file(path)
            stage = phase
            if args.rehearsal_stop_after:
                raise RecoveryError('Requested local interruption rehearsal')
            stage = 'validation'
            receipt['phase'] = stage
            save()
            # D1 returns one results array per statement. FK violations add
            # rows, so exactly one quick_check='ok' row proves both checks.
            checks = d1.query("UPDATE " + MARKER + " SET phase='incomplete:validation'; PRAGMA foreign_key_check; PRAGMA quick_check;")
            if len(checks) != 1 or checks[0] != {'quick_check': 'ok'}:
                raise RecoveryError('Target foreign-key or D1 quick_check validation failed')
            physical = d1.physical_integrity(run_id) if hasattr(d1, 'physical_integrity') else None
            # Journal lives on target while we export only application objects.
            target_file = temp/'target.sql'
            d1.export(target_file)
            raw = target_file.read_text()
            filtered = []
            for sql in statements(raw):
                tok = tokens(sql)
                if any(t.strip('`"[]') == MARKER for t in tok):
                    continue
                filtered.append(sql)
            target_file.write_text('\n'.join(filtered))
            restored = load_backup(target_file, args.schema)
            actual = snapshot(restored)
            if actual != expected or schema(restored) != source_schema:
                raise RecoveryError('Target rows or schema differ from the backup')
            # Source/target exact equality plus re-running every guard against
            # the exported target establishes the relationship invariants.
            receipt.update(status='validated', phase='complete', tables=actual, foreignKeyViolations=0, integrityCheck='ok', exactSchemaMatch=True, exactRowsMatch=True, d1QuickCheck='ok', localPhysicalIntegrityCheck=physical, exportSqliteIntegrityCheck='ok')
            # Remove the temporary journal only after all validation succeeds.
            d1.query('DROP TABLE ' + MARKER)
            save()
            print('RESTORE VALIDATED ' + json.dumps({'target': d1.target, 'tables': len(actual), 'rows': sum(v['rows'] for v in actual.values())}))
            return receipt
        except BaseException:
            receipt.update(status='incomplete', phase=stage)
            save()
            print('RESTORE INCOMPLETE phase=' + stage + '; discard/recreate the isolated target before retrying', file=sys.stderr)
            raise
        finally:
            source.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    for name in ['validate', 'restore']:
        p = sub.add_parser(name)
        p.add_argument('backup')
        p.add_argument('--schema', choices=['phase7-apollo', 'phase7', 'phase6', 'pre-phase6'], default='phase6')
        p.add_argument('--report', required=True)
        if name == 'restore':
            mode = p.add_mutually_exclusive_group(required=True)
            mode.add_argument('--local', action='store_true')
            mode.add_argument('--remote', action='store_true')
            p.add_argument('--config', required=True)
            p.add_argument('--database', required=True)
            p.add_argument('--persist-to')
            p.add_argument('--confirm-isolated')
            p.add_argument('--rehearsal-stop-after', choices=['tables', 'data', 'indexes', 'guards'])
    args = parser.parse_args()
    try:
        report_path = Path(args.report)
        if report_path.exists() or report_path.resolve() == Path(args.backup).resolve():
            raise RecoveryError('Report path must be new and distinct from the backup')
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps({'status':'incomplete','phase':'preflight'}) + '\n')
        os.chmod(report_path, 0o600)
        if args.action == 'validate':
            db = load_backup(args.backup, args.schema)
            plan(db)
            result = {'status': 'validated', 'schemaProfile': args.schema, 'tables': snapshot(db), 'objects': sorted(k[1] for k in schema(db)), 'foreignKeyViolations': 0, 'integrityCheck': 'ok'}
            path = Path(args.report)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(result, indent=2) + '\n')
            os.chmod(path, 0o600)
            print('BACKUP VALIDATED tables=' + str(len(result['tables'])))
        else:
            signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(RecoveryError('Interrupted')))
            restore(args)
    except (RecoveryError, sqlite3.Error, OSError, ValueError, KeyboardInterrupt) as e:
        # SQLite errors can include SQL values. Never emit them or raw CLI output.
        message = str(e) if isinstance(e, RecoveryError) else type(e).__name__
        print('RECOVERY FAILED: ' + message, file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
