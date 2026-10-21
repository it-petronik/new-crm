import test from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { d1, migratedDatabase } from "./support/sqlite-d1";
import * as schema from "../src/lib/schema";
import type { Database } from "../src/lib/d1";
import { roles, type Actor, type RecordItem } from "../src/lib/domain";
import { makePreview } from "../src/lib/fixtures";
import { localHrUploadsAllowed } from "../src/lib/hr/storage";
import { probationReviewDate } from "../src/lib/hr/model";
import {
  attendanceMinutes,
  expiryState,
  hrAccess,
  hrCommandSchema,
  hrValueSchema,
  mayReadHr,
  payrollBasis,
  validateHrValues,
  type HrEntry,
  type HrValues,
} from "../src/lib/hr/model";
import {
  hrChange,
  hrView,
  hrEntry,
  hrRevisionNumber,
  revisionClaim,
  employeeHasHrHistory,
} from "../src/lib/hr/store";
const actor = (role: Actor["role"], id = role): Actor => ({
  id,
  name: id,
  role,
  companies: ["Petronik"],
  branches: [],
});
const hr = actor("HR Manager"),
  md = actor("MD"),
  it = actor("IT Administrator"),
  assistant = actor("MD Assistant"),
  accountant = actor("Accountant"),
  sales = actor("Sales Executive");
