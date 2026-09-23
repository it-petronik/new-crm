"use client";
import { useState, useId, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, SearchX, SlidersHorizontal, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { Button, Select, Input } from "./ui/controls";
import { emptyQuery, queryList, listStatus, mixedCurrencies, sortDirection, nextSort, type ListQuery } from "@/lib/list-query";
import { pageWindow } from "@/lib/pagination";

export function usePagination<T extends { id: string }>(
  items: T[],
  filterKey = "",
) {
  const [size, setSize] = useState(10);
  const [query, setQuery] = useState(emptyQuery);
  const source = items;
  // The complete permitted set is filtered and sorted before any page is cut.
  items = queryList(items, query);
  const [state, setState] = useState({ key: "", page: 1 });
  // Changing a filter, sort or scope restarts at page one; a changed result
  // count is clamped by pageWindow so editing a record does not lose your page.
  const key = `${filterKey}|${size}|${JSON.stringify(query)}`;
  const window = pageWindow(
    items.length,
    state.key === key ? state.page : 1,
    size,
  );
  return {
    query, setQuery,
    statuses: [...new Set(source.map(listStatus).filter(Boolean))].sort(),
    valued: source.some(item => "amount" in item),
    mixedCurrency: mixedCurrencies(source),
    sourceTotal: source.length,
    filtered: JSON.stringify(query) !== JSON.stringify(emptyQuery),
    ...window,
    items: items.slice(window.start, window.end),
    onPage: (page: number) => setState({ key, page }),
    onSize: (value: number) => {
      setSize(value);
      setState({ key: "", page: 1 });
    },
  };
}

type ListControls = ReturnType<typeof usePagination> & { label?: string };

/**
 * Rendered directly above its list so the visual and keyboard order match.
 * Secondary filters sit behind one toggle to keep the bar compact; tables sort
 * from their column headers instead of a dropdown. These belong to business
 * lists only, never to printable document line items.
 */
export const sortChoices = {
  name: { value: "name", label: "Name A\u2013Z" },
  nameDesc: { value: "name-desc", label: "Name Z\u2013A" },
  newest: { value: "col:date:desc", label: "Newest first" },
  oldest: { value: "col:date:asc", label: "Oldest first" },
  amountDesc: { value: "amount-desc", label: "Amount high\u2013low" },
  amountAsc: { value: "amount", label: "Amount low\u2013high" },
} as const;
type SortChoice = { value: string; label: string };

export function ListFilters({
  query, setQuery, statuses, valued, mixedCurrency, sourceTotal, label = "results", sortable = true,
  sortOptions,
}: ListControls & { sortable?: boolean; sortOptions?: SortChoice[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // Sorting is an ordering, not a filter, so it never counts towards the badge.
  const active = query.status !== "all" ? 1 : 0;
  // Nothing to search or filter when the list has no records at all.
  if (!sourceTotal) return null;
  const sorts: SortChoice[] = sortOptions || [
    sortChoices.name, sortChoices.nameDesc, sortChoices.newest, sortChoices.oldest,
    ...(valued ? [sortChoices.amountDesc, sortChoices.amountAsc] : []),
  ];
  return (
    <div className="list-query-controls" role="search" aria-label={`Filter and sort ${label}`}>
      <Input className="list-query-search" aria-label={`Search ${label}`} placeholder={`Search ${label}…`} value={query.search} onChange={e=>setQuery({...query,search:e.target.value})}/>
      <Button
        className={`secondary list-query-toggle${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={()=>setOpen(!open)}
      >
        <SlidersHorizontal size={15} aria-hidden="true" />
        Filters
        {active > 0 && <span className="list-query-count" aria-label={`${active} active`}>{active}</span>}
      </Button>
      {(active > 0 || query.search) && <Button className="secondary list-query-reset" onClick={()=>{setQuery(emptyQuery);}}>Reset</Button>}
      <div id={panelId} className="list-query-panel" hidden={!open}>
        {statuses.length > 0 && <label>Status
          <Select aria-label={`${label} status`} value={query.status} onChange={e=>setQuery({...query,status:e.target.value})}><option value="all">All statuses</option>{statuses.map(s=><option key={s}>{s}</option>)}</Select>
        </label>}
        {sortable && sorts.length > 0 && <label>Sort by
          <Select aria-label={`Sort ${label}`} value={query.sort} onChange={e=>setQuery({...query,sort:e.target.value})}>
            <option value="default">Default order</option>
            {sorts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </label>}
        {!sortable && <p className="list-query-message">Select a column heading to sort this table.</p>}
        {mixedCurrency && query.sort.includes("amount") && <p className="list-query-message" role="status">Amounts are grouped by currency; values in different currencies are not converted or ranked against each other.</p>}
      </div>
    </div>
  );
}

/** A table heading that sorts its column. Keeps aria-sort in step with the query. */
export function SortHeader({
  children, sortKey, query, setQuery, className,
}: {
  children: ReactNode;
  sortKey: string;
  query: ListQuery;
  setQuery: (q: ListQuery) => void;
  className?: string;
}) {
  const direction = sortDirection(query.sort, sortKey);
  return (
    <th className={className} aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}>
      <button type="button" className="column-sort" onClick={() => setQuery({ ...query, sort: nextSort(query.sort, sortKey) })}>
        {children}
        {direction === "asc" ? <ArrowUp size={13} aria-hidden="true" /> : direction === "desc" ? <ArrowDown size={13} aria-hidden="true" /> : <ChevronsUpDown size={13} className="column-sort-idle" aria-hidden="true" />}
      </button>
    </th>
  );
}

/** Shown in place of an empty list so a filtered-out view is never a blank panel. */
export function ListEmpty({ total, sourceTotal, filtered, setQuery, label = "results" }: ListControls) {
  if (total > 0) return null;
  return (
    <div className="list-empty" role="status">
      <SearchX size={22} aria-hidden="true" />
      {filtered && sourceTotal > 0 ? (
        <>
          <p>No {label} match the current filters.</p>
          <Button className="secondary" onClick={() => setQuery(emptyQuery)}>Reset filters</Button>
        </>
      ) : (
        <p>No {label} to show yet.</p>
      )}
    </div>
  );
}

export function Pagination({
  page,
  pages,
  start,
  end,
  total,
  pageSize,
  onPage,
  onSize,
  label = "results",
}: ListControls) {
  if (!total) return null;
  return (
    <nav className="pagination" aria-label={`${label} pagination`}>
      <span role="status">
        {`${start + 1}–${end}`} of {total} {label}
      </span>
      <div className="pagination-controls">
        <Select
          aria-label={`${label} per page`}
          value={String(pageSize)}
          onChange={(e) => onSize(Number(e.target.value))}
        >
          {[10, 20, 50].map((n) => (
            <option key={n} value={n}>
              {n} per page
            </option>
          ))}
        </Select>
        <Button
          className="secondary"
          aria-label={`Previous ${label} page`}
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </Button>
        <span className="page-number">
          {page} / {pages}
        </span>
        <Button
          className="secondary"
          aria-label={`Next ${label} page`}
          disabled={page === pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </nav>
  );
}
