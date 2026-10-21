"use client";
import { CrmTable } from "@/components/ui/crm-table";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CalendarDays,
  FileLock2,
  FolderClock,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogActions,
  Field,
  Input,
  Select,
  Textarea,
} from "../ui/controls";
import { SkeletonTable } from "../ui/skeleton";
import { SortHeader } from "../pagination";
import {
  SelectionActions,
  SelectionHeader,
  SelectionCell,
  useRowSelection,
} from "../row-selection";
import { sortComparator, type ListQuery } from "@/lib/list-query";
import {
  requestJson,
  friendlyError,
  readJsonResponse,
} from "@/lib/client-request";
import { businessToday, businessStampShort } from "@/lib/gst";
import { toCsv, downloadCsv } from "@/lib/export";
import { downloadTable } from "@/lib/table-export";
import type { Actor, RecordItem } from "@/lib/domain";
import {
  approvedSalary,
  attendanceMinutes,
  draftKinds,
  expiryState,
  hrAccess,
  hrRecordKey,
  hrTransition,
  mayEditHr,
  payrollBasis,
  probationReviewDate,
  validateHrValues,
  type HrCommand,
  type HrEmployee,
  type HrEntry,
  type HrKind,
  type HrValues,
} from "@/lib/hr/model";
import type { HrView } from "@/lib/hr/store";
import { HrEntryForm, hrTitles } from "./hr-entry-form";
import styles from "./hr-workspace.module.css";
type Area =
  | "overview"
  | "people"
  | "leave"
  | "employment"
  | "attendance"
  | "compensation"
  | "bonus"
  | "review"
  | "probation"
  | "payroll"
  | "employee-documents"
  | "company-documents"
  | "history";
const areaLabels: Record<Area, string> = {
  overview: "HR overview",
  people: "Employee directory",
  leave: "Leave requests",
  employment: "Employment dates",
  attendance: "Attendance",
  compensation: "Salary & increments",
  bonus: "Bonuses",
  review: "Performance reviews",
  probation: "Probation decisions",
  payroll: "Payroll register",
  "employee-documents": "Employee files",
  "company-documents": "Company files & licences",
  history: "Private history",
};
const money = (c: unknown, currency: unknown = "AED") =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: String(currency),
    maximumFractionDigits: 2,
  }).format(Number(c || 0) / 100);