function setup() {
  const sqlite = migratedDatabase(),
    db = drizzle(d1(sqlite) as never, { schema }) as Database;
  for (const role of roles) {
    const a = actor(role);
    sqlite
      .prepare(
        "INSERT INTO User(id,email,name,passwordHash,role,companies,branches,active,createdAt) VALUES(?,?,?,?,?,?,?,1,1)",
      )
      .run(
        a.id,
        `${a.id}@example.invalid`,
        a.name,
        "fictional",
        a.role,
        '["Petronik"]',
        "[]",
      );
  }
  const r: RecordItem = {
    ...makePreview().records[0],
    id: "employee-1",
    kind: "hr",
    company: "Petronik",
    branch: "Main",
    title: "Fictional employee",
    contact: "Sales",
    status: "Active",
    due: "2026-01-01",
    attributes: { department: "Sales", basicSalary: "999999" },
    ownerId: hr.id,
    owner: hr.name,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  sqlite
    .prepare(
      "INSERT INTO BusinessRecord(id,kind,company,branch,ownerId,status,payload,version,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,1,1,1)",
    )
    .run(
      r.id,
      r.kind,
      r.company,
      r.branch,
      r.ownerId,
      r.status,
      JSON.stringify(r),
    );
  const save = (
    a: Actor,
    values: unknown,
    existing?: HrEntry,
    requestId = crypto.randomUUID(),
  ) =>
    hrChange(
      db,
      a,
      hrCommandSchema.parse({
        action: "save",
        requestId,
        values,
        ...(existing ? { id: existing.id, version: existing.version } : {}),
      }),
    );
  const act = (
    a: Actor,
    e: HrEntry,
    action: "submit" | "approve" | "reject" | "paid" | "archive",
    reason = "Reviewed",
    reference = "",
  ) =>
    hrChange(db, a, {
      action,
      id: e.id,
      version: e.version,
      reason,
      reference,
    });
  const salary = (
    effectiveDate = "2026-01-01",
    basicCents = 500000,
  ): HrValues =>
    hrValueSchema.parse({
      kind: "compensation",
      employeeId: r.id,
      payload: {
        change: "Starting salary",
        effectiveDate,
        basicCents,
        allowanceCents: 50000,
        currency: "AED",
        reason: "Agreed contract",
      },
    });
  async function approvedSalary() {
    let e = await save(hr, salary());
    e = await act(hr, e, "submit");
    return act(md, e, "approve");
  }
  const attendance = (date = "2026-01-02") => ({
    kind: "attendance",
    employeeId: r.id,
    payload: {
      date,
      status: "Present",
      start: "09:00",
      end: "18:00",
      breakMinutes: 60,
      reason: "HR checked",
    },
  });
  const document = (employee = true): HrValues =>
    hrValueSchema.parse({
      kind: "document",
      employeeId: employee ? r.id : null,
      company: "Petronik",
      branch: "Main",
      payload: {
        title: employee ? "Passport" : "Licence",
        category: employee ? "Passport" : "Trade licence",
        expiryDate: "2026-11-01",
      },
    });
  return {
    sqlite,
    db,
    r,
    save,
    act,
    salary,
    approvedSalary,
    attendance,
    document,
  };
}
test("employee files allow MD, assistant and HR, but exclude general IT", () => {
  for (const role of roles)
    assert.equal(
      hrAccess(actor(role)).employeeDocuments,
      ["MD", "MD Assistant", "HR Manager", "HR Executive"].includes(role),
    );
  assert.equal(hrAccess(assistant).companyDocuments, true);
  assert.equal(hrAccess(assistant).full, true);
  assert.equal(
    hrAccess({ ...hr, moduleAccess: { hr: "read" } }).editEmployeeDocuments,
    false,
  );
  assert.equal(hrAccess({ ...md, moduleAccess: { hr: "none" } }).view, false);
});
test("ordinary staff cannot enter attendance, read salaries or private HR API", async () => {
  const s = setup();
  await assert.rejects(s.save(sales, s.attendance()), /role|available/);
  await assert.rejects(hrView(s.db, sales), /role/);
  s.sqlite.close();
});
test("salary proposals require separate approval and keep approved figures locked", async () => {
  const s = setup();
  let e = await s.save(hr, s.salary());
  assert.equal(e.status, "Draft");
  await assert.rejects(s.act(md, e, "approve"), /different/);
  e = await s.act(hr, e, "submit");
  await assert.rejects(s.act(hr, e, "approve"), /different/);
  e = await s.act(md, e, "approve");
  assert.equal(e.status, "Approved");
  await assert.rejects(s.save(hr, s.salary(), e), /locked/);
  assert.throws(
    () =>
      s.sqlite
        .prepare("UPDATE HrEntry SET payload=? WHERE id=?")
        .run("{}", e.id),
    /locked/,
  );
  s.sqlite.close();
});
test("latest preparer cannot approve their own correction", async () => {
  const s = setup();
  let e = await s.save(hr, s.salary());
  e = await s.act(hr, e, "submit");
  e = await s.act(md, e, "reject");
  e = await s.save(md, s.salary(), e);
  assert.equal(e.preparedBy, md.id);
  e = await s.act(md, e, "submit");
  await assert.rejects(s.act(md, e, "approve"), /different/);
  assert.equal((await s.act(it, e, "approve")).status, "Approved");
  s.sqlite.close();
});
test("attendance is one daily HR record with timed corrections and retained history", async () => {
  const s = setup();
  let e = await s.save(hr, s.attendance());
  assert.equal(e.status, "Recorded");
  assert.equal(attendanceMinutes(e.payload), 480);
  await assert.rejects(s.save(hr, s.attendance()), /exists|changed/);
  e = await s.save(
    hr,
    {
      ...s.attendance(),
      payload: {
        ...s.attendance().payload,
        reason: "Corrected break",
        breakMinutes: 90,
      },
    },
    e,
  );
  assert.equal(attendanceMinutes(e.payload), 450);
  assert.equal((await hrView(s.db, md)).history.length, 2);
  s.sqlite.close();
});
test("invalid/future/pre-joining attendance and overnight shifts are rejected", () => {
  const employee = {
    id: "e",
    company: "Petronik",
    branch: "Main",
    title: "E",
    contact: "Sales",
    status: "Active",
    due: "2026-01-01",
    department: "Sales",
  };
  const v = hrValueSchema.parse({
    kind: "attendance",
    employeeId: "e",
    payload: {
      date: "2026-01-02",
      status: "Present",
      start: "09:00",
      end: "08:00",
      reason: "HR",
    },
  });
  if (v.kind !== "attendance") throw new Error("Fixture must be attendance");
  assert.throws(
    () => validateHrValues(v, employee, [], "2026-01-03"),
    /end time/,
  );
  assert.throws(
    () =>
      validateHrValues(
        {
          ...v,
          payload: { ...v.payload, start: "", end: "", date: "2027-01-01" },
        },
        employee,
        [],
        "2026-01-03",
      ),
    /earlier/,
  );
  assert.throws(
    () =>
      validateHrValues(
        { ...v, payload: { ...v.payload, date: "2025-01-01" } },
        employee,
        [],
        "2026-01-03",
      ),
    /joining/,
  );
});
test("absence does not produce payroll deductions or alter a salary", async () => {
  const s = setup();
  await s.approvedSalary();
  await s.save(hr, {
    ...s.attendance(),
    payload: {
      ...s.attendance().payload,
      status: "Absent",
      start: "",
      end: "",
      breakMinutes: 0,
    },
  });
  const all = (await hrView(s.db, hr)).entries;
  assert.equal(
    payrollBasis(all, s.r.id, {
      period: "2026-01",
      adjustmentCents: 0,
      deductionCents: 0,
    }).netCents,
    550000,
  );
  s.sqlite.close();
});
test("payroll ignores unapproved legacy profile salary and requires approved salary", async () => {
  const s = setup();
  await assert.rejects(
    s.save(hr, {
      kind: "payroll",
      employeeId: s.r.id,
      payload: {
        period: "2026-01",
        deductionCents: 0,
        note: "Reviewed",
        reviewed: true,
      },
    }),
    /Approve a salary/,
  );
  s.sqlite.close();
});
test("payroll calculates exact cents with approved bonuses and explicit adjustments", async () => {
  const s = setup();
  await s.approvedSalary();
  let b = await s.save(hr, {
    kind: "bonus",
    employeeId: s.r.id,
    payload: {
      period: "2026-01",
      amountCents: 12345,
      currency: "AED",
      reason: "Approved performance",
    },
  });
  b = await s.act(hr, b, "submit");
  await s.act(md, b, "approve");
  let p = await s.save(hr, {
    kind: "payroll",
    employeeId: s.r.id,
    payload: {
      period: "2026-01",
      adjustmentCents: -10000,
      deductionCents: 2000,
      note: "Manual proration checked",
      reviewed: true,
    },
  });
  assert.equal(p.payload.netCents, 550345);
  assert.equal(p.payload.baseCents, 550000);
  assert.equal(p.payload.bonusCents, 12345);
  p = await s.act(hr, p, "submit");
  p = await s.act(md, p, "approve");
  await assert.rejects(s.act(accountant, p, "paid", "", ""), /reference/);
  p = await s.act(
    accountant,
    p,
    "paid",
    "Bank statement checked",
    "BANK-LOCAL-1",
  );
  assert.equal(p.status, "Paid");
  assert.equal(p.payload.netCents, 550345);
  assert.equal((await hrView(s.db, accountant)).entries.length, 1);
  s.sqlite.close();
});
test("accountants see only approved/paid payroll and no private salary, review or documents", async () => {
  const s = setup();
  await s.approvedSalary();
  await s.save(hr, s.document());
  const view = await hrView(s.db, accountant);
  assert.equal(view.entries.length, 0);
  assert.equal(view.employees.length, 0);
  assert.equal(view.files.length, 0);
  assert.equal(view.history.length, 0);
  s.sqlite.close();
});
test("employee document isolation includes details, history and direct-id lookups", async () => {
  const s = setup();
  const e = await s.save(hr, s.document());
  await s.save(hr, s.document(false));
  for (const a of [it, accountant]) {
    const v = await hrView(s.db, a);
    assert.ok(!v.entries.some((r) => r.id === e.id));
    assert.ok(!v.history.some((h) => h.entryId === e.id));
    await assert.rejects(hrEntry(s.db, a, e.id), /not available/);
  }
  assert.equal((await hrView(s.db, assistant)).employees.length, 1);
  assert.equal((await hrEntry(s.db, assistant, e.id)).id, e.id);
  assert.equal((await hrView(s.db, hr)).entries.length, 2);
  s.sqlite.close();
});
test("assistant can manage HR but cannot approve their own latest salary draft", async () => {
  const s=setup();
  let entry=await s.save(assistant,s.salary());
  entry=await s.act(assistant,entry,"submit");
  await assert.rejects(s.act(assistant,entry,"approve"), /different authorised approver/i);
  const approved=await s.act(md,entry,"approve");
  assert.equal(approved.status,"Approved");
  assert.equal(hrAccess({...assistant,moduleAccess:{hr:"read"}}).edit,false);
  assert.equal(mayReadHr({...assistant,companies:["Afrilube"]},approved),false);
  s.sqlite.close();
});
test("cross-company/branch access and tampered employee ids are refused", async () => {
  const s = setup();
  const e = await s.save(hr, s.document());
  for (const a of [
    { ...md, companies: ["Afrilube"] },
    { ...md, branches: ["Other"] },
  ]) {
    assert.equal(mayReadHr(a, e), false);
    await assert.rejects(hrEntry(s.db, a, e.id), /not available/);
    assert.equal((await hrView(s.db, a)).entries.length, 0);
  }
  await assert.rejects(
    s.save(hr, { ...s.salary(), employeeId: "not-an-employee" }),
    /not available/,
  );
  s.sqlite.close();
});
test("repeated create key does not duplicate attendance or audit", async () => {
  const s = setup();
  const key = crypto.randomUUID(),
    a = await s.save(hr, s.attendance(), undefined, key),
    b = await s.save(hr, s.attendance(), undefined, key);
  assert.equal(a.id, b.id);
  assert.equal((await hrView(s.db, hr)).history.length, 1);
  s.sqlite.close();
});
test("stale edits fail and global CAS rolls back later writes", async () => {
  const s = setup();
  const revision = await hrRevisionNumber(s.db);
  await s.save(hr, s.attendance());
  await assert.rejects(
    s.db.batch([
      revisionClaim(s.db, revision),
      s.db.run(sql`UPDATE HrEntry SET status='Archived'`),
    ]),
  );
  assert.equal((await hrView(s.db, hr)).entries[0].status, "Recorded");
  s.sqlite.close();
});
test("parallel duplicate attendance creates one record and one audit", async () => {
  const s = setup();
  const results = await Promise.allSettled([
    s.save(hr, s.attendance()),
    s.save(hr, s.attendance()),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const view = await hrView(s.db, hr);
  assert.equal(view.entries.length, 1);
  assert.equal(view.history.length, 1);
  s.sqlite.close();
});
test("salary/bonus changes force payroll review and cannot rewrite locked payroll", async () => {
  const s = setup();
  await s.approvedSalary();
  let p = await s.save(hr, {
    kind: "payroll",
    employeeId: s.r.id,
    payload: {
      period: "2026-01",
      deductionCents: 0,
      note: "Checked",
      reviewed: true,
    },
  });
  p = await s.act(hr, p, "submit");
  let b = await s.save(hr, {
    kind: "bonus",
    employeeId: s.r.id,
    payload: {
      period: "2026-01",
      amountCents: 10000,
      currency: "AED",
      reason: "Extra",
    },
  });
  b = await s.act(hr, b, "submit");
  await s.act(md, b, "approve");
  await assert.rejects(s.act(md, p, "approve"), /changed/);
  p = await s.act(md, p, "reject");
  p = await s.save(
    hr,
    {
      kind: "payroll",
      employeeId: s.r.id,
      payload: {
        period: "2026-01",
        deductionCents: 0,
        note: "Rechecked with bonus",
        reviewed: true,
      },
    },
    p,
  );
  p = await s.act(hr, p, "submit");
  await s.act(md, p, "approve");
  let salary = await s.save(hr, s.salary("2026-01-15", 600000));
  salary = await s.act(hr, salary, "submit");
  await assert.rejects(s.act(md, salary, "approve"), /locked payroll/);
  s.sqlite.close();
});
test("approved payroll requires explicit review before submission", async () => {
  const s = setup();
  await s.approvedSalary();
  const p = await s.save(hr, {
    kind: "payroll",
    employeeId: s.r.id,
    payload: {
      period: "2026-01",
      deductionCents: 0,
      note: "Incomplete review",
      reviewed: false,
    },
  });
  await assert.rejects(s.act(hr, p, "submit"), /Review the salary/);
  s.sqlite.close();
});
test("document details can be archived with reason, never deleted; expiry is exact", async () => {
  const s = setup();
  let e = await s.save(hr, s.document());
  await assert.rejects(s.act(hr, e, "archive", ""), /reason/);
  e = await s.act(hr, e, "archive", "Replaced document retained");
  assert.equal(e.status, "Archived");
  assert.throws(
    () => s.sqlite.prepare("DELETE FROM HrEntry WHERE id=?").run(e.id),
    /retained/,
  );
  assert.equal(expiryState("2026-10-21", "2026-10-21"), "Due within 30 days");
  assert.equal(expiryState("2026-10-20", "2026-10-21"), "Expired");
  assert.equal(expiryState("", "2026-10-21"), "No expiry");
  s.sqlite.close();
});
test("employee with HR history cannot be deleted or moved between companies", async () => {
  const s = setup();
  await s.save(hr, s.attendance());
  assert.equal(await employeeHasHrHistory(s.db, s.r.id), true);
  assert.throws(
    () =>
      s.sqlite
        .prepare("UPDATE BusinessRecord SET company=? WHERE id=?")
        .run("Afrilube", s.r.id),
    /HR history/,
  );
  assert.throws(
    () =>
      s.sqlite
        .prepare("UPDATE BusinessRecord SET payload=? WHERE id=?")
        .run(JSON.stringify({ ...s.r, deletedAt: "2026-10-21" }), s.r.id),
    /HR history/,
  );
  s.sqlite.close();
});
test("private audit trail is append-only and never enters general activity", async () => {
  const s = setup();
  await s.save(hr, s.attendance());
  assert.throws(() => s.sqlite.exec("DELETE FROM HrHistory"), /immutable/);
  assert.throws(
    () => s.sqlite.exec("UPDATE HrHistory SET reason='hidden'"),
    /immutable/,
  );
  assert.equal(
    s.sqlite.prepare("SELECT count(*) n FROM AuditEvent").get()!.n,
    0,
  );
  s.sqlite.close();
});
test("amount injection and calculated payroll totals cannot be supplied by browser", () => {
  const value = {
    kind: "payroll",
    employeeId: "e",
    payload: {
      period: "2026-01",
      deductionCents: 0,
      note: "Reviewed",
      reviewed: true,
      netCents: 999999,
    },
  };
  assert.equal(hrValueSchema.safeParse(value).success, false);
  assert.equal(
    hrValueSchema.safeParse({
      kind: "compensation",
      employeeId: "e",
      payload: {
        change: "Increment",
        effectiveDate: "2026-01-01",
        basicCents: 1.5,
        allowanceCents: 0,
        currency: "AED",
        reason: "Reviewed",
      },
    }).success,
    false,
  );
});
test("live HR uploads remain disabled even with a copied enable flag", () => {
  assert.equal(localHrUploadsAllowed("true", "https://crm.enercore.ae"), false);
  assert.equal(
    localHrUploadsAllowed("true", "https://crm.enercore.ae.localhost.invalid"),
    false,
  );
  assert.equal(localHrUploadsAllowed("false", "http://localhost:8789"), false);
  assert.equal(localHrUploadsAllowed("true", "http://localhost:8789"), true);
  assert.equal(localHrUploadsAllowed("true", "invalid"), false);
});
test("probation extensions and confirmation affect reminders only once approved and effective", async () => {
  const s = setup();
  await s.save(hr, {
    kind: "employment",
    employeeId: s.r.id,
    payload: { probationEnd: "2026-02-01" },
  });
  let p = await s.save(hr, {
    kind: "probation",
    employeeId: s.r.id,
    payload: {
      outcome: "Extend review",
      effectiveDate: "2026-02-01",
      extendedUntil: "2026-03-01",
      reason: "Further review agreed",
    },
  });
  assert.equal(
    probationReviewDate((await hrView(s.db, hr)).entries, s.r.id, "2026-02-02"),
    "2026-02-01",
  );
  p = await s.act(hr, p, "submit");
  await s.act(md, p, "approve");
  assert.equal(
    probationReviewDate((await hrView(s.db, hr)).entries, s.r.id, "2026-02-02"),
    "2026-03-01",
  );
  p = await s.save(hr, {
    kind: "probation",
    employeeId: s.r.id,
    payload: {
      outcome: "Confirm employment",
      effectiveDate: "2026-03-01",
      reason: "Review completed",
    },
  });
  p = await s.act(hr, p, "submit");
  await s.act(md, p, "approve");
  const all = (await hrView(s.db, hr)).entries;
  assert.equal(probationReviewDate(all, s.r.id, "2026-02-02"), "2026-03-01");
  assert.equal(probationReviewDate(all, s.r.id, "2026-03-01"), "");
  s.sqlite.close();
});
test("human performance review can support a bonus but never creates a salary change", async () => {
  const s = setup();
  let review = await s.save(actor("HR Executive"), {
    kind: "review",
    employeeId: s.r.id,
    payload: {
      from: "2026-01-01",
      to: "2026-01-31",
      goals: [
        {
          measure: "Assigned leads followed up",
          target: 20,
          actual: 18,
          unit: "leads",
        },
      ],
      rating: 4,
      summary: "Reviewed with employee",
    },
  });
  review = await s.act(actor("HR Executive"), review, "submit");
  review = await s.act(hr, review, "approve");
  const all = (await hrView(s.db, hr)).entries;
  assert.equal(all.filter((e) => e.kind === "compensation").length, 0);
  const bonus = await s.save(hr, {
    kind: "bonus",
    employeeId: s.r.id,
    payload: {
      period: "2026-02",
      amountCents: 20000,
      currency: "AED",
      reviewId: review.id,
      reason: "Reviewed achievement",
    },
  });
  assert.equal(bonus.status, "Draft");
  assert.equal((await hrView(s.db, assistant)).entries.length, 2);
  s.sqlite.close();
});
