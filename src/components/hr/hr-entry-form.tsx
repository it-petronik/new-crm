"use client";
import { Form } from "@/components/ui/controls";

import { useState, useId } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  Field,
  Input,
  Select,
  Textarea,
} from "../ui/controls";
import { businessToday } from "@/lib/gst";
import {
  hrValueSchema,
  type HrEmployee,
  type HrEntry,
  type HrKind,
  type HrValues,
} from "@/lib/hr/model";
import styles from "./hr-workspace.module.css";
export const hrTitles: Record<HrKind, string> = {
  employment: "Employment dates",
  attendance: "Attendance",
  compensation: "Salary & increments",
  bonus: "Bonus",
  review: "Performance review",
  probation: "Probation decision",
  payroll: "Payroll",
  document: "Document",
};
export function HrEntryForm({
  kind,
  existing,
  employees,
  companies,
  branches,
  reviews = [],
  companyDocument,
  onSave,
  onClose,
}: {
  kind: HrKind;
  existing?: HrEntry;
  employees: HrEmployee[];
  companies: string[];
  branches: string[];
  reviews?: HrEntry[];
  companyDocument?: boolean;
  onSave: (v: HrValues, requestId: string) => Promise<void>;
  onClose: () => void;
}) {
  const today = businessToday();
  const defaults: Record<HrKind, Record<string, unknown>> = {
    employment: { probationEnd: "", nextReviewDate: "", userId: "", notes: "" },
    attendance: {
      date: today,
      status: "Present",
      start: "",
      end: "",
      breakMinutes: 0,
      reason: "HR daily entry",
    },
    compensation: {
      change: "Starting salary",
      effectiveDate: today,
      basicCents: 0,
      allowanceCents: 0,
      currency: "AED",
      reason: "",
    },
    bonus: {
      period: today.slice(0, 7),
      amountCents: 0,
      currency: "AED",
      reviewId: "",
      reason: "",
    },
    review: {
      from: today.slice(0, 7) + "-01",
      to: today,
      goals: [{ measure: "", target: 0, actual: 0, unit: "count" }],
      rating: 3,
      summary: "",
      nextReviewDate: "",
    },
    probation: {
      outcome: "Confirm employment",
      effectiveDate: today,
      extendedUntil: "",
      reason: "",
    },
    payroll: {
      period: today.slice(0, 7),
      adjustmentCents: 0,
      deductionCents: 0,
      note: "",
      reviewed: false,
    },
    document: {
      title: "",
      category: companyDocument ? "Trade licence" : "Employee file",
      reference: "",
      issuer: "",
      issuedDate: "",
      expiryDate: "",
      notes: "",
    },
  };
  const [p, set] = useState<Record<string, unknown>>(
    existing?.payload || defaults[kind],
  );
  const [employeeId, employee] = useState(existing?.employeeId || ""),
    [company, setCompany] = useState(existing?.company || companies[0] || ""),
    [branch] = useState(existing?.branch || branches[0] || "Main");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const formId = useId();
  const update = (key: string, value: unknown) =>
    set((old) => ({ ...old, [key]: value }));
  const input = (
    key: string,
    label: string,
    type = "text",
    required = false,
  ) => (
    <Field key={key}>
      {label}
      <Input
        type={type}
        required={required}
        value={String(p[key] ?? "")}
        onChange={(e) => update(key, e.target.value)}
      />
    </Field>
  );
  const select = (key: string, label: string, options: string[]) => (
    <Field key={key}>
      {label}
      <Select
        value={String(p[key] || "")}
        onChange={(e) => update(key, e.target.value)}
      >
        {options.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </Select>
    </Field>
  );
  const amount = (key: string, label: string, signed = false) => (
    <Field key={key}>
      {label}
      <Input
        required
        type="number"
        min={signed ? undefined : "0"}
        step="0.01"
        value={Number(p[key] || 0) / 100}
        onChange={(e) => update(key, Math.round(Number(e.target.value) * 100))}
      />
    </Field>
  );
  const notes = (key: string, label: string, required = true) => (
    <Field className={styles.wide}>
      {label}
      <Textarea
        rows={3}
        maxLength={2000}
        required={required}
        value={String(p[key] || "")}
        onChange={(e) => update(key, e.target.value)}
      />
    </Field>
  );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    // A payroll edit accepts only user-editable inputs; calculated amounts
    // are rebuilt from approved records on the server, never trusted here.
    const payload =
      kind === "payroll"
        ? Object.fromEntries(
            Object.keys(defaults.payroll).map((k) => [k, p[k]]),
          )
        : p;
    const raw =
      kind === "document"
        ? {
            kind,
            employeeId: companyDocument ? null : employeeId,
            company,
            branch,
            payload,
          }
        : { kind, employeeId, payload };
    const parsed = hrValueSchema.safeParse(raw);
    if (!parsed.success) {
      setError(
        "Complete the required fields. Check the employee, dates, amounts and review notes.",
      );
      return;
    }
    setBusy(true);
    try {
      await onSave(parsed.data, requestId);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn’t save this record. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const goals = (p.goals || []) as {
    measure: string;
    target: number;
    actual: number;
    unit: string;
  }[];
  return (
    <Dialog
      title={`${existing ? "Edit" : "New"} ${hrTitles[kind].toLowerCase()}`}
      onClose={onClose}
      className={styles.dialog}
      dismissOnOutside={!busy}
    >
      <Form id={formId} onSubmit={save} className={styles.form}>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.fields}>
          {companyDocument ? (
            <>
              <Field>
                Company
                <Select
                  disabled={Boolean(existing)}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                >
                  {companies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
            </>
          ) : (
            <Field className={styles.wide}>
              Employee
              <Select
                required
                disabled={Boolean(existing)}
                value={employeeId}
                onChange={(e) => employee(e.target.value)}
              >
                <option value="">Choose employee</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} · {e.company}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {kind === "employment" && (
            <>
              {input("probationEnd", "Probation review date", "date")}
              {input("nextReviewDate", "Next performance review", "date")}
              {notes("notes", "HR notes", false)}
            </>
          )}
          {kind === "attendance" && (
            <>
              {input("date", "Attendance date", "date", true)}
              {select("status", "Day status", [
                "Present",
                "Absent",
                "Leave",
                "Holiday",
                "Day off",
              ])}
              {p.status === "Present" && (
                <>
                  {input("start", "Start time · GST", "time")}
                  {input("end", "End time · GST", "time")}
                  <Field>
                    Break minutes
                    <Input
                      type="number"
                      min={0}
                      max={720}
                      value={Number(p.breakMinutes)}
                      onChange={(e) =>
                        update("breakMinutes", Number(e.target.value))
                      }
                    />
                  </Field>
                </>
              )}
              {notes("reason", "Entry / correction reason")}
            </>
          )}
          {kind === "compensation" && (
            <>
              {select("change", "Change", [
                "Starting salary",
                "Increment",
                "Adjustment",
              ])}
              {input("effectiveDate", "Effective from", "date", true)}
              {select("currency", "Currency", [
                "AED",
                "USD",
                "EUR",
                "INR",
                "SGD",
              ])}
              {amount("basicCents", "Monthly basic salary")}
              {amount("allowanceCents", "Monthly allowances")}
              {notes("reason", "Reason for proposal")}
            </>
          )}
          {kind === "bonus" && (
            <>
              <Field className={styles.wide}>
                Supporting approved review (optional)
                <Select
                  value={String(p.reviewId || "")}
                  onChange={(e) => update("reviewId", e.target.value)}
                >
                  <option value="">No linked review</option>
                  {reviews
                    .filter(
                      (r) =>
                        r.employeeId === employeeId &&
                        r.status === "Approved" &&
                        r.kind === "review",
                    )
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {String(r.payload.from)} – {String(r.payload.to)} ·{" "}
                        {String(r.payload.rating)} / 5
                      </option>
                    ))}
                </Select>
              </Field>
              {input("period", "Bonus month", "month", true)}
              {amount("amountCents", "Bonus amount")}
              {select("currency", "Currency", [
                "AED",
                "USD",
                "EUR",
                "INR",
                "SGD",
              ])}
              {notes("reason", "Reason / performance evidence")}
            </>
          )}
          {kind === "review" && (
            <>
              {input("from", "Review from", "date", true)}
              {input("to", "Review to", "date", true)}
              <div className={styles.wide}>
                <h3>Agreed performance measures</h3>
                {goals.map((g, i) => (
                  <div className={styles.goals} key={i}>
                    {(["measure", "target", "actual", "unit"] as const).map(
                      (k) => (
                        <Field key={k}>
                          {k === "measure"
                            ? "Measure"
                            : k === "target"
                              ? "Target"
                              : k === "actual"
                                ? "Actual"
                                : "Unit"}
                          <Input
                            required
                            type={
                              k === "target" || k === "actual"
                                ? "number"
                                : "text"
                            }
                            min={0}
                            step="any"
                            value={g[k]}
                            onChange={(e) =>
                              update(
                                "goals",
                                goals.map((v, n) =>
                                  n === i
                                    ? {
                                        ...v,
                                        [k]:
                                          k === "target" || k === "actual"
                                            ? Number(e.target.value)
                                            : e.target.value,
                                      }
                                    : v,
                                ),
                              )
                            }
                          />
                        </Field>
                      ),
                    )}
                  </div>
                ))}
                <Button
                  variant="secondary"
                  size="small"
                  disabled={goals.length >= 12}
                  onClick={() =>
                    update("goals", [
                      ...goals,
                      { measure: "", target: 0, actual: 0, unit: "count" },
                    ])
                  }
                >
                  Add measure
                </Button>
              </div>
              <Field>
                Reviewer rating · 1–5
                <Select
                  value={String(p.rating)}
                  onChange={(e) => update("rating", Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} / 5
                    </option>
                  ))}
                </Select>
              </Field>
              {input("nextReviewDate", "Next review", "date")}
              {notes("summary", "Reviewer assessment")}
            </>
          )}
          {kind === "probation" && (
            <>
              {select("outcome", "Proposed decision", [
                "Confirm employment",
                "Extend review",
                "Not confirmed",
              ])}
              {input("effectiveDate", "Decision date", "date", true)}
              {p.outcome === "Extend review" &&
                input("extendedUntil", "Extended review date", "date", true)}
              {notes("reason", "Review evidence / reason")}
            </>
          )}
          {kind === "payroll" && (
            <>
              <p className={`${styles.notice} ${styles.wide}`}>
                Uses approved month-end salary and bonuses. Review partial-month
                calculations and deductions. Attendance never deducts pay
                automatically; this register does not send payments.
              </p>
              {input("period", "Payroll month", "month", true)}
              {amount("adjustmentCents", "Manual adjustment (+ / −)", true)}
              {amount("deductionCents", "Reviewed deductions")}
              {notes("note", "Calculation / adjustment explanation")}
              <label className={`${styles.check} ${styles.wide}`}>
                <Input
                  type="checkbox"
                  checked={p.reviewed === true}
                  onChange={(e) => update("reviewed", e.target.checked)}
                />
                I checked salary, bonuses, partial-month calculations and
                authorised deductions.
              </label>
            </>
          )}
          {kind === "document" && (
            <>
              {input("title", "Document name", "text", true)}
              {select(
                "category",
                "Category",
                companyDocument
                  ? [
                      "Trade licence",
                      "Tax certificate",
                      "Company insurance",
                      "Lease",
                      "Company file",
                    ]
                  : [
                      "Passport",
                      "Visa",
                      "Emirates ID",
                      "Employment contract",
                      "Qualification",
                      "Employee file",
                    ],
              )}
              {input("reference", "Document reference")}
              {input("issuer", "Issuer")}
              {input("issuedDate", "Issue date", "date")}
              {input("expiryDate", "Expiry / renewal date", "date")}
              {notes("notes", "Document notes", false)}
            </>
          )}
        </div>
        <DialogActions
          onCancel={onClose}
          pending={busy}
          primary={{
            type: "submit",
            form: formId,
            pending: busy,
            label: ["employment", "attendance", "document"].includes(kind)
              ? "Save record"
              : "Save draft",
          }}
        />
      </Form>
    </Dialog>
  );
}
