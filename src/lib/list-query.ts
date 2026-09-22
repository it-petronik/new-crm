export type ListQuery = { search:string; status:string; sort:string };
export const emptyQuery: ListQuery = { search:"",status:"all",sort:"default" };
/** The date a record is ordered by when a list sorts newest or oldest first. */
export function listDate(item: object) { const r = item as Record<string,unknown>; return String(r.createdAt || r.at || r.due || "").slice(0,10); }
export function listStatus(item: object) { const r = item as Record<string,unknown>; return String(r.status || (typeof r.active === "boolean" ? r.active ? "Active":"Inactive" : "")); }

/** Bookkeeping fields that carry no meaning for a person searching a list. */
const unsearchableKeys = new Set(["deletedAt","version","parentId","quotationId"]);

/**
 * Searches stored values only. Matching the raw JSON also matched field names,
 * so "status" or "company" used to return every record.
 */
export function searchText(item: object): string {
  const parts: string[] = [];
  const walk = (value: unknown) => {
    if (value === null || value === undefined || typeof value === "boolean") return;
    if (typeof value === "string" || typeof value === "number") { parts.push(String(value)); return; }
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (typeof value === "object")
      for (const [key, nested] of Object.entries(value as Record<string,unknown>))
        if (!unsearchableKeys.has(key)) walk(nested);
  };
  walk(item);
  return parts.join(" ").toLowerCase();
}

export function queryList<T extends object>(items:T[], query:ListQuery):T[] {
  const term = query.search.trim().toLowerCase();
  const result = items.filter(item =>
    (!term || searchText(item).includes(term)) && (query.status === "all" || listStatus(item) === query.status));
  const comparator = sortComparator(query.sort);
  if (comparator) result.sort(comparator);
  return result;
}

export type SortDirection = "asc" | "desc";
/** A column sort is stored as `col:<key>:<asc|desc>`. */
export function columnSort(key: string, direction: SortDirection) { return `col:${key}:${direction}`; }
/** Reads the active direction for one column, or "" when it is not the sorted column. */
export function sortDirection(sort: string, key: string): SortDirection | "" {
  const spec = parseSort(sort);
  return spec && spec.key === key ? spec.direction : "";
}
/** Click order for a header: ascending, then descending, then back to default. */
export function nextSort(sort: string, key: string) {
  const current = sortDirection(sort, key);
  return current === "" ? columnSort(key, "asc") : current === "asc" ? columnSort(key, "desc") : "default";
}

// The dropdown used by card views writes the same specs as a column header.
const namedSorts: Record<string,string> = {
  name: "col:name:asc", "name-desc": "col:name:desc",
  newest: "col:date:desc", oldest: "col:date:asc",
  amount: "col:amount:asc", "amount-desc": "col:amount:desc",
};
function parseSort(sort: string): { key: string; direction: SortDirection } | null {
  const spec = namedSorts[sort] || sort;
  if (!spec.startsWith("col:")) return null;
  const [, key, direction] = spec.split(":");
  return key && (direction === "asc" || direction === "desc") ? { key, direction } : null;
}

function sortValue(item: object, key: string): string | number {
  const r = item as Record<string,unknown>;
  if (key === "name") return String(r.title || r.name || r.actor || "");
  if (key === "date") return listDate(item);
  const value = r[key];
  return typeof value === "number" ? value : String(value ?? "");
}

export function sortComparator<T extends object>(sort: string) {
  const spec = parseSort(sort);
  if (!spec) return null;
  const sign = spec.direction === "asc" ? 1 : -1;
  return (a: T, b: T) => {
    // Amounts in different currencies are not comparable, so each currency is
    // ranked as its own block instead of being interleaved by raw number.
    if (spec.key === "amount") {
      const ca = String((a as Record<string,unknown>).currency || ""), cb = String((b as Record<string,unknown>).currency || "");
      if (ca !== cb) return ca.localeCompare(cb);
    }
    const va = sortValue(a, spec.key), vb = sortValue(b, spec.key);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * sign;
    return String(va).localeCompare(String(vb)) * sign;
  };
}

/** True when more than one currency is present, so amount ordering needs explaining. */
export function mixedCurrencies(items: object[]) {
  return new Set(items.map(i => String((i as Record<string,unknown>).currency || "")).filter(Boolean)).size > 1;
}
