"use client";
import { companyName } from "@/lib/company-name";
import { useState } from "react";
import { InsightChart } from "./insight-chart";
import {
  BarChart3,
  ArrowUpRight,
  Package,
  Users,
  TrendingUp,
} from "lucide-react";
import { Button, Field, Select } from "./ui/controls";
import { dashboardInsights, type Ranking } from "@/lib/dashboard-insights";
import { money, type Actor, type RecordItem } from "@/lib/domain";

function RankingPanel({
  title,
  subtitle,
  rows,
  currency,
  demand = false,
  chart = true,
}: {
  title: string;
  subtitle: string;
  rows: Ranking[];
  currency: string;
  demand?: boolean;
  chart?: boolean;
}) {
  return (
    <section className="panel insight-ranking">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {demand ? <TrendingUp size={18} /> : <Package size={18} />}
      </div>
      {rows.length ? (
        <>
          {chart && (
            <InsightChart
              rows={rows}
              currency={currency}
              metric={demand ? "count" : "value"}
              variant={demand ? "columns" : "donut"}
            />
          )}
          {(!chart || rows.slice(0,4).filter(r => (demand ? r.count : r.value) > 0).length < 2) && <ol>
            {rows.slice(0, 4).map((r, i) => (
              <li key={r.name}>
                <span className="rank-number">{i + 1}</span>
                <div className="rank-content">
                  <div>
                    <strong>{r.name}</strong>
                    <b>
                      {demand
                        ? `${r.count} ${r.count === 1 ? "enquiry" : "enquiries"}`
                        : money(r.value, currency)}
                    </b>
                  </div>
                  <small>
                    {demand
                      ? `${money(r.value, currency)} potential value`
                      : `${r.count} order${r.count === 1 ? "" : "s"}`}
                  </small>
                </div>
              </li>
            ))}
          </ol>}
        </>
      ) : (
        <p className="insight-empty">No matching records yet.</p>
      )}
    </section>
  );
}
export default function DashboardInsights({
  actor,
  records,
  onSelect,
}: {
  actor: Actor;
  records: RecordItem[];
  onSelect: (r: RecordItem) => void;
}) {
  const currencies = [...new Set(records.map((r) => r.currency))].sort();
  const [selected, setSelected] = useState("USD");
  const currency = currencies.includes(selected)
    ? selected
    : currencies[0] || "USD";
  const data = dashboardInsights(actor, records, currency, 0);
  const top = data.orders[0],
    low = data.orders.at(-1);
  return (
    <section
      className="business-insights"
      aria-label="Sales and demand insights"
    >
      <div className="insights-heading">
        <div>
          <span className="eyebrow">SALES & DEMAND</span>
          <h2>Your business, explained</h2>
          <p>
            Rankings from accessible records. Choose one currency to compare
            fairly.
          </p>
        </div>
        <div className="insight-filters">
          <Field>
            <Select
              aria-label="Insights currency"
              value={currency}
              onChange={(e) => setSelected(e.target.value)}
            >
              {(currencies.length ? currencies : ["USD"]).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
      <div className="insight-summary">
        <BarChart3 size={22} />
        <p>
          {data.orders.length ? (
            <>
              <strong>{money(data.orderValue, currency)}</strong> across{" "}
              <strong>{data.orders.length} orders</strong>.{" "}
              {data.sold[0] && (
                <>
                  <strong>{data.sold[0].name}</strong> leads product sales.{" "}
                </>
              )}
              {data.demand[0] && (
                <>
                  Most open enquiries: <strong>{data.demand[0].name}</strong>.
                </>
              )}
            </>
          ) : (
            "No confirmed orders in this scope and period. Rankings appear as orders are recorded."
          )}
        </p>
      </div>
      <div className="commercial-scorecard">
        <div>
          <span>Sales win rate</span>
          <strong>{data.winRate === null ? "—" : `${data.winRate}%`}</strong>
          <small>Won ÷ won and lost leads</small>
        </div>
        <div>
          <span>Lost opportunities</span>
          <strong>{data.lostCount}</strong>
          <small>{money(data.lostValue, currency)} potential value lost</small>
        </div>
        <div>
          <span>Cancelled orders</span>
          <strong>{data.cancelled}</strong>
          <small>Excluded from sales rankings</small>
        </div>
      </div>
      <div className="insight-grid">
        <section className="panel country-sales">
          <div className="panel-heading">
            <div>
              <h2>Products selling by country</h2>
              <p>
                Confirmed order value by destination country · same currency and
                period filters
              </p>
            </div>
          </div>
          {data.countries.length ? (
            <div className="country-sales-grid">
              {data.countries.map((c) => (
                <section key={c.name}>
                  <header>
                    <h3>{c.name}</h3>
                    <b>{money(c.value, currency)}</b>
                  </header>
                  <p>
                    {c.count} {c.count === 1 ? "order" : "orders"}
                  </p>
                  <ol>
                    {c.products.slice(0, 3).map((p) => (
                      <li key={p.name}>
                        <span>{p.name}</span>
                        <strong>{money(p.value, currency)}</strong>
                      </li>
                    ))}
                  </ol>
                  {!c.products.length && <p>Product details not supplied.</p>}
                </section>
              ))}
            </div>
          ) : (
            <p className="insight-empty">
              No destination countries recorded for these orders yet. Add the
              destination country when preparing a quotation; it carries through
              to the sales order.
            </p>
          )}
          {data.missingCountry > 0 && (
            <p className="insight-empty">
              {data.missingCountry}{" "}
              {data.missingCountry === 1 ? "order is" : "orders are"} excluded
              from country rankings because the destination country is missing.
              Port names are not guessed.
            </p>
          )}
        </section>
        <div className="insight-stack">
        <RankingPanel
          title="Best-selling products"
          subtitle="Highest confirmed order value"
          rows={data.sold}
          currency={currency}
        />
        <RankingPanel
          title="Lowest-selling products"
          chart={false}
          subtitle="Lowest order value among products with sales"
          rows={data.lowest}
          currency={currency}
        />
        <section className="panel insight-ranking">
          <div className="panel-heading">
            <div>
              <h2>Sales contribution</h2>
              <p>Ranked by order value attributed to record owner</p>
            </div>
            <Users size={18} />
          </div>
          {data.people.length ? (
            <>
              <InsightChart rows={data.people} currency={currency} />
              <ol>
                {data.people.slice(0, 4).map((p, i) => (
                  <li key={p.name + i}>
                    <span className="rank-number">{i + 1}</span>
                    <div className="rank-content">
                      <div>
                        <strong>{p.name}</strong>
                        <b>{money(p.value, currency)}</b>
                      </div>
                      <small>
                        {p.count} orders · not an employee performance rating
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="insight-empty">No attributed orders yet.</p>
          )}
        </section>
        </div>
        <div className="insight-stack">
        <RankingPanel
          title="Products needing follow-up"
          subtitle="Most open enquiries · a demand signal, not stock need"
          rows={data.demand}
          currency={currency}
          demand
        />
        <section className="panel order-extremes">
          <div className="panel-heading">
            <div>
              <h2>Order highlights</h2>
              <p>Largest and smallest non-cancelled orders</p>
            </div>
            <ArrowUpRight size={18} />
          </div>
          {top && low ? (
            [
              ["Highest order", top],
              ["Lowest order", low],
            ].map(([label, record]) => {
              const r = record as RecordItem;
              return (
                <Button
                  key={label as string}
                  className="order-highlight"
                  onClick={() => onSelect(r)}
                >
                  <span>
                    <small>{label as string}</small>
                    <strong>{r.title}</strong>
                    <small>
                      {companyName(r.company)} · {r.id}
                    </small>
                  </span>
                  <b>{money(r.amount, currency)}</b>
                  <ArrowUpRight size={15} />
                </Button>
              );
            })
          ) : (
            <p className="insight-empty">No orders available in this view.</p>
          )}
        </section>
        </div>
      </div>
      <p className="insight-footnote">
        {data.missingDemand > 0 && (
          <>
            <strong>
              {data.missingDemand} open enquiries need product details
            </strong>{" "}
            and are excluded from product demand rankings.{" "}
          </>
        )}
        {data.unclassifiedSales > 0 && (
          <>
            {money(data.unclassifiedSales, currency)} in sales has no product
            classification and is excluded from product rankings.{" "}
          </>
        )}
        Period uses record creation date. Sales means confirmed order value, not
        collected revenue. Product lines use their descriptions and line totals;
        older records use their product field. Rankings exclude other
        currencies. Stock shortages and profit require inventory and cost data.
      </p>
    </section>
  );
}