function description(e: HrEntry) {
  const p = e.payload;
  if (e.kind === "document")
    return `${p.category}${p.reference ? ` · ${p.reference}` : ""}`;
  if (e.kind === "attendance")
    return `${p.status}${attendanceMinutes(p) !== null ? ` · ${attendanceMinutes(p)} minutes` : ""}`;
  if (e.kind === "compensation")
    return `${p.change} · ${money(Number(p.basicCents) + Number(p.allowanceCents), p.currency)} / month`;
  if (e.kind === "bonus") return money(p.amountCents, p.currency);
  if (e.kind === "payroll") return `${money(p.netCents, p.currency)} net`;
  if (e.kind === "review") return `Rating ${p.rating}/5 · ${p.summary}`;
  if (e.kind === "probation") return String(p.outcome);
  return `Probation review ${p.probationEnd || "not set"} · Next review ${p.nextReviewDate || "not set"}`;
}
export default function HrWorkspace({
  actor,
  preview,
  company,
  records,
  peopleList,
  onLegacyTab,
  onAddEmployee,
  onLeave,
  payrollOnly = false,
}: {
  actor: Actor;
  preview: boolean;
  company: string;
  records: RecordItem[];
  peopleList?: ReactNode;
  onLegacyTab?: (tab: "people" | "leave") => void;
  onAddEmployee?: () => void;
  onLeave?: () => void;
  payrollOnly?: boolean;
}) {
  const access = hrAccess(actor),
    today = businessToday();
  const [data, setData] = useState<HrView | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const initial: Area =
    payrollOnly || access.payrollOnly
      ? "payroll"
      : access.full
        ? "overview"
        : "company-documents";
  const [area, setArea] = useState<Area>(initial),
    [search, setSearch] = useState(""),
    [month, setMonth] = useState(today.slice(0, 7));
  const [query, setQuery] = useState<ListQuery>({
    search: "",
    status: "all",
    sort: "default",
  });
  const [form, setForm] = useState<{ kind: HrKind; entry?: HrEntry } | null>(
      null,
    ),
    [action, setAction] = useState<{
      entry: HrEntry;
      verb: Exclude<HrCommand["action"], "save">;
    } | null>(null),
    [reason, setReason] = useState(""),
    [reference, setReference] = useState(""),
    [detail, setDetail] = useState<HrEntry | null>(null);
  const emptyPreview = useCallback(
    (): HrView => ({
      access,
      employees: access.full
        ? records
            .filter(
              (r) =>
                r.kind === "hr" &&
                !r.deletedAt &&
                (company === "All companies" || r.company === company),
            )
            .map((r) => ({
              id: r.id,
              title: r.title,
              company: r.company,
              branch: r.branch,
              contact: r.contact,
              status: r.status,
              due: r.due,
              department: r.attributes?.department || "",
            }))
        : [],
      entries: [],
      files: [],
      history: [],
      historyLimited: false,
      uploads: false,
    }),
    [actor.id, actor.role, company, records],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (preview)
        setData((old) =>
          old
            ? { ...old, employees: emptyPreview().employees }
            : emptyPreview(),
        );
      else
        setData(
          await requestJson<HrView>(
            `/api/hr?company=${encodeURIComponent(company)}`,
          ),
        );
    } catch (e) {
      setData(null);
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [preview, company, emptyPreview]);
  const peopleSignature = records
    .filter((r) => r.kind === "hr")
    .map((r) => `${r.id}:${r.updatedAt}:${r.status}`)
    .sort()
    .join("|");
  const previousPeople = useRef(peopleSignature);
  useEffect(() => {
    if (previousPeople.current === peopleSignature) return;
    previousPeople.current = peopleSignature;
    if (preview)
      setData((old) =>
        old ? { ...old, employees: emptyPreview().employees } : old,
      );
    else void reload();
  }, [peopleSignature, preview, emptyPreview, reload]);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    setDetail(null);
    setForm(null);
    setDetail(null);
    setArea(initial);
    if (preview) {
      setData(emptyPreview());
      setLoading(false);
    } else
      requestJson<HrView>(`/api/hr?company=${encodeURIComponent(company)}`, {
        signal: c.signal,
      })
        .then(setData)
        .catch((e) => {
          if (!c.signal.aborted) setError(friendlyError(e));
        })
        .finally(() => {
          if (!c.signal.aborted) setLoading(false);
        });
    return () => c.abort();
  }, [actor.id, actor.role, preview, company]); // eslint-disable-line react-hooks/exhaustive-deps
  const employees = data?.employees || [],
    entries = data?.entries || [];
  const names = new Map(employees.map((e) => [e.id, e.title]));
  const areas = (Object.keys(areaLabels) as Area[]).filter((v) =>
    access.full
      ? v !== "employee-documents" || access.employeeDocuments
      : access.payrollOnly
        ? v === "payroll" || v === "history"
        : v === "company-documents" || v === "history",
  );
  const setSection = (v: Area) => {
    setArea(v);
    setSearch("");
    setQuery({ search: "", status: "all", sort: "default" });
    setDetail(null);
    setMessage("");
    if (v === "people" || v === "leave") onLegacyTab?.(v);
  };
  const kind: HrKind | null = [
    "employee-documents",
    "company-documents",
  ].includes(area)
    ? "document"
    : [
          "employment",
          "attendance",
          "compensation",
          "bonus",
          "review",
          "probation",
          "payroll",
        ].includes(area)
      ? (area as HrKind)
      : null;
  const canCreate =
    kind &&
    (kind === "document"
      ? area === "employee-documents"
        ? access.editEmployeeDocuments
        : access.editCompanyDocuments
      : access.edit);
  const rows = useMemo(
    () =>
      entries
        .filter(
          (e) =>
            e.kind === kind &&
            (query.status === "all" || e.status === query.status) &&
            (kind !== "document" ||
              Boolean(e.employeeId) === (area === "employee-documents")) &&
            (!(
              area === "attendance" ||
              area === "payroll" ||
              area === "bonus"
            ) ||
              String(e.payload.date || e.payload.period).startsWith(month)) &&
            `${names.get(e.employeeId || "") || ""} ${e.company} ${e.payload.title || ""} ${description(e)}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .map((e) => ({
          ...e,
          name: String(
            kind === "document"
              ? e.payload.title
              : names.get(e.employeeId!) || "Employee",
          ),
          description: description(e),
          period: String(
            e.payload.date ||
              e.payload.period ||
              e.payload.effectiveDate ||
              e.payload.to ||
              e.payload.expiryDate ||
              e.payload.probationEnd ||
              "",
          ),
        }))
        .sort(
          sortComparator(query.sort) || ((a, b) => b.updatedAt - a.updatedAt),
        ),
    [entries, kind, area, month, search, employees, query],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [area, month, search, company, query]);
  const shown = rows.slice((page - 1) * 20, page * 20);
  const selection = useRowSelection(
    rows,
    JSON.stringify([
      actor.id,
      actor.role,
      company,
      area,
      month,
      search,
      query.status,
    ]),
  );
  function exportRegister(exportRows: typeof rows) {
    const keys = [
      ...new Set(exportRows.flatMap((e) => Object.keys(e.payload))),
    ].filter((k) => !["basis", "salaryId", "bonusIds", "userId"].includes(k));
    downloadTable({
      title: areaLabels[area],
      exportedBy: actor.name,
      company,
      headers: [
        "Employee / document",
        "Company",
        "Status",
        ...keys.map((k) =>
          k.replace(/Cents$/, " amount").replace(/([a-z])([A-Z])/g, "$1 $2"),
        ),
      ],
      rows: exportRows.map((e) => [
        String(names.get(e.employeeId!) || e.payload.title || ""),
        e.company,
        e.status,
        ...keys.map((k) =>
          k.endsWith("Cents")
            ? e.payload[k] === undefined || e.payload[k] === null
              ? null
              : Number(e.payload[k]) / 100
            : typeof e.payload[k] === "object"
              ? JSON.stringify(e.payload[k])
              : typeof e.payload[k] === "number"
                ? (e.payload[k] as number)
                : String(e.payload[k] ?? ""),
        ),
      ]),
    });
  }
  async function command(c: HrCommand) {
    if (!data) throw new Error("Refresh the HR register before saving.");
    if (!preview) {
      await requestJson("/api/hr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c),
      });
      await reload();
      return;
    }
    let e: HrEntry;
    if (c.action === "save") {
      const v = c.values,
        existing = entries.find((e) => e.id === c.id),
        employee = employees.find((e) => e.id === v.employeeId) || null;
      if (
        existing &&
        !["Recorded", "Draft", "Rejected"].includes(existing.status)
      )
        throw new Error(
          "Only a draft or current register entry can be edited.",
        );
      validateHrValues(v, employee, entries);
      const id = c.id || crypto.randomUUID(),
        scope = employee || (v.kind === "document" ? v : null);
      if (!scope) throw new Error("Choose an employee.");
      if (
        !mayEditHr(actor, { ...scope, kind: v.kind, employeeId: v.employeeId })
      )
        throw new Error("Your role cannot change this record.");
      const payload =
        v.kind === "payroll"
          ? { ...v.payload, ...payrollBasis(entries, v.employeeId!, v.payload) }
          : v.payload;
      const key = hrRecordKey(v.kind, v.employeeId, payload, id);
      if (entries.some((r) => r.id !== id && r.recordKey === key))
        throw new Error(
          "This daily entry or monthly payroll already exists. Edit the existing draft instead.",
        );
      e = {
        id,
        recordKey: key,
        kind: v.kind,
        employeeId: v.employeeId,
        company: scope.company,
        branch: scope.branch,
        payload,
        status: draftKinds.includes(v.kind) ? "Draft" : "Recorded",
        createdBy: existing?.createdBy || actor.id,
        preparedBy: actor.id,
        approvedBy: null,
        version: (existing?.version || 0) + 1,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
    } else {
      const old = entries.find((e) => e.id === c.id);
      if (!old) throw new Error("Refresh the register.");
      const status = hrTransition(
        actor,
        old,
        c.action,
        entries,
        c.reason,
        c.reference,
      );
      e = {
        ...old,
        status,
        version: old.version + 1,
        updatedAt: Date.now(),
        approvedBy: status === "Approved" ? actor.id : old.approvedBy,
      };
    }
    const saved = e;
    setData(
      (old) =>
        old && {
          ...old,
          entries: [saved, ...old.entries.filter((r) => r.id !== saved.id)],
          history: [
            {
              id: crypto.randomUUID(),
              entryId: saved.id,
              actorName: actor.name,
              action: c.action,
              reason:
                c.action === "save"
                  ? "Fictional preview record"
                  : `${c.reason} ${c.reference}`,
              at: Date.now(),
            },
            ...old.history,
          ],
        },
    );
  }
  async function save(v: HrValues, requestId: string) {
    await command({
      action: "save",
      id: form?.entry?.id,
      version: form?.entry?.version,
      requestId,
      values: v,
    });
    setForm(null);
    setMessage(
      preview
        ? "Fictional entry saved for this preview session only."
        : "HR record saved.",
    );
  }
  function act(e: HrEntry, verb: Exclude<HrCommand["action"], "save">) {
    setReason("");
    setReference("");
    setError("");
    setAction({ entry: e, verb });
  }
  async function confirm() {
    if (!action) return;
    setBusy(true);
    setError("");
    try {
      await command({
        action: action.verb,
        id: action.entry.id,
        version: action.entry.version,
        reason,
        reference,
      });
      setAction(null);
      setDetail(null);
      setMessage("HR record updated.");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(e: HrEntry, file: File) {
    setBusy(true);
    setError("");
    try {
      const f = new FormData();
      f.set("file", file);
      await requestJson(`/api/hr/files?entry=${encodeURIComponent(e.id)}`, {
        method: "POST",
        body: f,
      });
      await reload();
      setMessage("Protected file version saved.");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  async function download(id: string, name: string) {
    setBusy(true);
    setError("");
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 25000);
    try {
      const response = await fetch(`/api/hr/files/${encodeURIComponent(id)}`, {
        cache: "no-store",
        signal: abort.signal,
      });
      if (!response.ok) {
        const data = await readJsonResponse<{ error?: string }>(response);
        throw new Error(
          data.error ||
            "We couldn’t open this protected file. Please try again.",
        );
      }
      const url = URL.createObjectURL(await response.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(
        friendlyError(
          e,
          "We couldn’t download this document. Please try again.",
        ),
      );
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }
  function actions(e: HrEntry, showView = true) {
    return (
      <div className={styles.actions}>
        {showView && (
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              setError("");
              setDetail(e);
            }}
          >
            View
          </Button>
        )}
        {mayEditHr(actor, e) &&
          ["Recorded", "Draft", "Rejected"].includes(e.status) && (
            <Button
              variant="secondary"
              size="small"
              onClick={() => setForm({ kind: e.kind, entry: e })}
            >
              Edit
            </Button>
          )}
        {access.edit && ["Draft", "Rejected"].includes(e.status) && (
          <Button
            variant="secondary"
            size="small"
            onClick={() => act(e, "submit")}
          >
            Submit
          </Button>
        )}
        {e.status === "Submitted" &&
          e.preparedBy !== actor.id &&
          (e.kind === "review" ? access.review : access.approve) && (
            <>
              <Button
                variant="primary"
                size="small"
                onClick={() => act(e, "approve")}
              >
                Review approval
              </Button>
              <Button
                variant="secondary"
                size="small"
                onClick={() => act(e, "reject")}
              >
                Return to HR
              </Button>
            </>
          )}
        {e.kind === "payroll" && e.status === "Approved" && access.pay && (
          <Button variant="primary" size="small" onClick={() => act(e, "paid")}>
            Record paid
          </Button>
        )}
      </div>
    );
  }
  const pending = entries.filter((e) => e.status === "Submitted").length,
    dueDocs = entries.filter(
      (e) =>
        e.kind === "document" &&
        e.status === "Recorded" &&
        ["Expired", "Due within 30 days"].includes(
          expiryState(String(e.payload.expiryDate || "")),
        ),
    );
  const overdueProbation = employees
    .map((e) => ({
      ...e,
      reviewDate: probationReviewDate(entries, e.id, today),
    }))
    .filter((e) => e.reviewDate && e.reviewDate <= today);
  return (
    <section className={styles.workspace} aria-label="HR operations">
      <div className={styles.toolbar}>
        <Field>
          HR workspace
          <Select
            aria-label="HR workspace section"
            value={area}
            onChange={(e) => setSection(e.target.value as Area)}
          >
            {areas.map((v) => (
              <option key={v} value={v}>
                {areaLabels[v]}
              </option>
            ))}
          </Select>
        </Field>
        <div className={styles.actions}>
          <span className={styles.private}>
            <ShieldCheck size={14} />
            Restricted records
          </span>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Refresh HR register"
            onClick={() => void reload()}
          >
            <RefreshCw size={15} />
          </Button>
          {canCreate && (
            <Button variant="primary" onClick={() => setForm({ kind: kind! })}>
              <Plus size={15} />
              New{" "}
              {kind === "document"
                ? "document"
                : kind === "compensation"
                  ? "salary proposal"
                  : kind}
            </Button>
          )}
          {area === "people" && access.edit && onAddEmployee && (
            <Button variant="primary" onClick={onAddEmployee}>
              <Plus size={15} />
              Add employee
            </Button>
          )}
          {area === "leave" && onLeave && (
            <Button variant="primary" onClick={onLeave}>
              Request leave
            </Button>
          )}
        </div>
      </div>
      {preview && (
        <p className={styles.notice}>
          HR demo · Session-only records. Use fictional details; file uploads
          are disabled.
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
      {loading ? (
        <div aria-busy="true" aria-label="Loading HR register">
          <SkeletonTable rows={5} />
        </div>
      ) : !data ? (
        <div className={styles.empty}>
          <FolderClock size={24} />
          <h3>HR register unavailable</h3>
          <p>No figures are shown until the register is connected.</p>
          <Button variant="secondary" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {area === "overview" && (
            <>
              <div className={styles.metrics}>
                {[
                  ["Employee profiles", employees.length, ShieldCheck],
                  [
                    "Attendance entered today",
                    entries.filter(
                      (e) =>
                        e.kind === "attendance" && e.payload.date === today,
                    ).length,
                    CalendarDays,
                  ],
                  ["Awaiting review", pending, Wallet],
                  ["Documents due / expired", dueDocs.length, FileLock2],
                ].map(([label, value, Icon]) => {
                  const I = Icon as typeof ShieldCheck;
                  return (
                    <div key={String(label)}>
                      <I size={18} />
                      <span>{String(label)}</span>
                      <strong>{String(value)}</strong>
                    </div>
                  );
                })}
              </div>
              <div className={styles.columns}>
                <section className={styles.panel}>
                  <h3>Today’s HR desk</h3>
                  <p>
                    Missing attendance means <b>not entered</b>, not absent.
                  </p>
                  <div className={styles.actions}>
                    <Button
                      variant="secondary"
                      onClick={() => setSection("attendance")}
                    >
                      Enter attendance
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setSection("payroll")}
                    >
                      Prepare payroll
                    </Button>
                  </div>
                  <p>
                    Probation reviews due: <b>{overdueProbation.length}</b>
                  </p>
                  {overdueProbation.slice(0, 5).map((e) => (
                    <p key={e.id}>
                      {e.title} · {e.reviewDate}
                    </p>
                  ))}
                </section>
                <section className={styles.panel}>
                  <h3>Approvals & reminders</h3>
                  <p>{pending} submitted proposals need review.</p>
                  {entries
                    .filter((e) => e.status === "Submitted")
                    .slice(0, 5)
                    .map((e) => (
                      <div className={styles.reminder} key={e.id}>
                        <span>
                          {names.get(e.employeeId!)} · {hrTitles[e.kind]}
                        </span>
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => setDetail(e)}
                        >
                          Review
                        </Button>
                      </div>
                    ))}
                  {dueDocs.slice(0, 5).map((e) => (
                    <div className={styles.reminder} key={e.id}>
                      <span>
                        {String(e.payload.title)} ·{" "}
                        {expiryState(String(e.payload.expiryDate))}
                      </span>
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => setDetail(e)}
                      >
                        Open
                      </Button>
                    </div>
                  ))}
                </section>
              </div>
              <p className={styles.notice}>
                Pay changes, bonuses, probation decisions and payroll need
                submission and separate approval. No automatic pay deductions,
                employment decisions or bank payments.
              </p>
            </>
          )}
          {(area === "people" || area === "leave") && peopleList}
          {area === "history" && (
            <section className={styles.panel}>
              <h3>Private HR history</h3>
              <p>
                {data.historyLimited
                  ? "Most recent 250 events shown."
                  : "Recorded HR changes and document access."}
              </p>
              {data.history.length ? (
                data.history.map((h) => (
                  <div className={styles.history} key={h.id}>
                    <strong>{h.action}</strong>
                    <span>
                      {h.actorName} ·{" "}
                      {businessStampShort(new Date(h.at).toISOString())}
                    </span>
                    <p>{h.reason}</p>
                  </div>
                ))
              ) : (
                <p>No HR changes recorded yet.</p>
              )}
            </section>
          )}
          {kind && (
            <section className={styles.register}>
              <div className={styles.filters}>
                <Input
                  placeholder="Search this register…"
                  aria-label="Search HR register"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {["attendance", "payroll", "bonus"].includes(area) && (
                  <Input
                    aria-label="Register month"
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  />
                )}
                <Select
                  aria-label="HR status filter"
                  value={query.status}
                  onChange={(e) =>
                    setQuery((q) => ({ ...q, status: e.target.value }))
                  }
                >
                  <option value="all">All statuses</option>
                  {[
                    ...new Set(
                      entries
                        .filter((e) => e.kind === kind)
                        .map((e) => e.status),
                    ),
                  ]
                    .sort()
                    .map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                </Select>
                <span>{rows.length} records</span>
                {rows.length > 0 && (
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => exportRegister(rows)}
                  >
                    Export register
                  </Button>
                )}
              </div>
              <SelectionActions
                selected={selection.selected}
                title={areaLabels[area]}
                onClear={selection.clear}
                onExport={() => exportRegister(selection.selected)}
              />
              {area === "attendance" && (
                <p className={styles.inset}>
                  HR entry only · GST times · No employee self check-in
                </p>
              )}
              {kind === "document" && (
                <p className={styles.inset}>
                  {area === "employee-documents"
                    ? "Employee files: MD, Personal Assistant & HR."
                    : "Company licences and files are kept separately from employee records."}{" "}
                  {data.uploads
                    ? "Protected local uploads enabled. PDF, PNG, JPEG · 10 MB maximum."
                    : "Uploads disabled here; live storage remains on hold. You can record document details and expiry dates."}
                </p>
              )}
              <div className={styles.tableScroll}>
                <CrmTable>
                  <thead>
                    <tr>
                      <SelectionHeader
                        selection={selection}
                        rows={shown}
                        label="HR records"
                      />
                      <SortHeader
                        sortKey="name"
                        query={query}
                        setQuery={setQuery}
                      >
                        {kind === "document" ? "Document" : "Employee"}
                      </SortHeader>
                      <SortHeader
                        sortKey="description"
                        query={query}
                        setQuery={setQuery}
                      >
                        Details
                      </SortHeader>
                      <SortHeader
                        sortKey="period"
                        query={query}
                        setQuery={setQuery}
                      >
                        {kind === "compensation"
                          ? "Effective from"
                          : kind === "attendance"
                            ? "Attendance date"
                            : "Period / date"}
                      </SortHeader>
                      <SortHeader
                        sortKey="status"
                        query={query}
                        setQuery={setQuery}
                      >
                        Status
                      </SortHeader>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => (
                      <tr
                        key={e.id}
                        data-selected={selection.has(e.id) || undefined}
                      >
                        <SelectionCell
                          selection={selection}
                          row={e}
                          label={e.name}
                        />
                        <td>
                          <strong>
                            {kind === "document"
                              ? String(e.payload.title)
                              : names.get(e.employeeId!) || "Employee"}
                          </strong>
                          <small>
                            {e.company}
                            {kind === "document" && e.employeeId
                              ? ` · ${names.get(e.employeeId) || "Employee file"}`
                              : ""}
                          </small>
                        </td>
                        <td>{description(e)}</td>
                        <td>
                          {String(
                            e.payload.date ||
                              e.payload.period ||
                              e.payload.effectiveDate ||
                              e.payload.to ||
                              e.payload.expiryDate ||
                              e.payload.probationEnd ||
                              "—",
                          )}
                        </td>
                        <td>
                          <span className={styles.status} data-state={e.status}>
                            {e.status}
                          </span>
                          {kind === "document" && e.status !== "Archived" && (
                            <small>
                              {expiryState(String(e.payload.expiryDate || ""))}
                            </small>
                          )}
                        </td>
                        <td>{actions(e)}</td>
                      </tr>
                    ))}
                  </tbody>
                </CrmTable>
              </div>
              {!rows.length && (
                <div className={styles.empty}>
                  <FolderClock size={24} />
                  <h3>No {areaLabels[area].toLowerCase()} yet</h3>
                  <p>
                    {search
                      ? "Try a different search."
                      : canCreate
                        ? "Add the first record when you’re ready."
                        : "Approved records will appear here when available."}
                  </p>
                </div>
              )}
              {rows.length > 20 && (
                <div className={styles.paging}>
                  <Button
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {page} of {Math.ceil(rows.length / 20)}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={page * 20 >= rows.length}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
              {area === "compensation" && employees.length > 0 && (
                <div className={styles.inset}>
                  <h3>Current approved monthly salary</h3>
                  {employees.map((p) => {
                    const s = approvedSalary(entries, p.id, today);
                    return (
                      <p key={p.id}>
                        {p.title} ·{" "}
                        {s
                          ? money(
                              Number(s.payload.basicCents) +
                                Number(s.payload.allowanceCents),
                              s.payload.currency,
                            )
                          : "Not approved yet"}
                      </p>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </>
      )}
      {form && (
        <HrEntryForm
          kind={form.kind}
          existing={form.entry}
          employees={employees}
          companies={company === "All companies" ? actor.companies : [company]}
          branches={actor.branches}
          reviews={entries}
          companyDocument={
            form.entry
              ? form.entry.kind === "document" && !form.entry.employeeId
              : area === "company-documents"
          }
          onClose={() => setForm(null)}
          onSave={save}
        />
      )}
      {detail && (
        <Dialog
          title={
            detail.kind === "document"
              ? String(detail.payload.title)
              : hrTitles[detail.kind]
          }
          onClose={() => setDetail(null)}
          className={styles.dialog}
        >
          <div className={styles.detail}>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <p>
              {names.get(detail.employeeId!) || detail.company} ·{" "}
              <b>{detail.status}</b>
            </p>
            <dl>
              {Object.entries(detail.payload)
                .filter(
                  ([k]) =>
                    !["basis", "salaryId", "bonusIds", "userId"].includes(k),
                )
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      {k
                        .replace(/([A-Z])/g, " $1")
                        .replace(/^./, (s) => s.toUpperCase())
                        .replace("Cents", "")}
                    </dt>
                    <dd>
                      {k.endsWith("Cents")
                        ? money(v, detail.payload.currency)
                        : Array.isArray(v)
                          ? v.map((g, i) => (
                              <p key={i}>
                                {typeof g === "object"
                                  ? `${g.measure}: ${g.actual} / ${g.target} ${g.unit}`
                                  : String(g)}
                              </p>
                            ))
                          : typeof v === "boolean"
                            ? v
                              ? "Yes"
                              : "No"
                            : String(v || "—")}
                    </dd>
                  </div>
                ))}
            </dl>
            {detail.kind === "document" && (
              <section className={styles.panel}>
                <h3>Retained file versions</h3>
                {data?.files
                  .filter((f) => f.entryId === detail.id)
                  .map((f) => (
                    <p key={f.id}>
                      <Button
                        variant="secondary"
                        size="small"
                        disabled={busy}
                        onClick={() => void download(f.id, f.name)}
                      >
                        {f.name}
                      </Button>{" "}
                      · {Math.ceil(f.size / 1024)} KB ·{" "}
                      {businessStampShort(new Date(f.createdAt).toISOString())}
                    </p>
                  ))}
                {!data?.files.some((f) => f.entryId === detail.id) && (
                  <p>No file attached.</p>
                )}
                {mayEditHr(actor, detail) && detail.status === "Recorded" && (
                  <>
                    <Field>
                      Attach PDF, PNG or JPEG
                      <Input
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg"
                        disabled={busy || !data?.uploads || preview}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void upload(detail, f);
                          e.target.value = "";
                        }}
                      />
                    </Field>
                    <p className={styles.notice}>
                      {data?.uploads
                        ? "New uploads add a retained version. Existing files are not overwritten."
                        : "Protected uploads are disabled here. Live storage has not been enabled."}
                    </p>
                    <Button
                      variant="secondary"
                      onClick={() => act(detail, "archive")}
                    >
                      Archive document
                    </Button>
                  </>
                )}
              </section>
            )}
            {actions(detail, false)}
          </div>
          <DialogActions onCancel={() => setDetail(null)} />
        </Dialog>
      )}
      {action && (
        <Dialog
          title={
            action.verb === "paid"
              ? "Record confirmed payment"
              : action.verb === "approve"
                ? "Review & approve"
                : action.verb === "reject"
                  ? "Return proposal to HR"
                  : action.verb === "archive"
                    ? "Archive document"
                    : "Submit for review"
          }
          onClose={() => setAction(null)}
          className={styles.dialog}
        >
          <div className={styles.detail}>
            <p>
              {names.get(action.entry.employeeId!) || action.entry.company} ·{" "}
              {description(action.entry)}
            </p>
            {action.verb === "approve" && (
              <p className={styles.notice}>
                Check the full proposal before approval. Approved records are
                locked. This does not send money or change a bank account.
              </p>
            )}
            <dl>
              {Object.entries(action.entry.payload)
                .filter(
                  ([k]) =>
                    !["basis", "salaryId", "bonusIds", "userId"].includes(k),
                )
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      {k
                        .replace(/([A-Z])/g, " $1")
                        .replace(/^./, (s) => s.toUpperCase())
                        .replace("Cents", "")}
                    </dt>
                    <dd>
                      {k.endsWith("Cents")
                        ? money(v, action.entry.payload.currency)
                        : Array.isArray(v)
                          ? v.map((g, i) => (
                              <p key={i}>
                                {typeof g === "object"
                                  ? `${g.measure}: ${g.actual} / ${g.target} ${g.unit}`
                                  : String(g)}
                              </p>
                            ))
                          : typeof v === "boolean"
                            ? v
                              ? "Yes"
                              : "No"
                            : String(v || "—")}
                    </dd>
                  </div>
                ))}
            </dl>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {action.verb === "paid" && (
              <Field>
                Payment reference
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
            )}
            <Field>
              {action.verb === "submit"
                ? "Review note (optional)"
                : "Reason / review note"}
              <Textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
          <DialogActions
            onCancel={() => setAction(null)}
            pending={busy}
            primary={{
              label: `Confirm ${action.verb === "paid" ? "paid entry" : action.verb === "reject" ? "return" : action.verb}`,
              pending: busy,
              disabled:
                (action.verb === "paid" &&
                  (!reason.trim() || !reference.trim())) ||
                (["reject", "archive"].includes(action.verb) && !reason.trim()),
              onClick: confirm,
            }}
          />
        </Dialog>
      )}
    </section>
  );
}
