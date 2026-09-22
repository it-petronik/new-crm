"use client";
import { useState } from "react";
const colors = ["#2563eb", "#f59e0b", "#8b5cf6", "#14b8a6"];
export function InsightChart({ rows, metric = "value", variant = "donut", currency = "USD" }: {
  rows: { name: string; value: number; count: number }[];
  metric?: "value" | "count"; variant?: "donut" | "columns"; currency?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const visible = rows.slice(0, 4).filter(row => row[metric] > 0);
  const total = visible.reduce((sum, row) => sum + row[metric], 0);
  if (!total || visible.length < 2) return null;
  const format = (value: number, compact = false) => new Intl.NumberFormat("en-US", { style:"currency", currency, maximumFractionDigits:compact ? 1 : 0, notation:compact ? "compact" : "standard" }).format(value);
  const maximum = Math.max(...visible.map(row => row[metric]));
  const active = visible.find(row => row.name === selected);
  const detail = active && <div className="chart-selection" role="status"><strong>{active.name}</strong><span>{format(active.value)} · {active.count} {metric === "count" ? "enquiries" : "orders"} · {Math.round(active[metric] / total * 100)}% of displayed total</span><button aria-label="Clear chart selection" onClick={() => setSelected(null)}>×</button></div>;
  const select = (name:string) => setSelected(old => old === name ? null : name);
  if (variant === "columns") return <div className="insight-chart chart-horizontal" role="group" aria-label="Product enquiry comparison">
    {visible.map((row, i) => <button type="button" className="horizontal-chart-row chart-interactive" aria-pressed={selected === row.name} title={`${row.name}: ${row.count} enquiries · ${format(row.value)}`} onClick={() => select(row.name)} key={row.name}>
      <div className="horizontal-chart-label"><strong>{row.name}</strong><b>{row.count} {row.count === 1 ? "enquiry" : "enquiries"}</b></div>
      <div className="horizontal-chart-track"><span style={{width:`${row[metric] / maximum * 100}%`,background:colors[i]}} /></div>
      <small>{format(row.value)} potential value</small>
    </button>)}
    {detail}
    <p className="chart-note">Open enquiries · bars start at zero</p>
  </div>;
  let offset = 0;
  return <div className="insight-chart chart-donut">
    <svg viewBox="0 0 200 200" role="group" aria-label="Interactive order value chart">
      <circle cx="100" cy="100" r="78" fill="none" stroke="var(--line)" strokeWidth="23" />
      {visible.map((row, i) => {
        const portion = row[metric] / total * 100, start = offset; offset += portion;
        return <circle className="chart-segment" role="button" tabIndex={0} aria-label={`${row.name}: ${format(row.value)}, ${Math.round(portion)}%`} aria-pressed={selected === row.name} onClick={() => select(row.name)} onKeyDown={e => {if(e.key === "Enter" || e.key === " "){e.preventDefault();select(row.name);}}} key={row.name} cx="100" cy="100" r="78" fill="none" stroke={colors[i]} strokeWidth="23" pathLength="100" strokeDasharray={`${portion} ${100 - portion}`} strokeDashoffset={-start} transform="rotate(-90 100 100)"><title>{row.name}: {format(row.value)} ({Math.round(portion)}%)</title></circle>;
      })}
      <text x="100" y="98" textAnchor="middle" className="donut-total">{format(total, true)}</text>
      <text x="100" y="119" textAnchor="middle" className="donut-caption">Shown sales</text>
    </svg>
    <div className="donut-breakdown">{visible.map((row,i) => <button type="button" className="donut-legend-row chart-interactive" aria-pressed={selected === row.name} onClick={() => select(row.name)} key={row.name}>
      <i style={{background:colors[i]}} />
      <div><strong>{row.name}</strong><small>{row.count} {row.count === 1 ? "order" : "orders"} · {Math.round(row[metric] / total * 100)}%</small></div>
      <b>{format(row.value)}</b>
    </button>)}<p className="chart-note">Share of displayed order value · {currency} · Select to inspect</p>{detail}</div>
  </div>;
}
