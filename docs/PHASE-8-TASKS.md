# Phase 8 — Tasks, My Day and task automation

Status: implemented and verified **locally only** (isolated local D1 with
fictional data). Migration `0017_tasks_automation.sql` has not been applied to
any remote database, nothing has been deployed, and no automation rule exists
outside the local review database.

### Follow-up verification — 19 October 2026

The existing Phase 8 implementation was inspected and retained. A request-retry
access gap was corrected: both duplicate submission paths now recheck visibility
of the original task after company access changes. A regression test reproduces
the revoked-company case. The full unit run passes 499 checks; type checking
passes. Four local browser scenarios cover the themed responsive views, task
lifecycle/history, record/Action Center integration, triage deduplication and
restricted executive access. Phase 4 remains on hold; no production changes
are part of this verification.

The final OpenNext build and real local D1 recovery rehearsal also pass,
including the tasks schema profile, exact restore checks and interrupted-restore
protection. Browser tickets use unique per-run names so retained review data
does not produce false duplicate failures. The local review is available at
`http://localhost:8788/workspace/all-companies/tasks`, using fictional account
`studio@collab.test` and password `Collab-Test-Password-1`.

## What people see

**Tasks** is a workspace view next to the Action Center (live workspace only;
hidden in the browser-only preview). It has one navigation entry and one URL:
`/workspace/{company}/tasks`.

- **My Day views:** Today, Overdue, Upcoming and Completed (completed and
  cancelled). Dates are the Dubai business day; a task due today whose time has
  passed is shown in red with "past due time".
- **Mine / Team:** everyone sees tasks assigned to them. Team roles (MD, MD
  Assistant, Group/Branch Manager, Sales/Logistics/Accounts/HR Manager) can switch
  to Team, limited to their companies and, for branch-limited people, their
  branches (plus tasks they created or were given).
- **Search, filters, sorting, pagination:** title/description search (wildcards
  are literal), priority, status, source (people / automation), sort by due
  date, priority, last update or title; 10/20/50 per page.
- **A task:** title, description, assignee, company, priority (Low, Normal,
  High, Urgent), due date and optional time, and an optional link to one CRM
  record (lead, quotation, order, shipment, invoice, customer, supplier,
  product, campaign or IT ticket; never HR or leave). Status: Open, In
  Progress, Completed, Cancelled — each with its own badge tone.
