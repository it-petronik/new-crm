"use client";
import { CrmTable } from "@/components/ui/crm-table";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Download,
  RefreshCw,
  Target,
  Truck,
  Wallet,
  Megaphone,
  Users,
  Monitor,
  ChevronDown,
  CircleHelp,
} from "lucide-react";
import { type Actor, type Module, type RecordItem } from "@/lib/domain";
import {
  canViewManagement,
  departments,
  managementCsv,
  managementSnapshot,
  managementScope,
  overdueWork,
  type DepartmentId,
  type TeamPerson,
} from "@/lib/management-dashboard";
import {
  requestJson,
  friendlyError,
  WorkspaceRequestError,
} from "@/lib/client-request";
import { previewPeople } from "@/lib/team-preview";
import { downloadCsv } from "@/lib/export";
import { downloadTable, listExportData } from "@/lib/table-export";
import { businessStampShort } from "@/lib/gst";
import { Button, Input, Select } from "../ui/controls";
import { Avatar } from "../avatar";
import { StatusBadge } from "../ui/status-badge";
import {
  ListFilters,
  Pagination,
  SortHeader,
  usePagination,
} from "../pagination";
import { sortComparator, type ListQuery } from "@/lib/list-query";
import {
  SelectionActions,
  SelectionHeader,
  SelectionCell,
  useRowSelection,
} from "../row-selection";
import styles from "./management-overview.module.css";

const icons = {
  sales: Target,
  logistics: Truck,
  accounts: Wallet,
  marketing: Megaphone,
  hr: Users,
  it: Monitor,
};
type Source = {
  records: RecordItem[];
  people: TeamPerson[];
  asOf: string;
  scope: string;
};
export type ManagementReportState = {
  records: RecordItem[] | null;
  scope: string;
  loading: boolean;
  error: string;
};

