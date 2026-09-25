"use client";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/controls";
import { formatMoneyCompact, totalsByCurrency, describeTotals } from "@/lib/money-format";
import { isOpen, staleRecords, idleDays, isoDate } from "@/lib/attention";
import { stages, type RecordItem } from "@/lib/domain";

/**
 * The executive middle of the dashboard: what is active, where it is stuck,
 * and what operations need looking at.
 *
 * Everything is counted from records already loaded — no extra request, no
 * invented comparison. Where a figure cannot be derived honestly it is left
 * out rather than estimated.
 */

// ------------------------------------------------------------------ KPI strip

export type Kpi = { label: string; value: string; context: string; to?: string };

/**
 * Four figures, in one compact strip.
 *
 * No period-over-period arrows: the data has no reliable prior-period
 * snapshot, and an invented trend is worse than none. Amounts are totalled per
 * currency and never summed across them.
 */
export function KpiStrip({ records, onGo }: { records: RecordItem[]; onGo: (m: string) => void }) {
  const open = records.filter(isOpen);
  const pipeline = open.filter((r) => r.kind === "leads" || r.kind === "quotations");
  const won = records.filter((r) => r.status === "Won" || r.status === "Accepted");
  const outstanding = open.filter((r) => r.kind === "accounts");
  const moving = open.filter((r) => r.kind === "orders" || r.kind === "logistics");

  const kpis: Kpi[] = [
    {
      label: "Open pipeline",
      value: describeTotals(totalsByCurrency(pipeline)),
      context: `${pipeline.length} open ${pipeline.length === 1 ? "opportunity" : "opportunities"}`,
      to: "leads",
    },
    {
      label: "Won",
      value: describeTotals(totalsByCurrency(won)),
      context: `${won.length} closed ${won.length === 1 ? "deal" : "deals"}`,
      to: "leads",
    },
    {
      label: "Outstanding",
      value: describeTotals(totalsByCurrency(outstanding)),
      context: `${outstanding.filter((r) => r.status === "Overdue").length} overdue`,
      to: "accounts",
    },
    {
      label: "In progress",
      value: String(moving.length),
      context: `${moving.filter((r) => r.status === "Delayed").length} delayed`,
      to: "orders",
    },
  ];

  return (
    <div className="e-kpi-strip">
      {kpis.map((kpi) => (
        <Button
          key={kpi.label}
          className="e-kpi"
          onClick={() => kpi.to && onGo(kpi.to)}
          aria-label={`${kpi.label}: ${kpi.value}. ${kpi.context}`}
        >
          <span className="e-kpi-label">{kpi.label}</span>
          <span className="e-kpi-value">{kpi.value}</span>
          <span className="e-caption">{kpi.context}</span>
        </Button>
      ))}
    </div>
  );
}

// -------------------------------------------------------------- pipeline health

/**
 * One pipeline view, not several charts.
 *
 * Each stage shows how many records sit in it, what they are worth, and how
 * many have gone quiet — which is what turns a funnel picture into something
 * actionable. The widest bar is the bottleneck.
 */
