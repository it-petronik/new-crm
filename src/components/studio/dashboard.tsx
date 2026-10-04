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
import { businessStampShort } from "@/lib/gst";
import { Button, Select } from "../ui/controls";
import { StatusBadge } from "../ui/status-badge";
import { Avatar } from "../avatar";
import styles from "./dashboard.module.css";

export default function StudioDashboard({
  actor,
  records,
  currentRecords,
  onSelect,
  go,
  onQuickAdd,
  events,
}: {
  actor: Actor;
  records: RecordItem[];
  currentRecords: RecordItem[];
  onSelect: (r: RecordItem) => void;
  go: (m: Module) => void;
  onQuickAdd: (kind?: Kind) => void;
  events: Audit[];
}) {
  const currencies = [
    ...new Set(records.map((r) => r.currency).filter(Boolean)),
  ].sort();
  const [choice, setChoice] = useState("USD");
  const currency = currencies.includes(choice)
    ? choice
    : currencies[0] || "USD";
  const [chartCompany, setChartCompany] = useState<string | null>(null);
  const [tab, setTab] = useState<"performance" | "priorities">("performance");
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
      !["Paid", "Cancelled"].includes(r.status),
  );
  const sum = (rows: RecordItem[]) =>
    rows
      .filter((r) => r.currency === currency)
      .reduce((s, r) => s + r.amount, 0);
  const priority = attentionItems(actor, currentRecords);
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
      <div className={styles.toolbar}>
        <div className={styles.tabs} aria-label="Dashboard view">
          <button
            aria-pressed={tab === "performance"}
            onClick={() => setTab("performance")}
          >
            Performance
          </button>
          <button
            aria-pressed={tab === "priorities"}
            onClick={() => setTab("priorities")}
          >
            My priorities <span>{priority.length}</span>
          </button>
        </div>
        <Select
          aria-label="Dashboard currency"
          value={currency}
          onChange={(e) => setChoice(e.target.value)}
        >
          {(currencies.length ? currencies : ["USD"]).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </div>
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
            <strong>{m.value}</strong>
            <span className={styles.metricNote}>
              {m.note}
              <ArrowUpRight size={15} />
            </span>
          </button>
        ))}
      </div>
      <div className={styles.grid}>
        {tab === "performance" ? (
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
                      <div className={styles.barGroup} key={r.name} onMouseEnter={() => setChartCompany(r.name)} onMouseLeave={() => setChartCompany(null)} onFocus={() => setChartCompany(r.name)} onBlur={() => setChartCompany(null)}>
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
                  {chartCompany ? <><strong>{chartCompany}</strong><span>Orders <b>{money(series.find(r => r.name === chartCompany)?.sales || 0, currency)}</b></span><span>Pipeline <b>{money(series.find(r => r.name === chartCompany)?.pipeline || 0, currency)}</b></span></> : <span>Hover or focus a bar to inspect · Select to open records</span>}
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
                {allowed.includes("leads") && (
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
        ) : (
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Your next moves</h2>
                <p>Current work, regardless of the reporting period</p>
              </div>
              <span className={styles.unit}>{priority.length} open</span>
            </div>
            <div className={styles.priorities} role="region" aria-label="Your next moves" tabIndex={0}>
              {priority.map((item) => (
                <button key={item.id} onClick={() => onSelect(item.record)}>
                  <span className={styles.priorityDot} />
                  <span>
                    <strong>{item.record.title}</strong>
                    <small>{item.reason}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
              {!priority.length && (
                <div className={styles.empty}>
                  <CheckCheck size={28} />
                  <strong>You’re all caught up</strong>
                  <p>No overdue work or approvals within your access.</p>
                </div>
              )}
            </div>
            {priority.length > 5 && <p className={styles.scrollHint}>Scroll the list to review all {priority.length} priorities.</p>}
          </section>
        )}
        <section className={`${styles.card} ${styles.focus}`}>
          <div className={styles.cardHead}>
            <div>
              <span className={styles.eyebrow}>TODAY’S FOCUS</span>
              <h2>Make the next move.</h2>
            </div>
            <span className={styles.focusIcon}>
              <Target size={21} />
            </span>
          </div>
          <p className={styles.focusDescription}>
            A clear view of what needs you, so nothing important slips through.
          </p>
          <div className={styles.focusCount}>
            <strong>{priority.length.toString().padStart(2, "0")}</strong>
            <span>
              items need
              <br />
              your attention
            </span>
          </div>
          <div className={styles.focusList}>
            {priority.slice(0, 3).map((item) => (
              <button key={item.id} onClick={() => onSelect(item.record)}>
                <span>
                  <strong>{item.record.title}</strong>
                  <small>{item.category}</small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
            {!priority.length && (
              <p className={styles.caughtUp}>
                <CheckCheck size={17} />
                Nothing urgent right now.
              </p>
            )}
          </div>
          <button
            className={styles.focusAction}
            onClick={() =>
              setTab(tab === "priorities" ? "performance" : "priorities")
            }
          >
            {tab === "priorities" ? "Back to performance" : "Review priorities"}
            <ArrowRight size={16} />
          </button>
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
    </div>
  );
}
