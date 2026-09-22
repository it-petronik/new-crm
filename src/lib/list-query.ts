export type ListQuery = { search:string; status:string; sort:string; from:string; to:string };
export const emptyQuery: ListQuery = { search:"",status:"all",sort:"default",from:"",to:"" };
export type DateOf = (item: object) => string;
export function listDate(item: object) { const r = item as Record<string,unknown>; return String(r.createdAt || r.at || r.due || "").slice(0,10); }
/** Lets a list filter on the date it actually shows, e.g. a cashbook transaction date. */
export function dateField(key: string): DateOf { return item => String((item as Record<string,unknown>)[key] || "").slice(0,10); }
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

/** A reversed range selects nothing rather than silently ignoring a bound. */
export function rangeReversed(query: Pick<ListQuery,"from"|"to">) {
  return Boolean(query.from && query.to && query.from > query.to);
}

export function queryList<T extends object>(items:T[], query:ListQuery, dateOf:DateOf = listDate):T[] {
  if (rangeReversed(query)) return [];
  const term = query.search.trim().toLowerCase();
  const result = items.filter(item => {
    const date = dateOf(item);
    return (!term || searchText(item).includes(term)) && (query.status === "all" || listStatus(item) === query.status) && (!query.from || (!!date && date >= query.from)) && (!query.to || (!!date && date <= query.to));
  });
  const name = (r:T) => {const v=r as Record<string,unknown>;return String(v.title || v.name || v.actor || "");};
  const amount = (r:T) => Number((r as Record<string,unknown>).amount || 0);
  const currency = (r:T) => String((r as Record<string,unknown>).currency || "");
  if(query.sort === "name") result.sort((a,b)=>name(a).localeCompare(name(b)));
  if(query.sort === "name-desc") result.sort((a,b)=>name(b).localeCompare(name(a)));
  if(query.sort === "newest") result.sort((a,b)=>dateOf(b).localeCompare(dateOf(a)));
  if(query.sort === "oldest") result.sort((a,b)=>dateOf(a).localeCompare(dateOf(b)));
  // Amounts in different currencies are not comparable, so each currency is
  // ranked as its own block instead of being interleaved by raw number.
  if(query.sort === "amount" || query.sort === "amount-desc") result.sort((a,b)=>currency(a) === currency(b) ? (amount(a)-amount(b))*(query.sort === "amount" ? 1:-1) : currency(a).localeCompare(currency(b)));
  return result;
}

/** True when more than one currency is present, so amount ordering needs explaining. */
export function mixedCurrencies(items: object[]) {
  return new Set(items.map(i => String((i as Record<string,unknown>).currency || "")).filter(Boolean)).size > 1;
}