export function PipelineHealth({
  records,
  onGo,
}: {
  records: RecordItem[];
  onGo: (m: string) => void;
}) {
  const today = isoDate(new Date());
  const leads = records.filter((r) => r.kind === "leads" && !r.deletedAt);
  const stageNames = stages.leads.filter((s) => s !== "Lost");

  const rows = stageNames.map((stage) => {
    const inStage = leads.filter((r) => r.status === stage);
    return {
      stage,
      count: inStage.length,
      totals: totalsByCurrency(inStage),
      stale: staleRecords(inStage, today).length,
      oldest: inStage.reduce((max, r) => Math.max(max, idleDays(r, today)), 0),
    };
  });

  const peak = Math.max(1, ...rows.map((r) => r.count));
  const busiest = rows.reduce((a, b) => (b.count > a.count ? b : a), rows[0]);

  if (!leads.length)
    return (
      <section className="panel e-pipeline">
        <div className="panel-heading"><h2 className="e-section-title">Pipeline health</h2></div>
        <p className="e-empty">No open opportunities yet. Added leads will appear here by stage.</p>
      </section>
    );

  return (
    <section className="panel e-pipeline">
      <div className="panel-heading">
        <h2 className="e-section-title">Pipeline health</h2>
        <Button className="secondary" onClick={() => onGo("leads")}>
          Open pipeline <ArrowRight size={14} />
        </Button>
      </div>
      <ul className="e-pipeline-list">
        {rows.map((row) => (
          <li key={row.stage} className={row.stage === busiest.stage && row.count > 0 ? "is-peak" : undefined}>
            <span className="e-pipeline-stage">{row.stage}</span>
            <span className="e-pipeline-bar" aria-hidden="true">
              <span style={{ width: `${Math.round((row.count / peak) * 100)}%` }} />
            </span>
            <span className="e-pipeline-count e-numeric">{row.count}</span>
            <span className="e-pipeline-value e-numeric">{describeTotals(row.totals)}</span>
            <span className="e-pipeline-stale">
              {row.stale > 0 ? `${row.stale} gone quiet` : row.count ? `${row.oldest}d oldest` : "—"}
            </span>
          </li>
        ))}
      </ul>
      {busiest.stale > 0 && (
        <p className="e-meta e-pipeline-note">
          Most records are sitting in <b>{busiest.stage}</b>, {busiest.stale} of them without recent activity.
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------ operations snapshot

/**
 * Orders, logistics, accounts and quotations at a glance, each a link into the
 * work itself. Counts only — a figure nobody can act on is noise.
 */
export function OperationsSnapshot({
  records,
  onGo,
}: {
  records: RecordItem[];
  onGo: (m: string) => void;
}) {
  const open = records.filter(isOpen);
  const today = isoDate(new Date());
  const count = (kind: string, predicate: (r: RecordItem) => boolean) =>
    open.filter((r) => r.kind === kind && predicate(r)).length;

  const blocks = [
    {
      module: "orders",
      title: "Orders",
      primary: `${count("orders", () => true)} active`,
      alert: count("orders", (r) => r.status === "Delayed"),
      alertLabel: "delayed",
    },
    {
      module: "logistics",
      title: "Logistics",
      primary: `${count("logistics", (r) => r.status === "In Transit")} in transit`,
      alert: count("logistics", (r) => r.status === "Delayed"),
      alertLabel: "delayed",
    },
    {
      module: "accounts",
      title: "Accounts",
      primary: describeTotals(totalsByCurrency(open.filter((r) => r.kind === "accounts"))),
      alert: count("accounts", (r) => r.status === "Overdue"),
      alertLabel: "overdue",
    },
    {
      module: "quotations",
      title: "Quotations",
      primary: `${count("quotations", (r) => r.status === "Sent")} awaiting response`,
      alert: count("quotations", (r) => r.status === "Sent" && idleDays(r, today) >= 7),
      alertLabel: "no reply 7+ days",
    },
  ];

  return (
    <section className="panel e-operations">
      <div className="panel-heading"><h2 className="e-section-title">Operations</h2></div>
      <div className="e-operations-grid">
        {blocks.map((block) => (
          <Button
            key={block.module}
            className="e-operation"
            onClick={() => onGo(block.module)}
            aria-label={`${block.title}: ${block.primary}${block.alert ? `, ${block.alert} ${block.alertLabel}` : ""}`}
          >
            <span className="e-operation-title">{block.title}</span>
            <span className="e-operation-primary">{block.primary}</span>
            <span className={`e-operation-alert${block.alert ? " is-alert" : ""}`}>
              {block.alert ? `${block.alert} ${block.alertLabel}` : "nothing flagged"}
            </span>
          </Button>
        ))}
      </div>
    </section>
  );
}

export { formatMoneyCompact };
