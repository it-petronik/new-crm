"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Target,
  Package,
  FileText,
  Wallet,
  Plus,
  CheckCheck,
  Activity,
  Circle,
} from "lucide-react";
import {
  allowedModules,
  canWrite,
  money,
  outstanding,
  type Actor,
  type RecordItem,
  type Module,
  type Kind,
  type Audit,
} from "@/lib/domain";
import { attentionItems } from "@/lib/attention";
import { companyName } from "@/lib/company-name";
import { formatMoneyCompact } from "@/lib/money-format";
import { isCashEntry } from "@/lib/cashbook";
import { isProforma } from "@/lib/domain";
import { businessStampShort } from "@/lib/gst";
import { Button, Select, Dialog, DialogActions } from "../ui/controls";
import { StatusBadge } from "../ui/status-badge";
import { Avatar } from "../avatar";
import styles from "./dashboard.module.css";
import ManagementOverview, {
  type ManagementReportState,
} from "./management-overview";
import { canViewManagement, managementScope } from "@/lib/management-dashboard";

export default function StudioDashboard({
  actor,
  records: initialRecords,
  currentRecords,
  onSelect,
  go,
  onQuickAdd,
  events,
  live = false,
  company = "All companies",
  from = "",
  to = "",
  currency = "USD",
}: {
  actor: Actor;
  records: RecordItem[];
  currentRecords: RecordItem[];
  onSelect: (r: RecordItem) => void;
  go: (m: Module) => void;
  onQuickAdd: (kind?: Kind) => void;
  events: Audit[];
  live?: boolean;
  company?: string;
  from?: string;
  to?: string;
  currency?: string;
}) {
  const [management, setManagement] = useState<ManagementReportState | null>(
    null,
  );
  const managementAllowed = canViewManagement(actor);
  const completeRecords =
    managementAllowed && management?.scope === managementScope(actor)
      ? management.records
      : null;
  // The executive figures use the same complete, permission-checked data as
  // the department report, not the ordinary 1000-row display window.
  const records = (completeRecords || initialRecords).filter(
    (r) =>
      (company === "All companies" || r.company === company) &&
      (!from || r.createdAt.slice(0, 10) >= from) &&
      (!to || r.createdAt.slice(0, 10) <= to),
  );
  const pendingTotals = managementAllowed && !completeRecords;
  const [chartCompany, setChartCompany] = useState<string | null>(null);
  const [prioritiesOpen, setPrioritiesOpen] = useState(false);
  const allowed = allowedModules(actor);
  const leads = records.filter((r) => r.kind === "leads");
  const open = leads.filter((r) => !["Won", "Lost"].includes(r.status));
  const orders = records.filter(
    (r) =>
      r.kind === "orders" &&
      ["Confirmed", "In Progress", "Completed"].includes(r.status),
  );
  const quotes = records.filter(
    (r) =>
      r.kind === "quotations" &&
      !["Accepted", "Rejected", "Expired", "Cancelled"].includes(r.status),
  );
  const invoices = records.filter(
    (r) =>
      r.kind === "accounts" &&
      !isCashEntry(r) &&
      !isProforma(r) &&
      !["Paid", "Cancelled"].includes(r.status),
  );
  const sum = (rows: RecordItem[]) =>
    rows
      .filter((r) => r.currency === currency)
      .reduce((s, r) => s + r.amount, 0);
  const priority = attentionItems(
    actor,
    (completeRecords || currentRecords).filter(
      (r) => company === "All companies" || r.company === company,
    ),
  );
  const metrics = [
    {
      title: "Confirmed sales",
      value: formatMoneyCompact(sum(orders), currency),
      note: `${orders.filter((r) => r.currency === currency).length} orders · ${currency}`,
      icon: Package,
      module: "orders" as Module,
      featured: true,
    },
    {
      title: "Open pipeline",
      value: formatMoneyCompact(sum(open), currency),
      note: `${open.filter((r) => r.currency === currency).length} active leads · ${currency}`,
      icon: Target,
      module: "leads" as Module,
    },
    {
      title: "Open quotations",
      value: String(quotes.length).padStart(2, "0"),
      note: "Waiting for the next step",
      icon: FileText,
      module: "quotations" as Module,
    },
    {
      title: "Awaiting payment",
      value: formatMoneyCompact(
        invoices
          .filter((r) => r.currency === currency)
          .reduce((s, r) => s + outstanding(r), 0),
        currency,
      ),
      note: `${invoices.filter((r) => r.currency === currency).length} unsettled invoices · ${currency}`,
      icon: Wallet,
      module: "accounts" as Module,
    },
  ].filter((m) => allowed.includes(m.module));
  const companies = actor.companies.filter((c) =>
    records.some((r) => r.company === c),
  );
  const series = companies.map((c) => ({
    name: companyName(c),
    sales: sum(orders.filter((r) => r.company === c)),
    pipeline: sum(open.filter((r) => r.company === c)),
  }));
  const max = Math.max(1, ...series.flatMap((r) => [r.sales, r.pipeline]));
  const salesTotal = sum(orders);
  const recent = [...records]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  return (
    <div className={styles.dashboard} data-ui="studio-dashboard">
      <div className={styles.metrics}>
        {metrics.map((m) => (
          <button
            key={m.title}
            className={`${styles.metric} ${m.featured ? styles.featured : ""}`}
            onClick={() => go(m.module)}
          >
            <span className={styles.metricLabel}>
              {m.title}
              <m.icon size={17} />
            </span>
            <span className={styles.metricValue}>
              <strong>{pendingTotals ? "—" : m.value}</strong>
            </span>
            <span className={styles.metricNote}>
              {pendingTotals
                ? management?.error
                  ? "Complete totals unavailable"
                  : "Loading complete totals…"
                : `${m.note}${management?.error ? " · Last successful update" : ""}`}
              <ArrowUpRight size={15} />
            </span>
          </button>
        ))}
      </div>
      {managementAllowed && (
        <ManagementOverview
          actor={actor}
          records={currentRecords}
          live={live}
          company={company}
          from={from}
          to={to}
          go={go}
          onSelect={onSelect}
          onReport={setManagement}
        />
      )}
      {!pendingTotals && (
        <section className={styles.attentionBar} aria-label="Needs attention">
          <div>
            <h2>
              Needs attention <span>{priority.length}</span>
            </h2>
            <small>Current overdue work and approvals</small>
          </div>
          <div className={styles.attentionItems}>
            {priority.slice(0, 3).map((item) => (
              <button key={item.id} onClick={() => onSelect(item.record)}>
                <strong>{item.record.title}</strong>
                <small>{item.reason}</small>
              </button>
            ))}
            {!priority.length && <span>Nothing urgent right now.</span>}
          </div>
          <Button
            variant="secondary"
            size="small"
            onClick={() => setPrioritiesOpen(true)}
          >
            Review all
          </Button>
        </section>
      )}
      {!pendingTotals && (
        <details className={styles.report}>
          <summary>Sales & activity details</summary>
          <div className={styles.grid}>
            <section className={`${styles.card} ${styles.performance}`}>
              <div className={styles.cardHead}>
                <div>
                  <h2>Sales overview</h2>
                  <p>Confirmed orders and future opportunities</p>
                </div>
                <span className={styles.unit}>{currency}</span>
              </div>
              <div className={styles.chartTotal}>
                <strong>{formatMoneyCompact(salesTotal, currency)}</strong>
                <span>
                  Confirmed order value
                  <br />
                  <small>Not collected revenue</small>
                </span>
              </div>
              {series.some((r) => r.sales || r.pipeline) ? (
                <>
                  <div
                    className={styles.chart}
                    aria-label={`Sales and pipeline by company in ${currency}`}
                  >
                    <div className={styles.axis}>
                      {[1, 0.75, 0.5, 0.25, 0].map((t) => (
                        <span key={t}>
                          {formatMoneyCompact(max * t, currency)}
                        </span>
                      ))}
                    </div>
                    <div className={styles.plot}>
                      {series.map((r) => (
                        <div
                          className={styles.barGroup}
                          key={r.name}
                          onMouseEnter={() => setChartCompany(r.name)}
                          onMouseLeave={() => setChartCompany(null)}
                          onFocus={() => setChartCompany(r.name)}
                          onBlur={() => setChartCompany(null)}
                        >
                          <div className={styles.bars}>
                            <button
                              style={{ height: `${(r.sales / max) * 100}%` }}
                              disabled={
                                r.sales === 0 || !allowed.includes("orders")
                              }
                              aria-label={`${r.name} confirmed sales ${money(r.sales, currency)}. View orders`}
                              title={`${r.name} · Confirmed sales ${money(r.sales, currency)}`}
                              onClick={() => go("orders")}
                            />
                            <button
                              style={{ height: `${(r.pipeline / max) * 100}%` }}
                              disabled={
                                r.pipeline === 0 || !allowed.includes("leads")
                              }
                              aria-label={`${r.name} open pipeline ${money(r.pipeline, currency)}. View leads`}
                              title={`${r.name} · Open pipeline ${money(r.pipeline, currency)}`}
                              onClick={() => go("leads")}
                            />
                          </div>
                          <span>{r.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className={styles.chartReadout}>
                    {chartCompany ? (
                      <>
                        <strong>{chartCompany}</strong>
                        <span>
                          Orders{" "}
                          <b>
                            {money(
                              series.find((r) => r.name === chartCompany)
                                ?.sales || 0,
                              currency,
                            )}
                          </b>
                        </span>
                        <span>
                          Pipeline{" "}
                          <b>
                            {money(
                              series.find((r) => r.name === chartCompany)
                                ?.pipeline || 0,
                              currency,
                            )}
                          </b>
                        </span>
                      </>
                    ) : (
                      <span>
                        Hover or focus a bar to inspect · Select to open records
                      </span>
                    )}
                  </div>
                  <div className={styles.legend}>
                    <span>
                      <i />
                      Confirmed orders
                    </span>
                    <span>
                      <i />
                      Open pipeline
                    </span>
                  </div>
                </>
              ) : (
                <div className={styles.empty}>
                  <Activity size={28} />
                  <strong>Your sales story starts here</strong>
                  <p>
                    Confirmed orders and open leads will appear here. Choose a
                    wider date range to include older records.
                  </p>
                  {canWrite(actor, {
                    kind: "leads",
                    company: actor.companies[0],
                    branch: actor.branches[0] || "Main",
                    ownerId: actor.id,
                  } as RecordItem) && (
                    <Button
                      variant="secondary"
                      onClick={() => onQuickAdd("leads")}
                    >
                      <Plus size={14} />
                      Add a lead
                    </Button>
                  )}
                </div>
              )}
            </section>
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h2>Recent records</h2>
                  <p>Your latest work, in one place</p>
                </div>
                <span className={styles.unit}>{records.length} in period</span>
              </div>
              <div className={styles.recent}>
                {recent.map((r) => (
                  <button key={r.id} onClick={() => onSelect(r)}>
                    <Avatar name={r.title} size={32} />
                    <span>
                      <strong>{r.title}</strong>
                      <small>
                        {companyName(r.company)} · {r.product || r.kind}
                      </small>
                    </span>
                    <StatusBadge status={r.status} />
                    <ArrowUpRight size={15} />
                  </button>
                ))}
                {!recent.length && (
                  <div className={styles.empty}>
                    <FileText size={26} />
                    <strong>No records in this period</strong>
                    <p>Try another date range or create your first record.</p>
                  </div>
                )}
              </div>
            </section>
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h2>Workspace activity</h2>
                  <p>Latest changes across your scope</p>
                </div>
                <Activity size={17} />
              </div>
              <div className={styles.timeline}>
                {events.slice(0, 4).map((e) => (
                  <div key={e.id}>
                    <Circle size={9} />
                    <span>
                      <strong>{e.action}</strong>
                      <small>
                        {e.actor} · {businessStampShort(e.at)}
                      </small>
                    </span>
                  </div>
                ))}
                {!events.length && (
                  <div className={styles.empty}>
                    <Activity size={26} />
                    <strong>No updates yet</strong>
                    <p>Changes made by your team will appear here.</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </details>
      )}
      {prioritiesOpen && (
        <Dialog
          title="Needs attention"
          onClose={() => setPrioritiesOpen(false)}
        >
          <div className={styles.priorities}>
            {priority.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setPrioritiesOpen(false);
                  onSelect(item.record);
                }}
              >
                <span>
                  <strong>{item.record.title}</strong>
                  <small>{item.reason}</small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            ))}
            {!priority.length && <p>Nothing urgent right now.</p>}
          </div>
          <DialogActions onCancel={() => setPrioritiesOpen(false)} />
        </Dialog>
      )}
    </div>
  );
}
