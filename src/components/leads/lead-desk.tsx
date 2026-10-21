"use client";
import { CrmTable } from "@/components/ui/crm-table";
import { useEffect, useState } from "react";
import { Button, Dialog, Input, Select } from "../ui/controls";
import {
  UserPlus,
  SlidersHorizontal,
  RefreshCw,
  Upload,
  Download,
  Users,
  Columns3,
} from "lucide-react";
import {
  allowedModules,
  canRead,
  canSeeAllLeads,
  canWrite,
  type Actor,
  type RecordItem,
} from "@/lib/domain";
import { canAssign } from "@/lib/workflow";
import {
  acknowledged,
  awaitingAllocation,
  businessToday,
  leadSummary,
  leadType,
  needsFeedback,
  openLead,
  leadTypes,
  type LeadFeedbackAction,
} from "@/lib/lead-desk";
import { companyName } from "@/lib/company-name";
import { downloadCsv } from "@/lib/export";
import {
  leadAccountabilityCsv,
  leadReportGroups,
  leadReportMetrics,
} from "@/lib/lead-report";
import { businessStampShort } from "@/lib/gst";
import { readJsonResponse } from "@/lib/client-request";
import { LeadFeedbackPanel } from "./lead-feedback";
import { BrandLogo } from "../brand";
import { useTableExport } from "../table-export";
import { PageActions } from "../ui/page-actions";
import {
  ListFilters,
  Pagination,
  SortHeader,
  usePagination,
} from "../pagination";
import { sortComparator } from "@/lib/list-query";
import {
  SelectionActions,
  SelectionCheckbox,
  useRowSelection,
} from "../row-selection";
import { recordDeleteProblem } from "@/lib/table-selection";
import styles from "./lead-desk.module.css";

