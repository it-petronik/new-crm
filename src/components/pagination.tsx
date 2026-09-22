"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Select, Input } from "./ui/controls";
import { emptyQuery, queryList, listStatus, listDate } from "@/lib/list-query";
import { pageWindow } from "@/lib/pagination";

export function usePagination<T extends { id: string }>(
  items: T[],
  filterKey = "",
) {
  const [size, setSize] = useState(10);
  const [query, setQuery] = useState(emptyQuery);
  const source = items;
  items = queryList(items, query);
  const [state, setState] = useState({ key: "", page: 1 });
  const key = `${filterKey}|${items.map((i) => i.id).join("|")}`;
  const window = pageWindow(
    items.length,
    state.key === key ? state.page : 1,
    size,
  );
  return {
    query, setQuery,
    statuses: [...new Set(source.map(listStatus).filter(Boolean))],
    dated: source.some(item => Boolean(listDate(item))),
    valued: source.some(item => "amount" in item),
    ...window,
    items: items.slice(window.start, window.end),
    onPage: (page: number) => setState({ key, page }),
    onSize: (value: number) => {
      setSize(value);
      setState({ key, page: 1 });
    },
  };
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
  query, setQuery, statuses, dated, valued,
}: ReturnType<typeof usePagination> & { label?: string }) {
  return (
    <div className="collection-controls">
    <div className="list-query-controls" aria-label={`${label} filters and sorting`}>
      <Input aria-label={`Search ${label}`} placeholder={`Search ${label}…`} value={query.search} onChange={e=>setQuery({...query,search:e.target.value})}/>
      {statuses.length > 0 && <Select aria-label={`${label} status`} value={query.status} onChange={e=>setQuery({...query,status:e.target.value})}><option value="all">All statuses</option>{statuses.map(s=><option key={s}>{s}</option>)}</Select>}
      <Select aria-label={`Sort ${label}`} value={query.sort} onChange={e=>setQuery({...query,sort:e.target.value})}><option value="default">Default order</option><option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option>{dated && <option value="newest">Newest first</option>}{dated && <option value="oldest">Oldest first</option>}{valued && <option value="amount-desc">Amount high–low</option>}{valued && <option value="amount">Amount low–high</option>}</Select>
      {dated && <><label>Record date from<Input type="date" aria-label={`${label} from date`} value={query.from} onChange={e=>setQuery({...query,from:e.target.value})}/></label><label>To<Input type="date" aria-label={`${label} to date`} value={query.to} min={query.from} onChange={e=>setQuery({...query,to:e.target.value})}/></label></>}
      <Button className="secondary" onClick={()=>setQuery(emptyQuery)}>Reset filters</Button>
    </div>
    {query.from && query.to && query.from > query.to && <p role="alert">Start date must be before end date.</p>}
    <nav className="pagination" aria-label={`${label} pagination`}>
      <span role="status">
        {total ? `${start + 1}–${end}` : "0"} of {total} {label}
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
    </div>
  );
}
