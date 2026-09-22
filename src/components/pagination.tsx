"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import { Button, Select, Input } from "./ui/controls";
import { emptyQuery, queryList, listStatus, listDate, rangeReversed, mixedCurrencies, type DateOf } from "@/lib/list-query";
import { pageWindow } from "@/lib/pagination";

export function usePagination<T extends { id: string }>(
  items: T[],
  filterKey = "",
  options: { dateOf?: DateOf; dateLabel?: string } = {},
) {
  const dateOf = options.dateOf || listDate;
  const [size, setSize] = useState(10);
  const [query, setQuery] = useState(emptyQuery);
  const source = items;
  // The complete permitted set is filtered and sorted before any page is cut.
  items = queryList(items, query, dateOf);
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
    dated: source.some(item => Boolean(dateOf(item))),
    dateLabel: options.dateLabel || "record date",
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
 * These belong to business lists only, never to printable document line items.
 */
export function ListFilters({
  query, setQuery, statuses, dated, valued, mixedCurrency, dateLabel, label = "results",
}: ListControls) {
  const reversed = rangeReversed(query);
  const dateField = dateLabel;
  return (
    <div className="list-query-controls" role="search" aria-label={`Filter and sort ${label}`}>
      <label>Search
        <Input aria-label={`Search ${label}`} placeholder={`Search ${label}…`} value={query.search} onChange={e=>setQuery({...query,search:e.target.value})}/>
      </label>
      {statuses.length > 0 && <label>Status
        <Select aria-label={`${label} status`} value={query.status} onChange={e=>setQuery({...query,status:e.target.value})}><option value="all">All statuses</option>{statuses.map(s=><option key={s}>{s}</option>)}</Select>
      </label>}
      <label>Sort by
        <Select aria-label={`Sort ${label}`} value={query.sort} onChange={e=>setQuery({...query,sort:e.target.value})}><option value="default">Default order</option><option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option>{dated && <option value="newest">Newest first</option>}{dated && <option value="oldest">Oldest first</option>}{valued && <option value="amount-desc">Amount high–low</option>}{valued && <option value="amount">Amount low–high</option>}</Select>
      </label>
      {dated && <label>{`From (${dateField})`}
        <Input type="date" aria-label={`${label} from ${dateField}`} value={query.from} onChange={e=>setQuery({...query,from:e.target.value})}/>
      </label>}
      {dated && <label>{`To (${dateField})`}
        <Input type="date" aria-label={`${label} to ${dateField}`} value={query.to} onChange={e=>setQuery({...query,to:e.target.value})}/>
      </label>}
      <Button className="secondary list-query-reset" onClick={()=>setQuery(emptyQuery)}>Reset filters</Button>
      {reversed && <p className="list-query-message" role="alert">The end {dateField} is before the start {dateField}, so no {label} can match. Adjust either date or reset the filters.</p>}
      {!reversed && mixedCurrency && query.sort.startsWith("amount") && <p className="list-query-message" role="status">Amounts are grouped by currency; values in different currencies are not converted or ranked against each other.</p>}
    </div>
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