function BreakdownTable({
  title,
  groups,
}: ReturnType<typeof leadReportGroups>[number]) {
  const pagination = usePagination(
    groups.map((g) => ({ id: g.id, name: g.name, ...g.data })),
    title,
  );
  const columns = [
    ["name", "Group"],
    ["inquiries", "Buyer inquiries"],
    ["qualified", "Qualified"],
    ["suppliers", "Supplier opportunities"],
    ["pending", "Needs feedback"],
    ["overdue", "Overdue"],
  ] as const;
  return (
    <section>
      <h3>{title}</h3>
      <ListFilters
        {...pagination}
        label={title.toLowerCase()}
        sortable={false}
      />
      <div className={styles.tableWrap}>
        <CrmTable className={styles.table}>
          <thead>
            <tr>
              {columns.map(([key, label]) => (
                <SortHeader
                  key={key}
                  sortKey={key}
                  query={pagination.query}
                  setQuery={pagination.setQuery}
                >
                  {label}
                </SortHeader>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagination.items.map((row) => (
              <tr key={row.id}>
                {columns.map(([key]) => (
                  <td key={key}>{row[key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </CrmTable>
      </div>
      <Pagination {...pagination} />
    </section>
  );
}

/** Cursor-load the entire permitted commercial scope, independently of the
 * ordinary workspace's 1000-record display window. Never label partial data
 * as a group total. Failed refreshes preserve, but clearly label, old data. */
export default function LeadDesk({
  actor,
  records,
  live = false,
  company = "All companies",
  onOpen,
  onSave,
  onAssign,
  onManageTeam,
  onPipeline,
  onImport,
  onDeleteSelected,
  busy,
  compact = false,
  onDesk,
  from = "",
  to = "",
}: {
  actor: Actor;
  records: RecordItem[];
  live?: boolean;
  company?: string;
  onOpen: (r: RecordItem) => void;
  onSave?: (r: RecordItem, action: LeadFeedbackAction) => Promise<void>;
  onAssign?: (r: RecordItem) => void;
  onManageTeam?: () => void;
  onPipeline?: () => void;
  onImport?: () => void;
  onDeleteSelected?: (rows: RecordItem[]) => void;
  busy?: boolean;
  compact?: boolean;
  onDesk?: () => void;
  from?: string;
  to?: string;
}) {
  const exporter = useTableExport();
  const [remote, setRemote] = useState<RecordItem[] | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState("");
  const [asOf, setAsOf] = useState("");
  const [tab, setTab] = useState(
    actor.role.startsWith("Sales") ? "Assigned to me" : "All leads",
  );
  const [search, setSearch] = useState("");
  const [type, setType] = useState("All types");
  const [owner, setOwner] = useState("All owners");
  const [source, setSource] = useState("All sources");
  const [dateFrom, setDateFrom] = useState(from);
  const [dateTo, setDateTo] = useState(to);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
  const [moreNumbers, setMoreNumbers] = useState(false);
  const [sort, setSort] = useState("default");
  useEffect(() => {
    setDateFrom(from);
    setDateTo(to);
  }, [from, to]);
  useEffect(() => {
    if (!live) return;
    const update = () => {
      if (document.visibilityState === "visible") setRefresh((v) => v + 1);
    };
    const timer = window.setInterval(update, 60000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [live]);
  useEffect(() => {
    if (!live || !allowedModules(actor).includes("leads")) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      let after: string | null = "",
        snapshot = "";
      const loaded: RecordItem[] = [],
        seen = new Set<string>();
      do {
        const query: URLSearchParams = new URLSearchParams({
          after: after || "",
        });
        if (snapshot) query.set("asOf", snapshot);
        const response: Response = await fetch(`/api/lead-desk?${query}`, {
          signal: controller.signal,
        });
        const result: {
          records: RecordItem[];
          asOf: string;
          next: string | null;
          error?: string;
        } = await readJsonResponse(
          response,
          "The Lead Desk could not refresh. Try again.",
        );
        if (!response.ok)
          throw new Error(result.error || "The Lead Desk could not refresh.");
        if (!Array.isArray(result.records) || typeof result.asOf !== "string")
          throw new Error(
            "The Lead Desk could not confirm its records. Refresh to try again.",
          );
        loaded.push(...result.records);
        snapshot = result.asOf;
        after = result.next;
        if (after && seen.has(after))
          throw new Error(
            "The Lead Desk could not finish loading. Please refresh.",
          );
        if (after) seen.add(after);
      } while (after && !controller.signal.aborted);
      if (!controller.signal.aborted) {
        setRemote(loaded);
        setAsOf(snapshot);
      }
    })()
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Please refresh the Lead Desk.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [live, actor.id, actor.role, records, refresh]);
  useEffect(() => {
    setPage(0);
  }, [tab, search, type, owner, source, dateFrom, dateTo, company, sort]);
  const scope = (live ? remote || [] : records).filter(
    (r) =>
      canRead(actor, r) &&
      !r.deletedAt &&
      (company === "All companies" || r.company === company),
  );
  const candidates = scope.filter((r) => r.kind === "leads");
  const filtered = scope.filter(
    (r) =>
      r.kind !== "leads" ||
      ((type === "All types" || leadType(r) === type) &&
        (owner === "All owners" || r.ownerId === owner) &&
        (source === "All sources" || r.source === source) &&
        `${r.title} ${r.product} ${r.attributes?.grade || ""} ${r.contact} ${r.owner}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const invalidRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const summary = leadSummary(
    actor,
    invalidRange ? [] : filtered,
    dateFrom,
    dateTo,
  );
  const today = businessToday();
  const queue = summary.leads.filter((r) =>
    tab === "All leads"
      ? true
      : tab === "Created by me"
        ? r.attributes?.leadCapturedById === actor.id
        : tab === "Assigned to me"
          ? r.ownerId === actor.id
          : tab === "New for me"
            ? openLead(r) && r.ownerId === actor.id && !acknowledged(r)
            : tab === "Needs assignment"
              ? awaitingAllocation(r)
              : tab === "Follow up today"
                ? openLead(r) && Boolean(r.due && r.due <= today)
                : tab === "Waiting for customer"
                  ? openLead(r) &&
                    r.attributes?.leadOutcome === "Waiting for Customer"
                  : needsFeedback(r),
  );
  queue.sort(
    sortComparator<RecordItem>(sort) ||
      ((a, b) =>
        (a.due || "9999").localeCompare(b.due || "9999") ||
        b.createdAt.localeCompare(a.createdAt)),
  );
  const selection = useRowSelection(
    queue,
    JSON.stringify([
      actor.id,
      actor.role,
      actor.companies,
      actor.branches,
      company,
      tab,
      search,
      type,
      owner,
      source,
      dateFrom,
      dateTo,
    ]),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(queue.length / 10) - 1),
  );
  const pageRows = queue.slice(currentPage * 10, currentPage * 10 + 10);
  const sortQuery = { search: "", status: "all", sort };
  const deletable = selection.selected.filter(
    (r) => !recordDeleteProblem(actor, r, scope),
  );
  if (!allowedModules(actor).includes("leads")) return null;
  const metrics = leadReportMetrics(actor, summary);
  const usable = !live || remote !== null;
  // Resolve by id so an open update follows successful saves and refreshes.
  const feedbackRecord = candidates.find((r) => r.id === expanded);
  const canExport = usable && !loading && !error;
  function exportReport() {
    downloadCsv(
      `lead-accountability-${today}.csv`,
      leadAccountabilityCsv(actor, filtered, {
        from: dateFrom,
        to: dateTo,
        scope: company,
        asOf: asOf || "Fictional preview",
        brands: company === "All companies" ? actor.companies : [company],
        filters: [
          ["Lead type filter", type],
          ["Owner filter", owner],
          ["Source filter", source],
          ["Search filter", search],
        ],
      }),
    );
  }
  const breakdowns = compact
    ? []
    : leadReportGroups(
        actor,
        invalidRange ? [] : filtered,
        dateFrom,
        dateTo,
        company === "All companies" ? actor.companies : [company],
      );
  const refreshButton = (
    <Button
      variant="secondary"
      size="small"
      aria-label="Refresh leads"
      disabled={loading}
      onClick={() => setRefresh((v) => v + 1)}
    >
      <RefreshCw size={15} aria-hidden="true" />
      Refresh
    </Button>
  );
  return (
    <section
      className={styles.desk}
      aria-label={compact ? "Lead accountability overview" : "Lead Desk"}
    >
      {compact && (
        <header className={styles.heading}>
          <div>
            <h2>Lead accountability</h2>
            {live && (
              <p className={styles.muted}>
                {asOf
                  ? `Updated ${businessStampShort(asOf)}${error ? " · Last successful snapshot" : ""}`
                  : "Loading your leads…"}
              </p>
            )}
          </div>
          <div className={styles.actions}>
            {onDesk && (
              <Button className="secondary" onClick={onDesk}>
                Open Lead Desk
              </Button>
            )}
            {refreshButton}
          </div>
        </header>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}{" "}
          {usable
            ? "Showing the last successful snapshot, not current totals."
            : "Totals are unavailable until loading succeeds."}
        </p>
      )}
      <div className={styles.metrics} aria-busy={loading}>
        {metrics
          .filter((_, i) => moreNumbers || [0, 4, 5, 6].includes(i))
          .map(([label, value]) => (
            <div className={styles.metric} key={label}>
              <span>{label}</span>
              <strong>{!usable ? "—" : value}</strong>
            </div>
          ))}
      </div>
      {!compact && (
        <>
          <div className={styles.toolbar} aria-label="Lead Desk filters">
            <label className={styles.searchField}>
              <span className="sr-only">Find a lead</span>
              <Input
                type="search"
                aria-label="Search leads or product grade"
                placeholder="Search company, product or grade…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className={styles.filterField}>
              <span className="sr-only">Show leads</span>
              <Select
                aria-label="Show leads"
                value={tab}
                onChange={(e) => setTab(e.target.value)}
              >
                {[
                  "Assigned to me",
                  "Created by me",
                  "New for me",
                  "Needs assignment",
                  "Follow up today",
                  "Waiting for customer",
                  "Needs feedback",
                  "All leads",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </label>
            <Button
              className="secondary"
              aria-expanded={moreFilters}
              onClick={() => setMoreFilters((v) => !v)}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              {moreFilters ? "Hide filters" : "Filters"}
            </Button>
            <div className={styles.fileActions}>
              <PageActions
                label="Lead Desk"
                actions={[
                  {
                    id: "refresh",
                    label: "Refresh",
                    icon: <RefreshCw size={14} />,
                    disabled: loading,
                    run: () => setRefresh((v) => v + 1),
                  },
                  ...(onImport
                    ? [
                        {
                          id: "import",
                          label: "Import",
                          icon: <Upload size={14} />,
                          run: onImport,
                        },
                      ]
                    : []),
                  ...(exporter.available
                    ? [
                        {
                          id: "export",
                          label: "Export Excel",
                          icon: <Download size={14} />,
                          disabled: !canExport || !queue.length,
                          run: () => exporter.run(queue, "Lead Desk"),
                        },
                      ]
                    : []),
                  ...(onManageTeam
                    ? [
                        {
                          id: "team",
                          label: "Manage team",
                          icon: <Users size={14} />,
                          run: onManageTeam,
                        },
                      ]
                    : []),
                  {
                    id: "weekly",
                    label: "Weekly report",
                    icon: <Download size={14} />,
                    disabled: !canExport || invalidRange,
                    run: exportReport,
                  },
                  {
                    id: "metrics",
                    label: moreNumbers ? "Fewer numbers" : "More numbers",
                    run: () => setMoreNumbers((v) => !v),
                  },
                ]}
              />
            </div>
          </div>
          {moreFilters && (
            <div className={styles.extraFilters}>
              <label className={styles.filterField}>
                <span>Lead type</span>
                <Select
                  aria-label="Lead type filter"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  {["All types", ...leadTypes, "Unclassified"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </Select>
              </label>
              <label className={styles.filterField}>
                <span>Salesperson</span>
                <Select
                  aria-label="Lead owner filter"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                >
                  <option>All owners</option>
                  {[
                    ...new Map(
                      candidates.map((r) => [r.ownerId, r.owner]),
                    ).entries(),
                  ].map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className={styles.filterField}>
                <span>Source</span>
                <Select
                  aria-label="Lead source filter"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  {[
                    "All sources",
                    ...new Set(candidates.map((r) => r.source).filter(Boolean)),
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </Select>
              </label>
              <label className={styles.filterField}>
                <span>Created from</span>
                <Input
                  type="date"
                  aria-label="Inquiries created from"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </label>
              <label className={styles.filterField}>
                <span>Created through</span>
                <Input
                  type="date"
                  aria-label="Inquiries created through"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </label>
              <Button
                className="secondary"
                onClick={() => {
                  setType("All types");
                  setOwner("All owners");
                  setSource("All sources");
                  setDateFrom(from);
                  setDateTo(to);
                }}
              >
                Reset filters
              </Button>
            </div>
          )}
          {invalidRange && (
            <p role="alert" className={styles.error}>
              Choose an end date on or after the start date.
            </p>
          )}
          <div className={styles.queueHeading}>
            <h3>{tab}</h3>
            <span>{queue.length} leads</span>
            {live && (
              <span>
                {asOf ? `Updated ${businessStampShort(asOf)}` : "Refreshing…"}
              </span>
            )}
          </div>
          <SelectionActions
            selected={selection.selected}
            title="Lead Desk"
            onClear={selection.clear}
            onDelete={
              onDeleteSelected && canExport
                ? () => onDeleteSelected(selection.selected)
                : undefined
            }
            deletableCount={deletable.length}
          />
          <div className={styles.queue}>
            {!!queue.length && (
              <CrmTable className={styles.queueTable}>
                <thead>
                  <tr>
                    <th className="table-select-cell">
                      <SelectionCheckbox
                        label="Select all leads on this page"
                        checked={pageRows.every((r) => selection.has(r.id))}
                        mixed={
                          pageRows.some((r) => selection.has(r.id)) &&
                          !pageRows.every((r) => selection.has(r.id))
                        }
                        onChange={(checked) =>
                          selection.togglePage(pageRows, checked)
                        }
                        disabled={!canExport}
                      />
                    </th>
                    <SortHeader
                      sortKey="name"
                      query={sortQuery}
                      setQuery={(q) => setSort(q.sort)}
                    >
                      Lead / company
                    </SortHeader>
                    <SortHeader
                      sortKey="owner"
                      query={sortQuery}
                      setQuery={(q) => setSort(q.sort)}
                    >
                      Salesperson
                    </SortHeader>
                    <SortHeader
                      sortKey="due"
                      query={sortQuery}
                      setQuery={(q) => setSort(q.sort)}
                    >
                      Follow-up
                    </SortHeader>
                    <SortHeader
                      sortKey="status"
                      query={sortQuery}
                      setQuery={(q) => setSort(q.sort)}
                    >
                      Status
                    </SortHeader>
                    <th>Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr
                      key={r.id}
                      data-lead-row
                      data-selected={selection.has(r.id) || undefined}
                    >
                      <td className="table-select-cell">
                        <SelectionCheckbox
                          label={`Select ${r.title}`}
                          checked={selection.has(r.id)}
                          onChange={(checked) =>
                            selection.toggle(r.id, checked)
                          }
                          disabled={!canExport}
                        />
                      </td>
                      <td>
                        <div className={styles.identity}>
                          <BrandLogo
                            company={r.company}
                            className={styles.brand}
                          />
                          <div>
                            <Button onClick={() => onOpen(r)}>{r.title}</Button>
                            <small
                              title={`${companyName(r.company)} · ${r.product || "Product not yet known"} · ${leadType(r)}`}
                            >
                              {companyName(r.company)} · {leadType(r)} ·{" "}
                              {r.product || "Product not yet known"}
                              {r.attributes?.grade
                                ? ` · ${r.attributes.grade}`
                                : ""}
                              <span className={styles.mobileOwner}>
                                {" "}
                                · {r.owner || "Unassigned"}
                              </span>
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={styles.ownerCell}>
                          <span className={styles.owner} title={r.owner}>
                            {r.owner || "Unassigned"}
                          </span>
                          {onAssign && canAssign(actor, r) && (
                            <Button
                              variant="ghost"
                              size="small"
                              className={styles.assignButton}
                              aria-label={`Assign salesperson for ${r.title}`}
                              aria-haspopup="dialog"
                              disabled={busy}
                              onClick={() => onAssign(r)}
                            >
                              <UserPlus size={13} aria-hidden="true" />
                              {r.owner ? "Change" : "Assign"}
                            </Button>
                          )}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`${styles.followUp}${r.due && r.due < today && openLead(r) ? ` ${styles.overdue}` : ""}`}
                          title={
                            r.due ? `Follow up ${r.due}` : "No next action"
                          }
                        >
                          {r.due
                            ? r.due === today
                              ? "Today"
                              : new Intl.DateTimeFormat("en-GB", {
                                  day: "numeric",
                                  month: "short",
                                  timeZone: "UTC",
                                }).format(new Date(`${r.due}T12:00:00Z`))
                            : "No follow-up"}
                          {r.due && r.due < today && openLead(r) && (
                            <small>Overdue</small>
                          )}
                          {r.attributes?.leadOutcome && (
                            <small
                              className={styles.latestOutcome}
                              title={
                                r.attributes.leadFeedbackNote ||
                                r.attributes.leadOutcome
                              }
                            >
                              {r.attributes.leadOutcome}
                            </small>
                          )}
                        </span>
                      </td>
                      <td>
                        <span className={styles.badge}>{r.status}</span>
                      </td>
                      <td>
                        <div className={styles.actions}>
                          <Button
                            className="secondary"
                            aria-haspopup="dialog"
                            onClick={() => setExpanded(r.id)}
                          >
                            {canWrite(actor, r) &&
                            !actor.role.startsWith("Marketing") &&
                            openLead(r)
                              ? "Update / feedback"
                              : "View feedback"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </CrmTable>
            )}
          </div>
          {!queue.length && !loading && (
            <p className={styles.empty}>
              No leads in this queue. Try All leads or change the filters.
            </p>
          )}
          <div className={styles.pagination}>
            <span className={styles.muted}>
              {queue.length
                ? `${currentPage * 10 + 1}–${Math.min(queue.length, currentPage * 10 + 10)} of ${queue.length}`
                : "0 leads"}
            </span>
            <div className={styles.actions}>
              <Button
                className="secondary"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </Button>
              <Button
                className="secondary"
                disabled={(currentPage + 1) * 10 >= queue.length}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
          <details className={styles.panel}>
            <summary>
              Management breakdown · brand, product, owner & source
            </summary>
            <div className={styles.report}>
              {breakdowns.map((section) => (
                <BreakdownTable key={section.title} {...section} />
              ))}
            </div>
          </details>
          <details className={styles.panel}>
            <summary>Team guide · daily routine & responsibilities</summary>
            <div className={styles.help}>
              <ol>
                <li>
                  Marketing captures the inquiry with its brand, source and
                  buyer/supplier type. Keep prospects separate from actual
                  buying requests.
                </li>
                <li>
                  An authorised manager assigns one responsible person using
                  Assign on the lead record.
                </li>
                <li>
                  The assigned person acknowledges it, records the contact
                  outcome and chooses the next follow-up. Add a reason when
                  returning an irrelevant lead.
                </li>
                <li>
                  Complete product, grade, quantity/unit, destination, customer
                  contact and owner before qualification. Quotation, negotiation
                  and confirmed-order handoffs retain the existing approval
                  controls.
                </li>
                <li>
                  Start each day with New for me and Follow up today. Before
                  finishing, clear missing feedback and next actions.
                </li>
              </ol>
              <p>
                Marketing owns capture and quality. Sales owns contact,
                qualification and follow-up. Sales management owns allocation
                and overdue exceptions. IT, Liera or the MD can run the weekly
                CRM review. Aleena and Max handle Sales; Mak handles Logistics;
                Liera is the personal assistant. IT controls company-owned
                accounts, MFA and offboarding. Never put passwords or recovery
                codes in lead notes.
              </p>
              <p>
                Training plan for Liera, Aleena, Mak and Max: Day 1 capture (30
                min); Day 2 handoff/feedback (20 min); Day 3
                qualification/quotation (30 min); Day 4 reporting (20 min); Day
                5 supervised practice (20 min). Brand coverage, access grants
                and calendar dates await confirmation. This is a plan, not
                completed training.
              </p>
              <p>
                Website intake must be configured per brand. Email, WhatsApp,
                social and advertising should be recorded manually until each
                integration is approved and tested. In the connected CRM, a
                saved Sales outcome notifies the lead creator internally if they
                still have access. Browser preview does not deliver
                notifications. Saving an outcome sends no external message.
              </p>
            </div>
          </details>
        </>
      )}
      <details className={styles.numberGuide}>
        <summary>
          About these numbers · {summary.awaitingAllocation} awaiting assignment
        </summary>
        <p>
          {canSeeAllLeads(actor)
            ? "All leads in your allowed brands."
            : "Leads you created or that are assigned to you."}{" "}
          Business dates use GST. {summary.prospects} buyer prospects ·{" "}
          {summary.suppliers} supplier opportunities · {summary.unclassified}{" "}
          unclassified. Only buyer inquiries count as inquiries. First response
          uses {summary.responseSamples} known receipt/contact pairs; missing
          timing stays Unknown. Figures follow the selected inquiry-creation
          cohort; conversions require linked confirmed orders, not a manually
          selected Won status.
        </p>
      </details>
      {feedbackRecord && onSave && (
        <Dialog
          title="Lead update"
          description={feedbackRecord.title}
          variant="drawer"
          onClose={() => {
            if (!busy) setExpanded("");
          }}
          dismissOnOutside={false}
          className={styles.updateDrawer}
        >
          <LeadFeedbackPanel
            key={`${feedbackRecord.id}-${feedbackRecord.updatedAt}`}
            record={feedbackRecord}
            actor={actor}
            busy={busy}
            onSave={async (action) => {
              await onSave(feedbackRecord, action);
              setRefresh((v) => v + 1);
            }}
          />
        </Dialog>
      )}
    </section>
  );
}
