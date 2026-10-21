import { z } from "zod";
import { allowedModules, type Actor, type RecordItem } from "../domain";
import { businessToday, businessInstant } from "../gst";

export const hrKinds = [
  "employment",
  "attendance",
  "compensation",
  "bonus",
  "review",
  "probation",
  "payroll",
  "document",
] as const;
export type HrKind = (typeof hrKinds)[number];
export type HrStatus =
  | "Recorded"
  | "Draft"
  | "Submitted"
  | "Approved"
  | "Rejected"
  | "Paid"
  | "Archived";
export type HrEntry = {
  id: string;
  recordKey: string;
  kind: HrKind;
  employeeId: string | null;
  company: string;
  branch: string;
  status: HrStatus;
  payload: Record<string, unknown>;
  createdBy: string;
  preparedBy: string;
  approvedBy: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
};
export type HrEmployee = Pick<
  RecordItem,
  "id" | "company" | "branch" | "title" | "contact" | "due" | "status"
> & { department: string; userId?: string };
export type HrFile = {
  id: string;
  entryId: string;
  name: string;
  mime: string;
  size: number;
  createdBy: string;
  createdAt: number;
};
export type HrHistory = {
  id: string;
  entryId: string;
  actorName: string;
  action: string;
  reason: string;
  at: number;
};
export class HrError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function hrAccess(a: Actor) {
  const enabled = allowedModules(a).includes("hr"),
    writable = enabled && a.moduleAccess?.hr !== "read";
  const full =
    enabled &&
    ["MD", "MD Assistant", "IT Administrator", "HR Manager", "HR Executive"].includes(a.role);
  const documents =
    enabled && ["MD", "MD Assistant", "HR Manager", "HR Executive"].includes(a.role);
  const companyDocuments = enabled && (full || a.role === "MD Assistant");
  const accounts =
    allowedModules(a).includes("accounts") &&
    ["Accounts Manager", "Accountant"].includes(a.role);
  return {
    view: full || companyDocuments || accounts,
    full,
    edit: full && writable,
    approve: writable && ["MD", "MD Assistant", "IT Administrator"].includes(a.role),
    review:
      writable && ["MD", "MD Assistant", "IT Administrator", "HR Manager"].includes(a.role),
    employeeDocuments: documents,
    editEmployeeDocuments: documents && writable,
    companyDocuments,
    editCompanyDocuments: companyDocuments && writable,
    pay:
      (writable && ["MD", "MD Assistant", "IT Administrator"].includes(a.role)) ||
      (accounts && a.moduleAccess?.accounts !== "read"),
    payrollOnly: accounts && !full,
  };
}
export function inHrScope(a: Actor, row: { company: string; branch: string }) {
  return (
    a.companies.includes(row.company) &&
    (!a.branches.length || a.branches.includes(row.branch))
  );
}
export function mayReadHr(a: Actor, e: HrEntry) {
  if (!inHrScope(a, e)) return false;
  const access = hrAccess(a);
  if (e.kind === "document")
    return e.employeeId ? access.employeeDocuments : access.companyDocuments;
  return (
    access.full ||
    (access.payrollOnly &&
      e.kind === "payroll" &&
      ["Approved", "Paid"].includes(e.status))
  );
}
export function mayEditHr(
  a: Actor,
  e: Pick<HrEntry, "kind" | "employeeId" | "company" | "branch">,
) {
  if (!inHrScope(a, e)) return false;
  const p = hrAccess(a);
  return e.kind === "document"
    ? e.employeeId
      ? p.editEmployeeDocuments
      : p.editCompanyDocuments
    : p.edit;
}

const employeeId = z.string().min(1).max(100),
  date = z.iso.date(),
  optionalDate = z.union([date, z.literal("")]).default("");
const line = z.string().trim().min(1).max(200),
  note = z.string().trim().max(2000).default("");
