import { canRead, type Actor, type RecordItem } from "./domain";
import { businessToday } from "./gst";

/** Counts only authorized records; never aggregates different currencies. */
export function dashboardTrend(actor: Actor, records: RecordItem[]) {
  const visible = records.filter(r => !r.deletedAt && canRead(actor, r) && Number.isFinite(Date.parse(r.createdAt)));
  if (!visible.length) return [];
  const byMonth = new Map<string, RecordItem[]>();
  for (const r of visible) {
    const month = businessToday(new Date(r.createdAt)).slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) || []), r]);
  }
  const latest = [...byMonth.keys()].sort().at(-1)!;
  const end = new Date(`${latest}-01T00:00:00Z`);
  return Array.from({ length: 6 }, (_, i) => {
    const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 5 + i, 1));
    const month = date.toISOString().slice(0, 7);
    const rows = byMonth.get(month) || [];
    return { month, label: new Intl.DateTimeFormat("en", { month: "short", year: "2-digit", timeZone: "UTC" }).format(date), count: rows.length, records: rows };
  });
}
