"use client";
import { useId } from "react";
import type { Actor, RecordItem } from "@/lib/domain";
import { dashboardTrend } from "@/lib/dashboard-trend";
import styles from "./metric-trend.module.css";

/** A depth-styled sparkline inside an existing KPI, never another card.
 * Counts creation activity, not revenue or a forecast. */
export function MetricTrend({ actor, records }: { actor: Actor; records: RecordItem[] }) {
  const id = useId().replaceAll(":", "");
  const points = dashboardTrend(actor, records);
  if (!points.length) return null;
  const max = Math.max(1, ...points.map(p => p.count));
  const coordinates = points.map((p, i) => [5 + i * 16, 29 - p.count / max * 22]);
  const path = coordinates.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  return <svg className={styles.spark} viewBox="0 0 92 42" role="img" aria-label="Six-month record creation trend">
    <title>{points.map(p => `${p.label}: ${p.count} loaded records`).join("; ")}. Counts, not revenue.</title>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".20"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
    <path d={`${path} L85,38 L5,38 Z`} fill={`url(#${id})`} />
    <path d={path} className={styles.depth} transform="translate(0 3)" />
    <path d={path} className={styles.line} pathLength="1" />
    <circle cx={coordinates[5][0]} cy={coordinates[5][1]} r="3" className={styles.endpoint} />
  </svg>;
}
