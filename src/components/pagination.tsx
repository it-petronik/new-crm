"use client";
import { useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  SearchX,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  Download,
  Upload,
} from "lucide-react";
import { Button, Select, Input } from "./ui/controls";
import {
  emptyQuery,
  queryList,
  listStatus,
  mixedCurrencies,
  sortDirection,
  nextSort,
  type ListQuery,
} from "@/lib/list-query";
import { pageWindow } from "@/lib/pagination";
import { Toolbar } from "./ui/layout";
import { useTableExport } from "./table-export";

export function usePagination<T extends { id: string }>(
  items: T[],
  filterKey = "",
  /** Held by the parent when two views of one list share their filters. */
  shared?: { query: ListQuery; setQuery: (query: ListQuery) => void },
) {
  const [size, setSize] = useState(10);
  const [ownQuery, setOwnQuery] = useState(emptyQuery);
  const query = shared?.query ?? ownQuery;
  const setQuery = shared?.setQuery ?? setOwnQuery;
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
    query,
    setQuery,
    statuses: [...new Set(source.map(listStatus).filter(Boolean))].sort(),
    valued: source.some((item) => "amount" in item),
    mixedCurrency: mixedCurrencies(source),
    sourceTotal: source.length,
    filtered: JSON.stringify(query) !== JSON.stringify(emptyQuery),
    ...window,
    items: items.slice(window.start, window.end),
    // Everything matching the current filters, not just the visible page.
    // Export uses this so the file reflects the filtered list rather than
    // whichever page happens to be open.
    matched: items,
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
 * Status is a single visible choice; import and export stay visible.
 * Tables sort only from their column headers. These belong to business
 * lists only, never to printable document line items.
 */
export function ListFilters({
  query,
  setQuery,
  statuses,
  valued,
  mixedCurrency,
  sourceTotal,
  matched,
  label = "results",
  onExport,
  exportCount,
  onImport,
  trailing,
}: ListControls & {
  /** Page-level controls that belong on the same row, e.g. the view toggle. */
  trailing?: ReactNode;
  /** Ordering is handled by SortHeader, not a second dropdown. */
  sortable?: false;
  /** Exports the rows currently matching the filters; omitted where export makes no sense. */
  onExport?: () => void;
  exportCount?: number;
  /** Opens the CSV import dialog; omitted for modules that cannot be imported. */
  onImport?: () => void;
}) {
  const exporter = useTableExport();
  // Sorting is an ordering, not a status filter; Reset still restores both.
  const active = query.status !== "all" ? 1 : 0;
  // Nothing to search or filter when the list has no records at all.
  if (!sourceTotal)
    return onImport ? (
      <Toolbar className="list-query-controls">
        <Button variant="secondary" size="small" onClick={onImport}>
          <Upload size={15} />
          Import
        </Button>
      </Toolbar>
    ) : null;
  return (
    <Toolbar
      className="list-query-controls list-query-compact-tools"
      role="search"
      aria-label={`Filter and sort ${label}`}
    >
      <Input
        className="list-query-search"
        aria-label={`Search ${label}`}
        placeholder={`Search ${label}…`}
        value={query.search}
        onChange={(e) => setQuery({ ...query, search: e.target.value })}
      />
      {statuses.length > 0 && (
        <Select
          aria-label={`${label} status`}
          value={query.status}
          onChange={(event) =>
            setQuery({ ...query, status: event.target.value })
          }
        >
          <option value="all">All statuses</option>
          {statuses.map((status) => (
            <option key={status}>{status}</option>
          ))}
        </Select>
      )}
      {trailing && <div className="list-query-trailing">{trailing}</div>}
      <div className="list-file-actions">
        {(active > 0 || query.search || query.sort !== "default") && (
          <Button
            variant="ghost"
            size="small"
            onClick={() => setQuery(emptyQuery)}
          >
            Reset
          </Button>
        )}
        {onImport && (
          <Button variant="secondary" size="small" onClick={onImport}>
            <Upload size={15} />
            Import
          </Button>
        )}
        {exporter.available && (
          <Button
            variant="secondary"
            size="small"
            disabled={!matched.length}
            onClick={() => exporter.run(matched, label)}
            aria-label={`Export ${label} to Excel`}
          >
            <Download size={15} />
            Export Excel
          </Button>
        )}
      </div>
      {mixedCurrency && query.sort.includes("amount") && (
        <p className="list-query-message" role="status">
          Amounts are grouped by currency; values in different currencies are
          not converted or ranked against each other.
        </p>
      )}
    </Toolbar>
  );
}

/** A table heading that sorts its column. Keeps aria-sort in step with the query. */
export function SortHeader({
  children,
  sortKey,
  query,
  setQuery,
  className,
}: {
  children: ReactNode;
  sortKey: string;
  query: ListQuery;
  setQuery: (q: ListQuery) => void;
  className?: string;
}) {
  const direction = sortDirection(query.sort, sortKey);
  return (
    <th
      className={className}
      aria-sort={
        direction === "asc"
          ? "ascending"
          : direction === "desc"
            ? "descending"
            : "none"
      }
    >
      <button
        type="button"
        className="column-sort"
        onClick={() =>
          setQuery({ ...query, sort: nextSort(query.sort, sortKey) })
        }
      >
        {children}
        {direction === "asc" ? (
          <ArrowUp size={13} aria-hidden="true" />
        ) : direction === "desc" ? (
          <ArrowDown size={13} aria-hidden="true" />
        ) : (
          <ChevronsUpDown
            size={13}
            className="column-sort-idle"
            aria-hidden="true"
          />
        )}
      </button>
    </th>
  );
}

/** Shown in place of an empty list so a filtered-out view is never a blank panel. */
export function ListEmpty({
  total,
  sourceTotal,
  filtered,
  setQuery,
  label = "results",
  empty,
}: ListControls & { empty?: ReactNode }) {
  if (total > 0) return null;
  return (
    <div className="list-empty" role="status">
      <SearchX size={22} aria-hidden="true" />
      {filtered && sourceTotal > 0 ? (
        <>
          <p>No {label} match the current filters.</p>
          <Button className="secondary" onClick={() => setQuery(emptyQuery)}>
            Reset filters
          </Button>
        </>
      ) : (
        (empty ?? <p>No {label} to show yet.</p>)
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