- **Actions:** create, edit, start, complete (one click on the circle), reopen,
  reassign and cancel. The detail drawer shows the linked record (or "A record
  you can't open"), who created it (a person or "Automation · rule name") and
  the full history with field-level changes.
- **Record pages:** each linkable record shows its tasks (under Activity on
  commercial records) with **Add task**, which pre-links the new task.
- **Action Center:** open tasks due today or overdue appear as items. If the
  task is about a record that already has an Action Center item (for example
  "Follow-up due today" on a lead), the task is shown on that item
  ("Task: …") instead of as a second row. Tasks are not snoozable or
  dismissible; they clear when completed or cancelled.
- **Notifications:** the assignee gets an in-app "Task assigned to you" when
  someone else (or a rule) gives them a task. No email or external message is
  sent.

## Who may do what (checked on the server for every request)

| Action | Allowed |
| --- | --- |
| See a task | its assignee or creator (while they still have the company), or a team role whose company/branch scope contains it |
| Edit, start, complete, reopen | assignee, creator, or a team role in scope (not MD Assistant) |
| Reassign, cancel | creator, or a team role in scope (not MD Assistant) |
| Assign to someone else | team roles only; everyone may plan tasks for themselves |

Every assignee is validated independently: active, in the task's company and
branch, and — for a linked task — already able to open that record under the
normal record rules. A task never grants access to its company or record.
A linked record must be readable by the person linking it and in the same
company; HR and leave records cannot be linked. The database enforces the
same company/branch for a task, its record and its rule with triggers.

Every write is one D1 batch (task + audit entry) and carries the version the
person saw; a stale edit is refused with "Someone else changed this task" and
the latest version is shown. A new task carries a request id, so a retried
submission returns the same task. Task history is stored in `AuditEvent` with
`subject = 'task'` and is shown only in that task's history, never in the
Activity feed.

## Automation

Built on the existing typed rule engine (`src/lib/proactive/automation.ts`):
each stored rule becomes a `Rule` whose only action is the new `CREATE_TASK`.
There is no scripting. One rule per preset per company; **every rule starts
switched off**.

| Preset | Trigger | Task | Assignee | Conditions |
| --- | --- | --- | --- | --- |
| Lead follow-up due | an open lead's follow-up date arrives | `Follow up: {lead}`, linked to the lead | the lead's owner | lead stages, catch-up of 0–7 days overdue, branches |
| IT ticket triage | an IT ticket is created (records API or My requests) | `Triage ticket: {ticket}`, linked to the ticket | one chosen person | ticket priorities, branches |
| Operations handoff | a quotation is accepted and the workflow has created its order/shipment/invoice | `Operations handoff: {order}`, linked to the new sales order | one chosen person | branches |

Each rule also has a name, due date offset (same day … 30 days), optional due
time, and priority. **Preview** is read-only (today's matching leads, or recent
examples) and states what would be created or skipped and why. **History**
lists every run as Succeeded, Skipped or Failed with a plain message
("Gary Former is inactive. No task was created.", "An earlier follow-up task
for this lead is still open.", "The task could not be created after 3
attempts…"). Record titles in preview/history are shown only to people who can
open them.

Who may change rules: MD and Group Manager for all presets; Sales Manager for
lead follow-ups; IT Administrator for IT triage; Logistics Manager for the
operations handoff — company-wide (not branch-limited) people with write
access to that module. Branch Managers and the MD Assistant may view.
A chosen assignee must be active, in the company and able to open that kind of
record owned by others; a branch-limited person can only be chosen when the
rule is limited to their branches.

### Reliability

- **Outbox:** the IT-ticket and quotation-acceptance triggers write an
  `AutomationEvent` in the **same batch** as the business change (only when an
  enabled rule exists). A stale or failed change rolls the event back with it.
  Events are processed right after the response and by the five-minute sweep.
- **Dedupe:** each (rule, condition) has one key — `FOLLOW_UP_DUE:{lead}:{date}`,
  `RECORD_CREATED:{ticket}`, `STATUS_CHANGED:{quotation}`. The task, its run
  row and its audit entry are one batch protected by unique indexes, so
  repeated or concurrent sweeps and replayed events never create a second task.
- **Retries:** an unexpected error leaves the event pending; after three
  attempts the rule's history records a Failed run with an actionable message.
  A business reason (inactive owner, ineligible person, missing order) is a
  Skipped run and is not retried.
- **No loops:** creating a task never writes a business record and never
  enqueues an event. The quotation workflow alone creates the order, shipment
  and invoice; the handoff rule only links to the order.
- **Schedule:** the existing `*/5 * * * *` cron runs the meeting sweep and the
  task automation sweep side by side (`src/realtime/automation-sweep.ts`). It
  does nothing in preview mode.

## Data (migration 0017, additive)

`AutomationRule`, `Task`, `AutomationRun`, `AutomationEvent`, their indexes
(including unique `Task_dedupeKey_key`, `AutomationRun_rule_key`,
`AutomationRule_company_preset_key`) and five scope triggers. No existing table,
column, index or trigger changes; no rows are written by the migration.

## Local review

`npm run dev:review` seeds (fictional, local only) tasks in every state for
`studio@collab.test`, team tasks for `cmsales@collab.test` and
`cmit@collab.test`, three rules (lead follow-up and handoff enabled, IT triage
disabled) and Succeeded/Skipped/Failed history. The test-only entrypoint
exposes a token-protected `/__test/automation-sweep` (absent from `worker.ts`)
so a reviewer can run the scheduled sweep on demand.

## Verification performed (local)

- `node --import tsx --test tests/*.test.ts` — all pass, including
  `tests/tasks.test.ts` (access across companies/branches/roles, invalid and
  inactive assignees, inaccessible and cross-company links, DB trigger guards,
  concurrent edits, retries, status workflow and history, rule permissions,
  disabled rules, read-only preview, repeated/concurrent scheduled runs,
  skipped/failed outcomes, outbox atomicity, quotation handoff with exactly
  three downstream records, no recursion, Action Center folding).
- `python3 tests/recovery_test.py` and `tests/recovery_rehearsal.py` — backup
  validation and isolated restore with the new `tasks` profile on real local
  D1.
- `npm run typecheck`, `npm run cf:build`.
- `e2e/collab/tasks.spec.ts` against `npm run dev:review` (desktop 1440,
  tablet 900, phone 390; light and dark; no horizontal overflow; create →
  complete → reopen with history; record Tasks section; Action Center; rule
  preview/history; enabling IT triage and creating a ticket produces exactly
  one task even after repeated sweeps; executive access limits).

## Known limitations

- The Task list's linked-record search uses the records already loaded in the
  workspace (the most recent 1,000 the person may read).
- Lead follow-up tasks are created by the five-minute sweep, so a follow-up
  set for today appears within about five minutes, not instantly.
- A Skipped run is final for that condition (by design, to avoid surprise late
  tasks); create the task by hand after fixing the cause. A changed follow-up
  date is a new condition.
- Rule branches are typed as text; unknown branch names simply match nothing.
- Notifications are in-app only.
