import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "../d1";
import type { Actor, RecordItem } from "../domain";
import { businessRecords, users } from "../schema";
import { hrEntries, hrFiles, hrHistory, hrRevision } from "./tables";
import {
  draftKinds,
  HrError,
  hrAccess,
  hrRecordKey,
  hrTransition,
  inHrScope,
  mayEditHr,
  mayReadHr,
  payrollBasis,
  validateHrValues,
  type HrCommand,
  type HrEmployee,
  type HrEntry,
  type HrFile,
  type HrHistory,
} from "./model";

const missing = () =>
  new HrError(404, "This HR record is not available to you.");
const LIMIT = 20000;
export async function employeeHasHrHistory(db: Database, id: string) {
  const installed = await db.all(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'HrEntry'`,
  );
  return installed.length
    ? Boolean(
        await db
          .select({ id: hrEntries.id })
          .from(hrEntries)
          .where(eq(hrEntries.employeeId, id))
          .get(),
      )
    : false;
}
export type HrView = {
  access: ReturnType<typeof hrAccess>;
  employees: HrEmployee[];
  entries: HrEntry[];
  files: HrFile[];
  history: HrHistory[];
  historyLimited: boolean;
  uploads: boolean;
};
const entry = (r: typeof hrEntries.$inferSelect) => r as HrEntry;
export async function hrEntry(db: Database, a: Actor, id: string) {
  const r = await db.select().from(hrEntries).where(eq(hrEntries.id, id)).get();
  if (!r || !mayReadHr(a, entry(r))) throw missing();
  return entry(r);
}
export async function hrRows(db: Database, a: Actor, company?: string) {
  if (!hrAccess(a).view)
    throw new HrError(
      403,
      "Your role does not have access to private HR records.",
    );
  if (company && company !== "All companies" && !a.companies.includes(company))
    throw missing();
  if (!a.companies.length) return [];
  const rows = await db
    .select()
    .from(hrEntries)
    .where(
      and(
        inArray(hrEntries.company, a.companies),
        a.branches.length ? inArray(hrEntries.branch, a.branches) : undefined,
        company && company !== "All companies"
          ? eq(hrEntries.company, company)
          : undefined,
      ),
    )
    .orderBy(desc(hrEntries.updatedAt))
    .limit(LIMIT + 1);
  if (rows.length > LIMIT)
    throw new HrError(
      422,
      "This HR register is too large to open together. Please ask your administrator to narrow the register before continuing.",
    );
  return rows.map(entry);
}
function employeeView(r: RecordItem): HrEmployee {
  return {
    id: r.id,
    company: r.company,
    branch: r.branch,
    title: r.title,
    contact: r.contact,
    due: r.due,
    status: r.status,
    department: r.attributes?.department || "",
  };
}
export async function hrView(
  db: Database,
  a: Actor,
  company?: string,
): Promise<HrView> {
  const access = hrAccess(a),
    rows = (await hrRows(db, a, company)).filter((e) => mayReadHr(a, e));
  const employeeIds = new Set(rows.map((e) => e.employeeId));
  const people = access.full
    ? await db
        .select({ payload: businessRecords.payload })
        .from(businessRecords)
        .where(
          and(
            eq(businessRecords.kind, "hr"),
            inArray(
              businessRecords.company,
              a.companies.length ? a.companies : ["__none__"],
            ),
            a.branches.length
              ? inArray(businessRecords.branch, a.branches)
              : undefined,
            company && company !== "All companies"
              ? eq(businessRecords.company, company)
              : undefined,
          ),
        )
        .limit(LIMIT + 1)
    : access.payrollOnly && employeeIds.size
      ? await db
          .select({ payload: businessRecords.payload })
          .from(businessRecords)
          .where(eq(businessRecords.kind, "hr"))
          .limit(LIMIT + 1)
      : [];
  if (people.length > LIMIT)
    throw new HrError(
      422,
      "Please narrow the employee register before continuing.",
    );
  const employees = people
    .map((r) => r.payload as RecordItem)
    .filter(
      (r) =>
        !r.deletedAt &&
        inHrScope(a, r) &&
        (access.full || employeeIds.has(r.id)),
    )
    .map(employeeView)
    .map((e) =>
      access.payrollOnly
        ? { ...e, contact: "", due: "", department: "", status: "" }
        : e,
    );
  const files: HrFile[] = [],
    history: HrHistory[] = [];
  let historyLimited = false;
  // Keep each D1 parameter list below its binding limit. Private audits never
  // enter the general workspace activity feed.
  for (let i = 0; i < rows.length; i += 70) {
    const slice = rows.slice(i, i + 70),
      ids = slice.map((e) => e.id);
    const documentIds = slice
      .filter((e) => e.kind === "document")
      .map((e) => e.id);
    const f = await db
      .select({
        id: hrFiles.id,
        entryId: hrFiles.entryId,
        name: hrFiles.name,
        mime: hrFiles.mime,
        size: hrFiles.size,
        createdBy: hrFiles.createdBy,
        createdAt: hrFiles.createdAt,
      })
      .from(hrFiles)
      .where(inArray(hrFiles.entryId, documentIds))
      .limit(1001);
    if (f.length > 1000)
      throw new HrError(
        422,
        "Please narrow the document register before opening its file versions.",
      );
    files.push(...f);
    const h = await db
      .select({
        id: hrHistory.id,
        entryId: hrHistory.entryId,
        actorName: hrHistory.actorName,
        action: hrHistory.action,
        reason: hrHistory.reason,
        at: hrHistory.at,
      })
      .from(hrHistory)
      .where(inArray(hrHistory.entryId, ids))
      .orderBy(desc(hrHistory.at))
      .limit(251);
    historyLimited ||= h.length > 250;
    history.push(...h.slice(0, 250));
  }
  history.sort((a, b) => b.at - a.at);
  historyLimited ||= history.length > 250;
  return {
    access,
    employees,
    entries: rows,
    files,
    history: history.slice(0, 250),
    historyLimited,
    uploads: false,
  };
}
export async function hrRevisionNumber(db: Database) {
  const r = await db
    .select()
    .from(hrRevision)
    .where(eq(hrRevision.id, 1))
    .get();
  if (!r)
    throw new HrError(
      503,
      "The HR register is not configured yet. Your administrator needs to complete the local HR setup.",
    );
  return r.revision;
}
// D1 batches are atomic. A failed compare-and-swap deliberately violates the
// NOT NULL revision constraint, rolling back EVERY following write and audit.
// No partially successful salary/payroll/file approval can escape this batch.
export function revisionClaim(
  db: Database,
  revision: number,
  parentGuard: SQL = sql`1`,
) {
  return db
    .update(hrRevision)
    .set({
      revision: sql`CASE WHEN ${hrRevision.revision} = ${revision} AND (${parentGuard}) THEN ${hrRevision.revision} + 1 ELSE NULL END`,
      token: crypto.randomUUID(),
    })
    .where(eq(hrRevision.id, 1));
}
export function hrAudit(
  db: Database,
  a: Actor,
  e: HrEntry,
  action: string,
  reason: string,
  before: unknown,
  after: unknown,
) {
  return db.insert(hrHistory).values({
    id: crypto.randomUUID(),
    entryId: e.id,
    company: e.company,
    branch: e.branch,
    actorId: a.id,
    actorName: a.name,
    action,
    reason,
    before,
    after,
    at: Date.now(),
  });
}
export function conflict(error: unknown): never {
  if (error instanceof HrError) throw error;
  const msg = String(
    error instanceof Error ? `${error.message} ${error.cause || ""}` : error,
  );
  if (/constraint|unique|locked|revision|HrEmployee/i.test(msg))
    throw new HrError(
      409,
      "This record changed or already exists. Refresh the register before trying again; no partial changes were saved.",
    );
  throw new HrError(
    503,
    "We couldn’t save the HR change. Refresh to check the register before trying again.",
  );
}
async function requestId(a: Actor, key: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${a.id}:hr:${key}`),
  );
  return `HR-${Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  )
    .join("")
    .slice(0, 40)}`;
}
export async function hrChange(db: Database, a: Actor, c: HrCommand) {
  const revision = await hrRevisionNumber(db); // Read BEFORE validation inputs.
  const all = await hrRows(db, a);
  if (c.action !== "save") {
    const before = all.find((e) => e.id === c.id);
    if (!before || !mayReadHr(a, before)) throw missing();
    if (before.version !== c.version)
      throw new HrError(
        409,
        "This HR record has changed. Refresh before reviewing it.",
      );
    const status = hrTransition(
      a,
      before,
      c.action,
      all,
      c.reason,
      c.reference,
    );
    const after = {
      ...before,
      status,
      version: before.version + 1,
      updatedAt: Date.now(),
      approvedBy: status === "Approved" ? a.id : before.approvedBy,
    };
    try {
      await db.batch([
        revisionClaim(db, revision),
        db
          .update(hrEntries)
          .set(after)
          .where(
            and(
              eq(hrEntries.id, before.id),
              eq(hrEntries.version, before.version),
            ),
          ),
        hrAudit(
          db,
          a,
          after,
          c.action,
          [c.reason, c.reference ? `Reference: ${c.reference}` : ""]
            .filter(Boolean)
            .join(" · "),
          before,
          after,
        ),
      ]);
    } catch (e) {
      conflict(e);
    }
    return after;
  }
  const v = c.values,
    id = c.id || (await requestId(a, c.requestId)),
    before = all.find((e) => e.id === id);
  if (before && (!mayEditHr(a, before) || !mayReadHr(a, before)))
    throw missing();
  if (before && !c.id) {
    // A retry of the same create is safe; it never overwrites later edits.
    return before;
  }
  if (c.id && (!before || c.version !== before.version))
    throw new HrError(409, "Reload this HR record before editing it.");
  if (before && !["Recorded", "Draft", "Rejected"].includes(before.status))
    throw new HrError(
      409,
      "Submitted or approved records are locked. Ask the reviewer to return a submitted proposal, or create a new correction proposal.",
    );
  let parentGuard: SQL = sql`1`,
    employee: HrEmployee | null = null;
  if (v.employeeId) {
    const row = await db
      .select()
      .from(businessRecords)
      .where(eq(businessRecords.id, v.employeeId))
      .get();
    const r = row?.payload as RecordItem | undefined;
    if (!r || !row || r.kind !== "hr" || r.deletedAt || !inHrScope(a, r))
      throw missing();
    employee = employeeView(r);
    parentGuard = sql`EXISTS (SELECT 1 FROM "BusinessRecord" WHERE "id" = ${r.id} AND "version" = ${row.version} AND json_extract("payload", '$.deletedAt') IS NULL)`;
  }
  const scope = employee || (v.kind === "document" ? v : null);
  if (
    !scope ||
    !mayEditHr(a, { ...scope, kind: v.kind, employeeId: v.employeeId })
  )
    throw new HrError(403, "Your role cannot change this HR record.");
  if (
    before &&
    (before.kind !== v.kind ||
      before.employeeId !== v.employeeId ||
      before.company !== scope.company ||
      before.branch !== scope.branch)
  )
    throw new HrError(
      400,
      "The employee, company and record type cannot be changed. Create a separate record instead.",
    );
  validateHrValues(v, employee, all);
  if (v.kind === "employment" && v.payload.userId) {
    if (!["MD", "MD Assistant", "IT Administrator", "HR Manager"].includes(a.role))
      throw new HrError(403, "Ask HR management to link an employee login.");
    const u = await db
      .select()
      .from(users)
      .where(eq(users.id, v.payload.userId))
      .get();
    if (
      !u?.active ||
      !u.companies.includes(scope.company) ||
      (u.branches.length && !u.branches.includes(scope.branch))
    )
      throw new HrError(
        400,
        "Choose an active login assigned to this employee’s company.",
      );
    if (
      all.some(
        (e) =>
          e.kind === "employment" && e.id !== id && e.payload.userId === u.id,
      )
    )
      throw new HrError(
        400,
        "This login is already linked to another employee.",
      );
  }
  const payload: Record<string, unknown> =
    v.kind === "payroll"
      ? { ...v.payload, ...payrollBasis(all, v.employeeId!, v.payload) }
      : v.payload;
  const now = Date.now();
  const after: HrEntry = {
    id,
    recordKey: hrRecordKey(v.kind, v.employeeId, payload, id),
    kind: v.kind,
    employeeId: v.employeeId,
    company: scope.company,
    branch: scope.branch,
    status: draftKinds.includes(v.kind) ? "Draft" : "Recorded",
    payload,
    createdBy: before?.createdBy || a.id,
    preparedBy: a.id,
    approvedBy: null,
    version: (before?.version || 0) + 1,
    createdAt: before?.createdAt || now,
    updatedAt: now,
  };
  try {
    await db.batch([
      revisionClaim(db, revision, parentGuard),
      before
        ? db
            .update(hrEntries)
            .set(after)
            .where(
              and(eq(hrEntries.id, id), eq(hrEntries.version, before.version)),
            )
        : db.insert(hrEntries).values(after),
      hrAudit(
        db,
        a,
        after,
        before ? "Updated" : "Created",
        String(payload.reason || payload.note || ""),
        before || null,
        after,
      ),
    ]);
  } catch (e) {
    conflict(e);
  }
  return after;
}