export default function ManagementOverview({
  actor,
  records,
  live = false,
  company,
  from = "",
  to = "",
  go,
  onSelect,
  onReport,
}: {
  actor: Actor;
  records: RecordItem[];
  live?: boolean;
  company: string;
  from?: string;
  to?: string;
  go: (module: Module) => void;
  onSelect: (record: RecordItem) => void;
  onReport?: (report: ManagementReportState) => void;
}) {
  const scope = managementScope(actor);
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const refreshing = useRef(false);
  const [view, setView] = useState<"departments" | "team" | DepartmentId>(
    "departments",
  );
  const [department, setDepartment] = useState("all");
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState("all");
  const [expanded, setExpanded] = useState("");
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState<ListQuery>({
    search: "",
    status: "all",
    sort: "default",
  });
  useEffect(() => {
    onReport?.({
      records: source?.scope === scope ? source.records : null,
      scope,
      loading,
      error,
    });
  }, [onReport, source, scope, loading, error]);
  useEffect(() => {
    if (!canViewManagement(actor)) return;
    if (!live) {
      setSource({ records, people: previewPeople(actor), asOf: "", scope });
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    refreshing.current = true;
    setLoading(true);
    setError("");
    void (async () => {
      const all: RecordItem[] = [];
      let after: string | null = "",
        asOf = "";
      let people: TeamPerson[] = [];
      const seen = new Set<string>();
      do {
        const query: URLSearchParams = new URLSearchParams({
          after: after || "",
        });
        if (asOf) query.set("asOf", asOf);
        const result: {
          records: RecordItem[];
          people: TeamPerson[];
          asOf: string;
          next: string | null;
          error?: string;
        } = await requestJson(
          `/api/management/overview?${query}`,
          { signal: controller.signal },
          "The management overview could not refresh. Try again.",
        );
        if (
          !Array.isArray(result.records) ||
          !Array.isArray(result.people) ||
          typeof result.asOf !== "string" ||
          !(result.next === null || typeof result.next === "string")
        )
          throw new Error(
            result.error ||
              "The overview could not confirm its records. Try again.",
          );
        if (asOf && asOf !== result.asOf)
          throw new Error(
            "The overview changed while loading. Please refresh.",
          );
        all.push(...result.records);
        if (!after) people = result.people;
        asOf = result.asOf;
        after = result.next;
        if (after && seen.has(after))
          throw new Error(
            "The overview could not finish loading. Please refresh.",
          );
        if (after) seen.add(after);
      } while (after && !controller.signal.aborted);
      if (!controller.signal.aborted)
        setSource({
          records: [...new Map(all.map((r) => [r.id, r])).values()],
          people,
          asOf,
          scope,
        });
    })()
      .catch((e) => {
        if (!controller.signal.aborted) {
          // A connection failure may preserve a verified snapshot; loss of
          // authentication or access must remove it, not show private history.
          if (
            e instanceof WorkspaceRequestError &&
            [401, 403].includes(e.status)
          )
            setSource(null);
          setError(
            friendlyError(
              e,
              "The overview could not connect. Check your connection and select Refresh to try again.",
            ),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          refreshing.current = false;
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      refreshing.current = false;
    };
  }, [scope, live, records, refresh]);
  useEffect(() => {
    if (!live) return;
    const update = () => {
      if (document.visibilityState === "visible" && !refreshing.current)
        setRefresh((n) => n + 1);
    };
    const timer = window.setInterval(update, 60000);
    return () => window.clearInterval(timer);
  }, [live]);
  useEffect(() => {
    setPage(0);
    setExpanded("");
  }, [department, search, account, company, from, to, query]);
  const snapshot = useMemo(
    () =>
      source?.scope === scope && canViewManagement(actor)
        ? managementSnapshot(actor, source.records, source.people, {
            company,
            from,
            to,
          })
        : null,
    [source, scope, company, from, to],
  );
  const employees = (snapshot?.employees || []).filter(
    (p) =>
      (department === "all" || p.department === department) &&
      (account === "all" ||
        (account === "active"
          ? p.linked && p.active
          : account === "inactive"
            ? p.linked && !p.active
            : p.overdue > 0 || p.feedback > 0)) &&
      `${p.name} ${p.role}`.toLowerCase().includes(search.toLowerCase()),
  );
  employees.sort(sortComparator(query.sort) || (() => 0));
  const totalPages = Math.max(1, Math.ceil(employees.length / 8));
  const currentPage = Math.min(page, totalPages - 1);
  const shown = employees.slice(currentPage * 8, currentPage * 8 + 8);
  const selection = useRowSelection(
    employees,
    JSON.stringify([
      actor.id,
      actor.role,
      company,
      from,
      to,
      view,
      department,
      account,
      search,
    ]),
  );
  if (!canViewManagement(actor)) return null;
  const selectedDepartment = snapshot?.departments.find((d) => d.id === view);
  return (
    <section
      className={styles.overview}
      aria-label="Department and employee overview"
      aria-busy={loading}
    >
      <header className={styles.heading}>
        <div>
          <h2>Departments & team</h2>
          <p>
            Records created in the selected period · Current CRM work status
          </p>
        </div>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            aria-label="Refresh management overview"
            disabled={loading}
            onClick={() => setRefresh((n) => n + 1)}
          >
            <RefreshCw size={14} className={loading ? styles.spinning : ""} />
            Refresh
          </Button>
          <Button
            variant="secondary"
            disabled={!snapshot || loading || Boolean(error)}
            onClick={() =>
              snapshot &&
              downloadTable({
                ...listExportData(
                  view === "departments" ? snapshot.departments : employees,
                  "Team performance",
                ),
                title:
                  view === "departments"
                    ? "Department overview"
                    : `${selectedDepartment?.name || "Employee"} performance`,
                exportedBy: actor.name,
                company,
              })
            }
          >
            <Download size={14} />
            Export report
          </Button>
        </div>
      </header>
      <div className={styles.navigation}>
        <div className={styles.switcher} aria-label="Management overview view">
          <button
            type="button"
            aria-pressed={view === "departments"}
            onClick={() => {
              setView("departments");
              setDepartment("all");
            }}
          >
            All departments
          </button>
          {departments
            .filter((d) => actor.moduleAccess?.[d.module] !== "none")
            .map((d) => (
              <button
                key={d.id}
                type="button"
                data-department-tab={d.id}
                aria-pressed={view === d.id}
                onClick={() => {
                  setView(d.id);
                  setDepartment(d.id);
                  setSearch("");
                  setAccount("all");
                }}
              >
                {d.name}
              </button>
            ))}
          <button
            type="button"
            aria-pressed={view === "team"}
            onClick={() => {
              setView("team");
              setDepartment("all");
            }}
          >
            Employee performance
          </button>
        </div>
        {snapshot && (
          <span className={styles.coverage}>
            {snapshot.activeAccounts} active accounts · {snapshot.overdue}{" "}
            overdue · {snapshot.feedback} awaiting lead feedback
          </span>
        )}
      </div>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
          {snapshot &&
            " Showing the last successful update; this may be out of date."}
        </div>
      )}
      {!snapshot ? (
        loading ? (
          <div
            className={styles.loading}
            role="status"
            aria-label="Loading management overview"
          >
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="skeleton-region" />
            ))}
            <span className="sr-only">Loading management overview</span>
          </div>
        ) : (
          <p className={styles.empty}>
            The overview is not available yet. Select Refresh to try again.
          </p>
        )
      ) : view === "departments" ? (
        <div className={styles.departments}>
          {snapshot.departments.map((d) => {
            const Icon = icons[d.id];
            return (
              <article
                className={styles.department}
                key={d.id}
                data-department={d.id}
              >
                <header>
                  <span className={styles.departmentIcon}>
                    <Icon size={17} />
                  </span>
                  <h3>{d.name}</h3>
                  <button
                    type="button"
                    onClick={() => go(d.module)}
                    aria-label={`Open ${d.name}`}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </header>
                <div className={styles.primary}>
                  <strong>{d.open}</strong>
                  <span>{d.label}</span>
                </div>
                <dl>
                  <div>
                    <dt>Completed outcomes</dt>
                    <dd>{d.completed}</dd>
                  </div>
                  <div data-attention={d.overdue > 0}>
                    <dt>Overdue</dt>
                    <dd>{d.overdue}</dd>
                  </div>
                </dl>
                <footer>
                  <span>
                    {d.members} CRM {d.members === 1 ? "account" : "accounts"}
                    {d.id === "hr"
                      ? ` · ${snapshot.headcount} active HR profiles (all dates)`
                      : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDepartment(d.id);
                      setView(d.id);
                    }}
                  >
                    View team
                    <ArrowUpRight size={13} />
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.team}>
          {selectedDepartment && (
            <section
              className={styles.departmentDetail}
              data-department-detail={selectedDepartment.id}
            >
              <header>
                <h3>{selectedDepartment.name} overview</h3>
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => go(selectedDepartment.module)}
                >
                  Open workspace <ArrowUpRight size={14} />
                </Button>
              </header>
              <dl>
                {[
                  [selectedDepartment.label, selectedDepartment.open],
                  ["Completed outcomes", selectedDepartment.completed],
                  ["Overdue work", selectedDepartment.overdue],
                  ["CRM team accounts", selectedDepartment.members],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <DepartmentWork
                key={selectedDepartment.id}
                records={selectedDepartment.records}
                onSelect={onSelect}
              />
            </section>
          )}
          <div className={styles.filters}>
            <Input
              type="search"
              aria-label="Find an employee"
              placeholder="Find an employee…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              aria-label="Employee department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
              <option value="management">Management</option>
              <option value="other">Other / unlinked</option>
            </Select>
            <Select
              aria-label="Employee account filter"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="all">All accounts</option>
              <option value="active">Active accounts</option>
              <option value="inactive">Inactive accounts</option>
              <option value="attention">Needs attention</option>
            </Select>
          </div>
          <SelectionActions
            selected={selection.selected}
            title="Employee performance"
            onClear={selection.clear}
          />
          <div className={styles.tableScroll}>
            <CrmTable>
              <caption className="sr-only">
                Employee CRM workload and outcomes
              </caption>
              <thead>
                <tr>
                  <SelectionHeader
                    selection={selection}
                    rows={shown}
                    label="employees"
                  />
                  {(
                    [
                      ["name", "Employee"],
                      ["open", "Open work"],
                      ["completed", "Completed"],
                      ["overdue", "Overdue"],
                      ["feedback", "Lead feedback"],
                      ["responseMinutes", "First response"],
                    ] as const
                  ).map(([key, label]) => (
                    <SortHeader
                      key={key}
                      sortKey={key}
                      query={query}
                      setQuery={setQuery}
                    >
                      {label}
                    </SortHeader>
                  ))}
                  <th scope="col">Work status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <Fragment key={p.id}>
                    <tr data-selected={selection.has(p.id) || undefined}>
                      <SelectionCell
                        selection={selection}
                        row={p}
                        label={p.name}
                      />
                      <th scope="row">
                        <button
                          type="button"
                          className={styles.person}
                          aria-expanded={expanded === p.id}
                          aria-controls={`employee-work-${p.id}`}
                          onClick={() =>
                            setExpanded(expanded === p.id ? "" : p.id)
                          }
                        >
                          <Avatar name={p.name} avatarId={p.id} size={28} />
                          <span>
                            <strong>{p.name}</strong>
                            <small>
                              {p.role}
                              {!p.linked
                                ? " · No linked account"
                                : !p.active
                                  ? " · Inactive account"
                                  : ""}
                            </small>
                          </span>
                          <ChevronDown size={13} />
                        </button>
                      </th>
                      <td>{p.open}</td>
                      <td>{p.completed}</td>
                      <td className={p.overdue ? styles.attention : ""}>
                        {p.overdue}
                      </td>
                      <td>{p.feedback}</td>
                      <td
                        title={`${p.responseSamples} staff-reported contact samples; known receipt times only`}
                      >
                        {p.responseMinutes === null
                          ? "Not recorded"
                          : `${Math.round(p.responseMinutes)} min`}
                      </td>
                      <td>
                        <span
                          className={styles.workStatus}
                          data-attention={p.overdue > 0 || p.feedback > 0}
                        >
                          {p.overdue || p.feedback
                            ? "Needs attention"
                            : p.open
                              ? "In progress"
                              : p.records.length
                                ? "No open work"
                                : "No assigned work"}
                        </span>
                      </td>
                    </tr>
                    <tr hidden={expanded !== p.id} id={`employee-work-${p.id}`}>
                      <td colSpan={8} className={styles.expanded}>
                        <div className={styles.workHeading}>
                          <strong>Assigned CRM work</strong>
                          <span>
                            {p.latestUpdate
                              ? `Latest record update: ${businessStampShort(p.latestUpdate)}`
                              : "No records in this period"}
                          </span>
                        </div>
                        {p.records.length ? (
                          [...p.records]
                            .sort(
                              (a, b) =>
                                Number(overdueWork(b)) -
                                  Number(overdueWork(a)) ||
                                b.updatedAt.localeCompare(a.updatedAt),
                            )
                            .slice(0, 8)
                            .map((r) => (
                              <button
                                key={r.id}
                                type="button"
                                className={styles.work}
                                onClick={() => onSelect(r)}
                              >
                                <span>
                                  {r.title}
                                  <small>
                                    {r.company} ·{" "}
                                    {r.kind === "leads" ? "Lead" : r.kind}
                                  </small>
                                </span>
                                <StatusBadge status={r.status} />
                                <ArrowUpRight size={14} />
                              </button>
                            ))
                        ) : (
                          <p className={styles.empty}>
                            No assigned records match this period and brand.
                          </p>
                        )}
                        {p.records.length > 8 && (
                          <p className={styles.note}>
                            Showing eight records, with overdue work first.
                            Export the report for the employee totals.
                          </p>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                ))}
                {!shown.length && (
                  <tr>
                    <td colSpan={7} className={styles.empty}>
                      No employees match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </CrmTable>
          </div>
          <footer className={styles.pagination}>
            <span>{employees.length} employees / record owners</span>
            <div>
              <Button
                variant="secondary"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </Button>
              <span>
                {currentPage + 1} / {totalPages}
              </span>
              <Button
                variant="secondary"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </Button>
            </div>
          </footer>
        </div>
      )}
      <footer className={styles.basis}>
        <span>
          <CircleHelp size={13} aria-hidden="true" />
          CRM records only—not attendance or a staff rating. Record updates may
          be made by another permitted user.
        </span>
        <span>
          {source?.scope === scope && source.asOf
            ? `Checked ${businessStampShort(source.asOf)}`
            : live
              ? "Waiting for a verified update"
              : "Fictional preview"}
        </span>
      </footer>
    </section>
  );
}

function DepartmentWork({
  records,
  onSelect,
}: {
  records: RecordItem[];
  onSelect: (r: RecordItem) => void;
}) {
  const list = usePagination(records);
  const selection = useRowSelection(
    list.matched,
    JSON.stringify([list.query.search, list.query.status]),
  );
  const statuses = [...new Set(records.map((r) => r.status))].map((status) => ({
    status,
    count: records.filter((r) => r.status === status).length,
  }));
  return (
    <div className={styles.departmentWork}>
      <div
        className={styles.statusOverview}
        aria-label="Department work by status"
      >
        {statuses.map(({ status, count }) => (
          <button
            key={status}
            type="button"
            aria-pressed={list.query.status === status}
            onClick={() =>
              list.setQuery({
                ...list.query,
                status: list.query.status === status ? "all" : status,
              })
            }
          >
            <span>
              {status}
              <b>{count}</b>
            </span>
            <i
              style={{
                width: `${(count / Math.max(1, records.length)) * 100}%`,
              }}
            />
          </button>
        ))}
      </div>
      <h3>Work register</h3>
      <ListFilters {...list} label="department records" sortable={false} />
      <SelectionActions
        selected={selection.selected}
        title="Department records"
        onClear={selection.clear}
      />
      <div className={styles.tableScroll}>
        <CrmTable>
          <thead>
            <tr>
              <SelectionHeader
                selection={selection}
                rows={list.items}
                label="department records"
              />
              {(
                [
                  ["name", "Record"],
                  ["status", "Status"],
                  ["owner", "Owner"],
                  ["due", "Next date"],
                  ["updatedAt", "Updated"],
                ] as const
              ).map(([key, label]) => (
                <SortHeader
                  key={key}
                  sortKey={key}
                  query={list.query}
                  setQuery={list.setQuery}
                >
                  {label}
                </SortHeader>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={r.id} data-selected={selection.has(r.id) || undefined}>
                <SelectionCell selection={selection} row={r} label={r.title} />
                <td>
                  <Button className="record-link" onClick={() => onSelect(r)}>
                    {r.title}
                  </Button>
                  <small>{r.kind}</small>
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td>{r.owner || "Unassigned"}</td>
                <td>{r.due || "Not set"}</td>
                <td>{r.updatedAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </CrmTable>
      </div>
      {!list.total && (
        <p className={styles.empty}>No work matches this view.</p>
      )}
      <Pagination {...list} />
    </div>
  );
}