const cents = z.number().int().min(0).max(10000000000);
const currency = z.enum(["AED", "USD", "EUR", "INR", "SGD"]);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const common = { employeeId };
export const hrValueSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("employment"),
      ...common,
      payload: z
        .object({
          probationEnd: optionalDate,
          nextReviewDate: optionalDate,
          userId: z.string().max(100).default(""),
          notes: note,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("attendance"),
      ...common,
      payload: z
        .object({
          date,
          status: z.enum(["Present", "Absent", "Leave", "Holiday", "Day off"]),
          start: z
            .string()
            .regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/)
            .default(""),
          end: z
            .string()
            .regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/)
            .default(""),
          breakMinutes: z.number().int().min(0).max(720).default(0),
          reason: line,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("compensation"),
      ...common,
      payload: z
        .object({
          change: z.enum(["Starting salary", "Increment", "Adjustment"]),
          effectiveDate: date,
          basicCents: cents,
          allowanceCents: cents,
          currency,
          reason: line,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("bonus"),
      ...common,
      payload: z
        .object({
          period,
          amountCents: cents.positive(),
          currency,
          reviewId: z.string().max(100).default(""),
          reason: line,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("review"),
      ...common,
      payload: z
        .object({
          from: date,
          to: date,
          goals: z
            .array(
              z
                .object({
                  measure: line,
                  target: z.number().min(0).max(1000000000),
                  actual: z.number().min(0).max(1000000000),
                  unit: z.string().trim().min(1).max(30),
                })
                .strict(),
            )
            .min(1)
            .max(12),
          rating: z.number().int().min(1).max(5),
          summary: z.string().trim().min(1).max(2000),
          nextReviewDate: optionalDate,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("probation"),
      ...common,
      payload: z
        .object({
          outcome: z.enum([
            "Confirm employment",
            "Extend review",
            "Not confirmed",
          ]),
          effectiveDate: date,
          extendedUntil: optionalDate,
          reason: line,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("payroll"),
      ...common,
      payload: z
        .object({
          period,
          adjustmentCents: z
            .number()
            .int()
            .min(-10000000000)
            .max(10000000000)
            .default(0),
          deductionCents: cents,
          note: z.string().trim().min(1).max(2000),
          reviewed: z.boolean(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("document"),
      employeeId: z.union([employeeId, z.null()]),
      company: z.string().min(1).max(80),
      branch: z.string().min(1).max(80),
      payload: z
        .object({
          title: line,
          category: z.enum([
            "Passport",
            "Visa",
            "Emirates ID",
            "Employment contract",
            "Qualification",
            "Employee file",
            "Trade licence",
            "Tax certificate",
            "Company insurance",
            "Lease",
            "Company file",
          ]),
          reference: z.string().trim().max(100).default(""),
          issuer: z.string().trim().max(200).default(""),
          issuedDate: optionalDate,
          expiryDate: optionalDate,
          notes: note,
        })
        .strict(),
    })
    .strict(),
]);
export type HrValues = z.infer<typeof hrValueSchema>;
export const hrCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save"),
      id: z.string().max(100).optional(),
      version: z.number().int().positive().optional(),
      requestId: z.string().min(8).max(100),
      values: hrValueSchema,
    })
    .strict(),
  z
    .object({
      action: z.enum(["submit", "approve", "reject", "paid", "archive"]),
      id: employeeId,
      version: z.number().int().positive(),
      reason: z.string().trim().max(2000).default(""),
      reference: z.string().trim().max(200).default(""),
    })
    .strict(),
]);
export type HrCommand = z.infer<typeof hrCommandSchema>;
export const draftKinds: HrKind[] = [
  "compensation",
  "bonus",
  "review",
  "probation",
  "payroll",
];
export function hrRecordKey(
  kind: HrKind,
  employee: string | null,
  payload: Record<string, unknown>,
  id: string,
) {
  return kind === "employment"
    ? `employment:${employee}`
    : kind === "attendance"
      ? `attendance:${employee}:${payload.date}`
      : kind === "payroll"
        ? `payroll:${employee}:${payload.period}`
        : `${kind}:${id}`;
}
export function attendanceMinutes(p: Record<string, unknown>) {
  if (!p.start || !p.end) return null;
  const start = businessInstant(String(p.date), String(p.start)),
    end = businessInstant(String(p.date), String(p.end));
  if (!start || !end || end <= start)
    throw new HrError(
      400,
      "The end time must be after the start time on the same day. Split overnight shifts into two daily entries.",
    );
  const minutes =
    Math.round((end.getTime() - start.getTime()) / 60000) -
    Number(p.breakMinutes || 0);
  if (minutes < 0)
    throw new HrError(400, "Break time cannot exceed the recorded shift.");
  return minutes;
}
export function validateHrValues(
  v: HrValues,
  employee: HrEmployee | null,
  all: HrEntry[],
  today = businessToday(),
) {
  if (v.kind !== "document" && !employee)
    throw new HrError(404, "Choose an employee in your authorised company.");
  const p = v.payload as Record<string, unknown>;
  if (v.kind === "attendance") {
    if (String(p.date) > today)
      throw new HrError(
        400,
        "Attendance can only be recorded for today or an earlier date.",
      );
    if (employee?.due && String(p.date) < employee.due)
      throw new HrError(
        400,
        "Attendance cannot be recorded before the employee’s joining date.",
      );
    if (Boolean(p.start) !== Boolean(p.end))
      throw new HrError(
        400,
        "Enter both start and end times, or leave both blank.",
      );
    if (p.status !== "Present" && (p.start || p.end || p.breakMinutes))
      throw new HrError(400, "Times are only recorded for a present day.");
    attendanceMinutes(p);
  }
  if (
    v.kind === "employment" &&
    p.probationEnd &&
    employee?.due &&
    String(p.probationEnd) < employee.due
  )
    throw new HrError(
      400,
      "The probation review date cannot be before the joining date.",
    );
  if (v.kind === "review" && String(p.to) < String(p.from))
    throw new HrError(400, "The review end date must follow its start date.");
  if (
    v.kind === "probation" &&
    p.outcome === "Extend review" &&
    (!p.extendedUntil || String(p.extendedUntil) <= String(p.effectiveDate))
  )
    throw new HrError(400, "Choose a later review date for the extension.");
  if (v.kind === "document") {
    if (
      p.issuedDate &&
      p.expiryDate &&
      String(p.expiryDate) < String(p.issuedDate)
    )
      throw new HrError(
        400,
        "The expiry date cannot be before the issue date.",
      );
    const employeeCategory = [
      "Passport",
      "Visa",
      "Emirates ID",
      "Employment contract",
      "Qualification",
      "Employee file",
    ].includes(String(p.category));
    if (Boolean(v.employeeId) !== employeeCategory)
      throw new HrError(
        400,
        "Choose an employee-file category for employee documents, or a company-file category for company documents.",
      );
  }
  if (
    v.kind === "bonus" &&
    p.reviewId &&
    !all.some(
      (e) =>
        e.id === p.reviewId &&
        e.kind === "review" &&
        e.employeeId === v.employeeId &&
        e.status === "Approved",
    )
  )
    throw new HrError(400, "Choose an approved review for this employee.");
}
export function approvedSalary(
  entries: HrEntry[],
  employeeId: string,
  on: string,
) {
  return (
    entries
      .filter(
        (e) =>
          e.kind === "compensation" &&
          e.employeeId === employeeId &&
          e.status === "Approved" &&
          String(e.payload.effectiveDate) <= on,
      )
      .sort((a, b) =>
        String(b.payload.effectiveDate).localeCompare(
          String(a.payload.effectiveDate),
        ),
      )[0] || null
  );
}
export function payrollBasis(
  all: HrEntry[],
  employeeId: string,
  p: Record<string, unknown>,
) {
  const period = String(p.period),
    lastDay = new Date(`${period}-01T00:00:00Z`);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
  lastDay.setUTCDate(0);
  const salary = approvedSalary(
    all,
    employeeId,
    lastDay.toISOString().slice(0, 10),
  );
  if (!salary)
    throw new HrError(
      400,
      "Approve a salary effective in or before this month before preparing payroll.",
    );
  const bonuses = all.filter(
    (e) =>
      e.kind === "bonus" &&
      e.employeeId === employeeId &&
      e.status === "Approved" &&
      e.payload.period === period,
  );
  if (bonuses.some((e) => e.payload.currency !== salary.payload.currency))
    throw new HrError(
      400,
      "Bonus and salary currencies must match before payroll can be prepared.",
    );
  const baseCents =
      Number(salary.payload.basicCents) + Number(salary.payload.allowanceCents),
    bonusCents = bonuses.reduce(
      (sum, e) => sum + Number(e.payload.amountCents),
      0,
    );
  const grossCents = baseCents + bonusCents + Number(p.adjustmentCents || 0),
    netCents = grossCents - Number(p.deductionCents || 0);
  if (!Number.isSafeInteger(netCents) || netCents < 0 || grossCents < 0)
    throw new HrError(
      400,
      "Payroll cannot be negative. Review the adjustment and deductions.",
    );
  return {
    salaryId: salary.id,
    bonusIds: bonuses.map((e) => e.id).sort(),
    basis: [
      salary.id,
      salary.version,
      ...bonuses
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((e) => `${e.id}:${e.version}`),
    ].join("|"),
    baseCents,
    bonusCents,
    grossCents,
    netCents,
    currency: salary.payload.currency,
    rateEffectiveDate: salary.payload.effectiveDate,
  };
}
export function hrTransition(
  a: Actor,
  entry: HrEntry,
  action: Exclude<HrCommand["action"], "save">,
  all: HrEntry[],
  reason = "",
  reference = "",
) {
  if (!inHrScope(a, entry) || !mayReadHr(a, entry))
    throw new HrError(404, "This HR record is not available to you.");
  const p = hrAccess(a);
  if (action === "archive") {
    if (
      entry.kind !== "document" ||
      entry.status !== "Recorded" ||
      !mayEditHr(a, entry) ||
      !reason
    )
      throw new HrError(
        403,
        "Only an authorised document manager can archive a current document, with a reason.",
      );
    return "Archived" as const;
  }
  if (action === "paid") {
    if (
      entry.kind !== "payroll" ||
      entry.status !== "Approved" ||
      !p.pay ||
      !reference.trim() ||
      !reason.trim()
    )
      throw new HrError(
        400,
        "An authorised payroll officer must record a payment reference and note against approved payroll.",
      );
    return "Paid" as const;
  }
  if (action === "submit") {
    if (
      !p.edit ||
      !["Draft", "Rejected"].includes(entry.status) ||
      !draftKinds.includes(entry.kind)
    )
      throw new HrError(
        403,
        "Only a draft HR proposal can be submitted by an authorised HR officer.",
      );
    if (entry.kind === "payroll" && entry.payload.reviewed !== true)
      throw new HrError(
        400,
        "Review the salary, partial-month adjustments, bonuses and deductions before submitting payroll.",
      );
    return "Submitted" as const;
  }
  if (
    entry.status !== "Submitted" ||
    !(entry.kind === "review" ? p.review : p.approve) ||
    entry.preparedBy === a.id
  )
    throw new HrError(
      403,
      "A different authorised approver must review this submitted proposal.",
    );
  if (action === "reject") {
    if (!reason.trim())
      throw new HrError(400, "Add a reason so HR can correct the proposal.");
    return "Rejected" as const;
  }
  if (
    entry.kind === "payroll" &&
    payrollBasis(all, entry.employeeId!, entry.payload).basis !==
      entry.payload.basis
  )
    throw new HrError(
      409,
      "Approved salary or bonuses changed. Return this proposal to HR so they can recalculate and resubmit it.",
    );
  if (entry.kind === "compensation") {
    if (
      all.some(
        (e) =>
          e.id !== entry.id &&
          e.kind === "compensation" &&
          e.employeeId === entry.employeeId &&
          e.status === "Approved" &&
          e.payload.effectiveDate === entry.payload.effectiveDate,
      )
    )
      throw new HrError(
        409,
        "An approved salary already exists for this effective date.",
      );
    if (
      all.some(
        (e) =>
          e.kind === "payroll" &&
          e.employeeId === entry.employeeId &&
          ["Approved", "Paid"].includes(e.status) &&
          String(e.payload.period) >=
            String(entry.payload.effectiveDate).slice(0, 7),
      )
    )
      throw new HrError(
        409,
        "This salary would change a locked payroll month. Use a future effective date and handle any correction separately.",
      );
  }
  if (
    entry.kind === "bonus" &&
    all.some(
      (e) =>
        e.kind === "payroll" &&
        e.employeeId === entry.employeeId &&
        ["Approved", "Paid"].includes(e.status) &&
        e.payload.period === entry.payload.period,
    )
  )
    throw new HrError(
      409,
      "Payroll for this bonus month is already locked. Choose an open month.",
    );
  return "Approved" as const;
}
export function expiryState(expiry: string, today = businessToday()) {
  if (!expiry) return "No expiry";
  const days = Math.ceil(
    (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86400000,
  );
  return days < 0 ? "Expired" : days <= 30 ? "Due within 30 days" : "Current";
}

/** Only approved decisions whose effective date has arrived affect reminders. */
export function probationReviewDate(
  entries: HrEntry[],
  employeeId: string,
  today = businessToday(),
) {
  const decision = entries
    .filter(
      (e) =>
        e.kind === "probation" &&
        e.employeeId === employeeId &&
        e.status === "Approved" &&
        String(e.payload.effectiveDate) <= today,
    )
    .sort(
      (a, b) =>
        String(b.payload.effectiveDate).localeCompare(
          String(a.payload.effectiveDate),
        ) || b.updatedAt - a.updatedAt,
    )[0];
  if (decision)
    return decision.payload.outcome === "Extend review"
      ? String(decision.payload.extendedUntil || "")
      : "";
  return String(
    entries.find((e) => e.kind === "employment" && e.employeeId === employeeId)
      ?.payload.probationEnd || "",
  );
}
