"use client";
import { useEffect, useState, useRef, useId } from "react";
import {
  Search,
  Sparkles,
  SlidersHorizontal,
  Download,
  Bookmark,
  Users,
  Building2,
  X,
  FileText,
  Coins,
} from "lucide-react";
import type { Actor } from "@/lib/domain";
import { canProspect } from "@/lib/execution/model";
import {
  searchInput,
  type SearchInput,
  type ProspectPage,
} from "@/lib/prospecting/model";
import {
  decisionMakerCriteria,
  suggestedRoles,
} from "@/lib/prospecting/interpretation";
import { filters } from "@/lib/prospecting/filters";
import type {
  OperationView,
  ProspectRef,
  DatasetItem,
} from "@/lib/prospecting/operations-model";
import type { workspace } from "@/lib/prospecting/operations";
import type { importReview } from "@/lib/prospecting/store";
import type { bulkImportReview } from "@/lib/prospecting/imports";
import type { Report } from "@/lib/prospecting/export";
import { Button, Dialog, DialogActions, Input, Select } from "../ui/controls";
import { PageTitle } from "../workspace-pages";
import { phase7Call, Field } from "./execution-panel";
import { ProspectReview } from "./prospect-review";
import { CreditDialog, BulkImportDialog, ReportDialog } from "./apollo-dialogs";
import { openReference } from "@/lib/ai/client";
type Page = ProspectPage & { stageId: string; expiresAt: string };
type Workspace = Awaited<ReturnType<typeof workspace>>;
const call = async <T,>(c: Record<string, unknown>): Promise<T> => {
  const res = await fetch("/api/prospecting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(c),
  });
  const data = await res.json();
  if (!res.ok)
    throw Error(
      `${data.error || "Request failed."}${data.retryAfter ? ` Try again in at least ${Math.ceil(data.retryAfter)} seconds.` : ""}`,
    );
  return data;
};
export default function Prospecting({
  actor,
  preview = false,
  productId,
  keywords = "",
  initialCompany,
  initialBranch,
}: {
  actor: Actor;
  preview?: boolean;
  productId?: string;
  keywords?: string;
  initialCompany?: string;
  initialBranch?: string;
}) {
  const [query, setQuery] = useState(
    keywords ? `Find buyers for ${keywords}` : "",
  );
  const [interpreting, setInterpreting] = useState(false);
  const manualKeys = useRef(new Set<string>());
  const resultCache = useRef<
    Partial<Record<"company" | "person", { page: Page; rows: DatasetItem[] }>>
  >({});
  const queryInput = useRef<HTMLTextAreaElement>(null);
  const [contextProduct, setContextProduct] = useState(productId);
  const [company, setCompany] = useState(
      initialCompany || actor.companies[0] || "",
    ),
    [branch, setBranch] = useState(
      initialBranch || actor.branches[0] || "Main",
    );
  const [draft, setDraft] = useState<SearchInput>(() =>
      searchInput.parse({ kind: "company", keywords }),
    ),
    [page, setPage] = useState<Page | null>(null),
    [rows, setRows] = useState<DatasetItem[]>([]),
    [selection, setSelection] = useState<string[]>([]),
    [match, setMatch] = useState("all");
  const [meta, setMeta] = useState<Workspace | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [drawer, setDrawer] = useState(false),
    [tab, setTab] = useState<"results" | "saved" | "usage">("results"),
    [phones, setPhones] = useState(false);
  const [op, setOp] = useState<OperationView | null>(null),
    [review, setReview] = useState<
      (Awaited<ReturnType<typeof importReview>> & { stageId: string }) | null
    >(null),
    [bulk, setBulk] = useState<Awaited<
      ReturnType<typeof bulkImportReview>
    > | null>(null),
    [report, setReport] = useState<Report | null>(null),
    [save, setSave] = useState(false);
  const paused = useRef(false),
    trigger = useRef<HTMLElement | null>(null),
    prepIdentity = useRef<{ key: string; id: string } | null>(null),
    scopeVersion = useRef(0);
  const formId = useId();
  const currentScope = useRef({ company, branch });
  currentScope.current = { company, branch };
  const restoreFocus = () =>
    requestAnimationFrame(() => trigger.current?.focus());
  async function metadata() {
    if (preview) return;
    const scope = { company, branch };
    const data = await call<Workspace>({ action: "workspace", ...scope });
    if (
      currentScope.current.company === scope.company &&
      currentScope.current.branch === scope.branch
    )
      setMeta(data);
  }
  useEffect(() => {
    scopeVersion.current++;
    resultCache.current = {};
    setPage(null);
    setRows([]);
    setSelection([]);
    setMeta(null);
    setOp(null);
    setReview(null);
    setBulk(null);
    setReport(null);
    setError("");
    paused.current = true;
    void metadata().catch((e) => setError(e.message));
  }, [company, branch, preview]); // Only our database is read on entry.
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadPage(stageId: string) {
    const version = scopeVersion.current;
    let p = await call<Page>({ action: "page", stageId });
    let r = p.prospects.length
      ? await call<DatasetItem[]>({
          action: "dataset",
          refs: p.prospects.map((p) => ({ stageId, providerId: p.id })),
        })
      : [];
    if (version !== scopeVersion.current) return;
    const prior = resultCache.current[p.criteria.kind];
    if (
      p.enriched &&
      prior &&
      JSON.stringify(prior.page.criteria) === JSON.stringify(p.criteria)
    ) {
      const incoming = new Map(r.map((row) => [row.prospect.id, row]));
      const combined = [
        ...prior.rows.map((row) => incoming.get(row.prospect.id) || row),
        ...r.filter(
          (row) =>
            !prior.rows.some((old) => old.prospect.id === row.prospect.id),
        ),
      ];
      r = await call<DatasetItem[]>({
        action: "dataset",
        refs: combined.map((row) => row.ref),
      });
      p = {
        ...p,
        prospects: r.map((row) => row.prospect),
        page: prior.page.page,
        hasMore: prior.page.hasMore,
        total: prior.page.total,
        expiresAt: new Date(
          Math.min(Date.parse(p.expiresAt), Date.parse(prior.page.expiresAt)),
        ).toISOString(),
      };
    }
    if (version !== scopeVersion.current) return;
    resultCache.current[p.criteria.kind] = { page: p, rows: r };
    setDraft(p.criteria);
    if (p.criteria.discovery) setQuery(p.criteria.discovery.query);
    setPage(p);
    setRows(r);
    setSelection([]);
    setTab("results");
  }
  async function prepare(
    type: "search" | "enrich",
    criteria?: SearchInput,
    refs?: ProspectRef[],
  ) {
    const key = JSON.stringify({
      company,
      branch,
      type,
      criteria,
      refs,
      phones,
    });
    if (prepIdentity.current?.key !== key)
      prepIdentity.current = { key, id: crypto.randomUUID() };
    const next = await call<OperationView>({
      action: "prepare",
      requestId: prepIdentity.current.id,
      company,
      branch,
      type,
      criteria,
      refs,
      phones: type === "enrich" ? phones : false,
    });
    setOp(next);
    if (next.data.resultStageId) await loadPage(next.data.resultStageId);
    setDrawer(false);
    paused.current = false;
  }
  async function run() {
    if (!op) return;
    await task(async () => {
      paused.current = false;
      let next = op;
      do {
        next = await call<OperationView>({
          action: "advance",
          id: next.id,
          confirmed: true,
        });
        if (!paused.current) setOp(next);
        if (next.data.resultStageId) await loadPage(next.data.resultStageId);
        await metadata();
        if (["completed", "failed"].includes(next.status))
          prepIdentity.current = null;
        if (next.status !== "paused" || paused.current) break;
        await new Promise((r) => setTimeout(r, 3300));
      } while (!paused.current);
    });
  }
  function closeOperation() {
    paused.current = true;
    setOp(null);
    restoreFocus();
  }
  const refs = rows
    .filter((r) => selection.includes(r.prospect.id))
    .map((r) => r.ref);
  const targetRefs = refs.length ? refs : rows.map((r) => r.ref);
  const shown = rows.filter(
    (r) =>
      match === "all" ||
      (match === "existing" && r.match.startsWith("Existing")) ||
      (match === "new" && r.match === "No match in checked records") ||
      (match === "review" && r.match === "Possible Customer match"),
  );
  const getFilter = (key: string) =>
    ["keywords", "location", "domain", "titles"].includes(key)
      ? draft[key as "keywords" | "location" | "domain" | "titles"]
      : draft.advanced[key] || "";
  const setFilter = (key: string, value: string) => {
    manualKeys.current.add(key);
    setDraft((d) =>
      ["keywords", "location", "domain", "titles"].includes(key)
        ? { ...d, [key]: value, page: 1 }
        : { ...d, page: 1, advanced: { ...d.advanced, [key]: value } },
    );
  };
  const active = filters.filter(
    (f) => (!f.mode || f.mode === draft.kind) && getFilter(f.key),
  );
  function mode(kind: "company" | "person") {
    const cached = resultCache.current[kind];
    setPage(cached?.page || null);
    setRows(cached?.rows || []);
    if (cached) {
      setDraft(cached.page.criteria);
      setSelection([]);
      return;
    }
    setDraft((d) => ({
      ...d,
      kind,
      titles: kind === "company" ? "" : d.titles,
      seniority: "",
      page: 1,
      advanced: Object.fromEntries(
        Object.entries(d.advanced).filter(
          ([key]) =>
            !filters.find((f) => f.key === key)?.mode ||
            filters.find((f) => f.key === key)?.mode === kind,
        ),
      ),
    }));
    setSelection([]);
  }
  async function understand() {
    if (busy || interpreting || preview) return;
    setInterpreting(true);
    const version = scopeVersion.current;
    await task(async () => {
      try {
        const data = await call<{ criteria: SearchInput }>({
          action: "interpret",
          company,
          branch,
          query,
          current: draft,
          manualKeys: [...manualKeys.current],
        });
        if (version !== scopeVersion.current) return;
        setDraft(data.criteria);
        setSelection([]);
        setNotice(
          "Interpretation ready. Review it, then Search Apollo. No Apollo credits used.",
        );
        if (page?.criteria.kind !== data.criteria.kind) {
          setPage(null);
          setRows([]);
        }
      } finally {
        setInterpreting(false);
      }
    });
  }
  function findPeople(ids: string[]) {
    setDraft(
      decisionMakerCriteria(
        ids,
        draft.discovery?.roles || [...suggestedRoles],
        draft.discovery,
      ),
    );
    setPage(null);
    setRows([]);
    setSelection([]);
    setNotice(
      "Decision-maker filters ready. Edit roles in Advanced filters, then Search Apollo. No search has run.",
    );
    queryInput.current?.focus();
  }
  async function viewProspect(r: DatasetItem, target: HTMLElement) {
    trigger.current = target;
    await task(async () =>
      setReview({
        ...(await call<Awaited<ReturnType<typeof importReview>>>({
          action: "review",
          ...r.ref,
        })),
        stageId: r.ref.stageId,
      }),
    );
  }
  async function exportFile(format: "csv" | "xlsx") {
    await task(async () => {
      const res = await fetch("/api/prospecting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export", format, refs: targetRefs }),
      });
      if (!res.ok) throw Error((await res.json()).error);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `enercore-prospects.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        `Exported ${targetRefs.length} staged prospects. No Apollo call.`,
      );
    });
  }
  const filterForm = (
    <form
      id={formId}
      className="apollo-filter-form"
      onSubmit={(e) => {
        e.preventDefault();
        void task(async () => {
          const parsed = searchInput.safeParse(draft);
          if (!parsed.success) throw Error(parsed.error.issues[0].message);
          setDraft(parsed.data);
          setDrawer(false);
          setNotice(
            "Filters updated. Search Apollo when ready; no credits used.",
          );
          restoreFocus();
        });
      }}
    >
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="apollo-filter-heading">
        <h3>Search filters</h3>
        <Button
          type="button"
          className="secondary compact"
          disabled={busy}
          onClick={() => {
            manualKeys.current.clear();
            setDraft(searchInput.parse({ kind: draft.kind }));
          }}
        >
          Clear all
        </Button>
      </div>
      <Field label="Company workspace">
        <Select
          value={company}
          disabled={busy}
          onChange={(e) => setCompany(e.target.value)}
        >
          {actor.companies.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <Field label="Branch">
        <Input
          value={branch}
          required
          maxLength={80}
          disabled={busy}
          onChange={(e) => setBranch(e.target.value)}
        />
      </Field>
      {[
        ...new Set(
          filters
            .filter((f) => !f.mode || f.mode === draft.kind)
            .map((f) => f.group),
        ),
      ].map((group, i) => (
        <details key={group} open={i === 0} className="apollo-filter-group">
          <summary>{group}</summary>
          {filters
            .filter(
              (f) => f.group === group && (!f.mode || f.mode === draft.kind),
            )
            .map((f) => (
              <Field label={f.label} key={f.key}>
                <Input
                  type={
                    f.type === "number"
                      ? "number"
                      : f.type === "date"
                        ? "date"
                        : "text"
                  }
                  value={getFilter(f.key)}
                  onChange={(e) => setFilter(f.key, e.target.value)}
                  maxLength={
                    f.key === "location"
                      ? 100
                      : f.key === "keywords"
                        ? 150
                        : f.key === "titles" || f.key === "domain"
                          ? 200
                          : 2000
                  }
                  placeholder={
                    f.type === "list" ? "Comma-separated values" : undefined
                  }
                />
                {f.hint && <small className="muted">{f.hint}</small>}
              </Field>
            ))}
        </details>
      ))}
      {draft.kind === "person" && (
        <label className="execution-check">
          <input
            type="checkbox"
            checked={draft.similarTitles}
            onChange={(e) =>
              setDraft((d) => ({ ...d, similarTitles: e.target.checked }))
            }
          />
          Include similar job titles
        </label>
      )}
      <Field label="Results per page">
        <Select
          value={String(draft.perPage)}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              perPage: Number(e.target.value) as 25 | 50 | 100,
              page: 1,
            }))
          }
        >
          {[25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Field>
      <p className="muted small">
        {draft.kind === "company"
          ? `Estimated ${meta?.policy.companySearch ?? 1} credit per requested page.`
          : "People search: 0 credits. Email and phone require enrichment."}{" "}
        No search runs while typing.
      </p>
      {!drawer && (
        <Button type="submit" className="primary" disabled={busy || preview}>
          Apply filters · review{" "}
          {draft.kind === "company"
            ? `${meta?.policy.companySearch ?? 1} credit`
            : "free search"}
        </Button>
      )}
    </form>
  );
  if (!canProspect(actor))
    return <p>Prospecting is unavailable for your role.</p>;
  return (
    <section
      className="prospecting-workspace apollo-workspace apollo-search-first"
      aria-busy={busy}
    >
      <PageTitle
        title="Prospecting"
        subtitle="Find your next business relationship."
      />
      {contextProduct && (
        <p className="apollo-context">
          Product context is ready in your search. Choose a market and review
          the interpretation.
        </p>
      )}
      {preview && (
        <p>
          Preview does not contact Apollo. Use the local fictional workspace to
          review this flow.
        </p>
      )}
      <div className="apollo-topbar">
        <div className="apollo-tabs" aria-label="Prospecting sections">
          {(
            [
              ["results", "Search"],
              ["saved", "Saved searches"],
              ["usage", "Credits & usage"],
            ] as const
          ).map(([k, label]) => (
            <Button
              className={tab === k ? "primary" : "secondary"}
              aria-pressed={tab === k}
              key={k}
              onClick={() => setTab(k)}
            >
              {label}
            </Button>
          ))}
        </div>
        <p className="muted small">
          Opening this workspace uses no Apollo credits or AI.
        </p>
      </div>
      {error && (
        <p className="form-error apollo-notice" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="apollo-notice" role="status">
          {notice}
        </p>
      )}
      {tab === "results" && (
        <>
          <div className="apollo-search-hero">
            <p className="eyebrow">
              <Sparkles size={15} /> Commercial discovery
            </p>
            <h2>Who are you looking for?</h2>
            <form
              className="apollo-query-form"
              onSubmit={(e) => {
                e.preventDefault();
                void understand();
              }}
            >
              <label htmlFor="apollo-natural-query" className="sr-only">
                Search for companies or decision-makers
              </label>
              <textarea
                ref={queryInput}
                id="apollo-natural-query"
                rows={1}
                maxLength={800}
                value={query}
                disabled={busy}
                placeholder="Search for companies or decision-makers..."
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <Button
                className="primary"
                type="submit"
                disabled={busy || preview || query.trim().length < 3}
              >
                <Sparkles size={17} />
                {interpreting
                  ? "Understanding your search..."
                  : "Understand search"}
              </Button>
            </form>
            {interpreting && <p role="status">Understanding your search...</p>}
            <p className="muted small">
              Enter to interpret with AI. Apollo runs only after you review and
              confirm.
            </p>
            {!page && !draft.discovery && (
              <div
                className="apollo-query-examples"
                aria-label="Example searches"
              >
                {[
                  "Bitumen importing companies in Vietnam",
                  "Lubricant manufacturers in Kenya",
                  "Base oil buyers in UAE",
                  "Procurement managers at lubricant companies in Tanzania",
                  "SN500 buyers in East Africa",
                ].map((example) => (
                  <Button
                    key={example}
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => {
                      setQuery(example);
                      queryInput.current?.focus();
                    }}
                  >
                    {example}
                  </Button>
                ))}
              </div>
            )}
          </div>
          {(draft.discovery || active.length > 0) && (
            <section
              className="apollo-interpretation panel"
              aria-label="Search interpretation"
            >
              <div>
                <p className="eyebrow">
                  Searching for ·{" "}
                  {draft.kind === "company" ? "Companies" : "Decision-makers"}
                </p>
                <h3>
                  Potential matches
                  {draft.location ? ` in ${draft.location}` : ""}
                </h3>
                <p>
                  {draft.keywords || "Your reviewed company and role filters"}
                </p>
              </div>
              {draft.discovery && (
                <p className="small">
                  <strong>Suggested roles:</strong>{" "}
                  {draft.discovery.roles.join(" · ")}
                </p>
              )}
              <p className="muted small">
                Keywords identify potential matches. They do not verify
                importing activity, buying intent or product demand.
              </p>
              {draft.discovery && query.trim() !== draft.discovery.query && (
                <p role="status" className="small">
                  Search text changed. Interpret it again, or continue with the
                  reviewed filters shown here.
                </p>
              )}
              {draft.discovery?.warnings.map((w, i) => (
                <p key={i} role="status" className="small">
                  {w}
                </p>
              ))}
              <div className="apollo-search-confirm">
                <Button
                  className="primary"
                  disabled={busy || preview}
                  onClick={(e) => {
                    trigger.current = e.currentTarget;
                    void task(() =>
                      prepare(
                        "search",
                        searchInput.parse({ ...draft, page: 1 }),
                      ),
                    );
                  }}
                >
                  <Search size={16} />
                  Search Apollo
                </Button>
                <span className="muted small">
                  {draft.kind === "company"
                    ? `Estimated ${meta?.policy.companySearch ?? 1} Apollo credit per page`
                    : "No search credit · enrichment is separate"}
                </span>
              </div>
            </section>
          )}
          <div className="apollo-mode">
            <Button
              disabled={busy}
              aria-pressed={draft.kind === "company"}
              className={draft.kind === "company" ? "primary" : "secondary"}
              onClick={() => mode("company")}
            >
              <Building2 size={16} />
              Companies
              {resultCache.current.company
                ? ` (${resultCache.current.company.page.prospects.length})`
                : ""}
            </Button>
            <Button
              disabled={busy}
              aria-pressed={draft.kind === "person"}
              className={draft.kind === "person" ? "primary" : "secondary"}
              onClick={() => mode("person")}
            >
              <Users size={16} />
              People
              {resultCache.current.person
                ? ` (${resultCache.current.person.page.prospects.length})`
                : ""}
            </Button>
            <Button
              className="secondary apollo-filter-toggle"
              onClick={(e) => {
                trigger.current = e.currentTarget;
                setDrawer(true);
              }}
            >
              <SlidersHorizontal size={16} />
              Advanced filters ({active.length})
            </Button>
            <Button
              className="secondary"
              onClick={(e) => {
                trigger.current = e.currentTarget;
                setSave(true);
              }}
            >
              <Bookmark size={16} />
              Save search
            </Button>
          </div>
          <div
            className="apollo-active-filters"
            aria-label="Active filter values"
          >
            {active.map((f) => (
              <Button
                key={f.key}
                className="secondary compact"
                onClick={() => setFilter(f.key, "")}
                aria-label={`Remove ${f.label} filter`}
              >
                {f.label}: {getFilter(f.key)} <X size={12} />
              </Button>
            ))}
          </div>
          <div className="apollo-layout">
            <div className="apollo-results">
              {!page && (
                <div className="panel apollo-empty">
                  <Search size={32} />
                  <h2>Find your next business relationship</h2>
                  <p>
                    Describe your market above, or use Advanced filters. Results
                    appear here after you confirm Search Apollo.
                  </p>
                  <p className="muted">
                    Regular search results expire after 10 minutes. Confirmed
                    bulk operations reserve a snapshot for 30 minutes.
                  </p>
                </div>
              )}
              {page && (
                <>
                  <div className="apollo-results-heading">
                    <div>
                      <h2>
                        {page.criteria.kind === "company"
                          ? "Company"
                          : "People"}{" "}
                        results
                      </h2>
                      <p>
                        Page {page.page} · {page.prospects.length} on this page
                        {page.total !== undefined
                          ? ` · ${page.total.toLocaleString()} reported by Apollo`
                          : ""}
                      </p>
                    </div>
                    <span className="muted small">
                      Review until{" "}
                      {new Date(page.expiresAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="apollo-selection-toolbar panel">
                    <div className="execution-actions">
                      <strong aria-live="polite">
                        {selection.length} selected
                      </strong>
                      <Button
                        className="secondary compact"
                        disabled={busy}
                        onClick={() =>
                          setSelection(rows.map((r) => r.prospect.id))
                        }
                      >
                        Select this page
                      </Button>
                      <Button
                        className="secondary compact"
                        disabled={!selection.length}
                        onClick={() => setSelection([])}
                      >
                        Clear selection
                      </Button>
                    </div>
                    <Field label="CRM matches on this page">
                      <Select
                        value={match}
                        onChange={(e) => setMatch(e.target.value)}
                      >
                        <option value="all">All staged results</option>
                        <option value="new">
                          New to Enercore · no checked match
                        </option>
                        <option value="existing">Existing in Enercore</option>
                        <option value="review">Needs review</option>
                      </Select>
                    </Field>
                    {refs.length > 0 && (
                      <div className="execution-actions">
                        <Button
                          disabled={busy || !refs.length}
                          onClick={(e) => {
                            trigger.current = e.currentTarget;
                            void task(() => prepare("enrich", undefined, refs));
                          }}
                        >
                          Enrich selected
                        </Button>
                        <Button
                          className="secondary"
                          disabled={busy || !refs.length}
                          onClick={(e) => {
                            trigger.current = e.currentTarget;
                            void task(async () =>
                              setBulk(
                                await call({ action: "bulk-review", refs }),
                              ),
                            );
                          }}
                        >
                          Add selected to Enercore
                        </Button>
                        {page.criteria.kind === "company" && (
                          <Button
                            className="secondary"
                            disabled={!refs.length}
                            onClick={() =>
                              findPeople(
                                rows
                                  .filter((r) =>
                                    selection.includes(r.prospect.id),
                                  )
                                  .map((r) => r.prospect.id),
                              )
                            }
                          >
                            People at selected companies
                          </Button>
                        )}
                        <small>
                          Enrichment estimate: up to{" "}
                          {refs.length *
                            (page.criteria.kind === "company"
                              ? (meta?.policy.companyEnrich ?? 1)
                              : (meta?.policy.personEnrich ?? 1) +
                                (phones
                                  ? (meta?.policy.phoneAdditional ?? 8)
                                  : 0))}{" "}
                          credits. Confirmation required.
                        </small>
                      </div>
                    )}
                    {refs.length > 0 && page.criteria.kind === "person" && (
                      <label className="execution-check">
                        <input
                          type="checkbox"
                          checked={phones}
                          disabled={busy}
                          onChange={(e) => setPhones(e.target.checked)}
                        />
                        Include native phone lookup · up to 8 additional
                        credits/person; only work-classified numbers displayed
                      </label>
                    )}
                    <div className="execution-actions">
                      <Button
                        className="secondary compact"
                        disabled={busy || !targetRefs.length}
                        onClick={() => void exportFile("csv")}
                      >
                        <Download size={14} />
                        CSV
                      </Button>
                      <Button
                        className="secondary compact"
                        disabled={busy || !targetRefs.length}
                        onClick={() => void exportFile("xlsx")}
                      >
                        <Download size={14} />
                        XLSX
                      </Button>
                      <Button
                        className="secondary compact"
                        disabled={busy || !targetRefs.length}
                        onClick={(e) => {
                          trigger.current = e.currentTarget;
                          void task(async () =>
                            setReport(
                              await call({
                                action: "report",
                                refs: targetRefs,
                              }),
                            ),
                          );
                        }}
                      >
                        <FileText size={14} />
                        Generate report
                      </Button>
                      <small className="muted">
                        Uses {refs.length ? "selected" : "this page’s"} staged
                        data only · 0 credits
                      </small>
                    </div>
                  </div>
                  {!shown.length && (
                    <div className="panel apollo-empty">
                      <h3>
                        {rows.length
                          ? "No matching staged results"
                          : `No ${page.criteria.kind === "company" ? "companies" : "people"} matched this search.`}
                      </h3>
                      <p>
                        Try removing a keyword, broadening the location or
                        adjusting company size. No broader search runs
                        automatically.
                      </p>
                      <Button
                        className="secondary"
                        onClick={(e) => {
                          trigger.current = e.currentTarget;
                          setDrawer(true);
                        }}
                      >
                        Edit search
                      </Button>
                    </div>
                  )}
                  <div className="apollo-result-grid">
                    {shown.map((r) => (
                      <article
                        className="panel apollo-result-card"
                        aria-label={`${r.prospect.kind === "company" ? "Company" : "Person"}: ${r.prospect.name}`}
                        key={r.prospect.id}
                      >
                        <label className="apollo-card-select">
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.prospect.name}`}
                            checked={selection.includes(r.prospect.id)}
                            onChange={(e) =>
                              setSelection((s) =>
                                e.target.checked
                                  ? [...s, r.prospect.id]
                                  : s.filter((id) => id !== r.prospect.id),
                              )
                            }
                          />
                          <span className="eyebrow">
                            {r.prospect.kind === "company"
                              ? "Company"
                              : "Person"}{" "}
                            · Apollo
                          </span>
                        </label>
                        <h3>{r.prospect.name || "Name not supplied"}</h3>
                        <p>
                          {r.prospect.kind === "person" &&
                            r.prospect.companyName}
                          {r.prospect.title && ` · ${r.prospect.title}`}
                        </p>
                        <p className="muted">
                          {[
                            r.prospect.domain,
                            r.prospect.country,
                            r.prospect.industry,
                            r.prospect.kind === "person"
                              ? r.prospect.seniority
                              : "",
                            r.prospect.size
                              ? `${r.prospect.size} employees`
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <div className="apollo-badges">
                          <span>
                            {r.imported
                              ? "Imported"
                              : r.match === "No match in checked records"
                                ? "New · no checked match"
                                : r.match}
                          </span>
                          <span>
                            {r.prospect.enrichmentStatus || "Not enriched"}
                          </span>
                        </div>
                        {!r.prospect.nameComplete && (
                          <p className="muted small">
                            Masked name · verify or enrich before Contact
                            import.
                          </p>
                        )}
                        {r.prospect.email && (
                          <p>
                            Business email: {r.prospect.email}{" "}
                            <small>
                              ({r.prospect.emailStatus || "status not supplied"}
                              )
                            </small>
                          </p>
                        )}
                        {r.prospect.phone && (
                          <p>
                            {r.prospect.kind === "company"
                              ? "Company phone"
                              : "Work phone"}
                            : {r.prospect.phone}
                          </p>
                        )}
                        {r.prospect.enrichedAt && (
                          <small className="muted">
                            Apollo enrichment ·{" "}
                            {new Date(r.prospect.enrichedAt).toLocaleString()}
                          </small>
                        )}
                        {r.prospect.description && (
                          <p className="apollo-card-description muted small">
                            {r.prospect.description}
                          </p>
                        )}
                        <div className="apollo-card-actions">
                          <Button
                            className="secondary compact"
                            disabled={busy}
                            onClick={(e) =>
                              void viewProspect(r, e.currentTarget)
                            }
                          >
                            View
                          </Button>
                          <Button
                            className="secondary compact"
                            disabled={busy}
                            onClick={(e) => {
                              trigger.current = e.currentTarget;
                              void task(() =>
                                prepare("enrich", undefined, [r.ref]),
                              );
                            }}
                          >
                            Enrich
                          </Button>
                          <Button
                            className="secondary compact"
                            disabled={busy}
                            onClick={(e) =>
                              void viewProspect(r, e.currentTarget)
                            }
                          >
                            Add to Enercore
                          </Button>
                        </div>
                        {r.prospect.kind === "company" && (
                          <Button
                            className="secondary compact"
                            disabled={busy}
                            onClick={() => findPeople([r.prospect.id])}
                          >
                            Find decision-makers
                          </Button>
                        )}
                      </article>
                    ))}
                  </div>
                  <div className="apollo-pagination">
                    <Button
                      className="secondary"
                      disabled={busy || page.page === 1}
                      onClick={() =>
                        void task(() =>
                          prepare("search", {
                            ...page.criteria,
                            page: page.page - 1,
                          }),
                        )
                      }
                    >
                      Previous page
                    </Button>
                    <span>
                      Page {page.page} · selection stays on this page only
                    </span>
                    <Button
                      className="secondary"
                      disabled={busy || !page.hasMore}
                      onClick={() =>
                        void task(() =>
                          prepare("search", {
                            ...page.criteria,
                            page: page.page + 1,
                          }),
                        )
                      }
                    >
                      Next page ·{" "}
                      {page.criteria.kind === "company"
                        ? `${meta?.policy.companySearch ?? 1} credit`
                        : "0 credits"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
      {tab === "saved" && (
        <section className="panel execution-card">
          <h2>Saved searches</h2>
          <p>
            Load filters, review them and explicitly run a search. Saved
            searches contain no prospect results.
          </p>
          {!meta?.saved.length && <p>No saved searches yet.</p>}
          {meta?.saved.map((s) => (
            <article key={s.id} className="apollo-saved-row">
              <div>
                <h3>{s.name}</h3>
                {s.criteria.discovery && <p>{s.criteria.discovery.query}</p>}
                <p>
                  {s.criteria.kind === "company" ? "Companies" : "People"} ·{" "}
                  {s.market || "No market note"}
                  {s.productId ? " · Product context" : ""}
                </p>
              </div>
              <Button
                onClick={() => {
                  setDraft(s.criteria);
                  manualKeys.current.clear();
                  setQuery(s.criteria.discovery?.query || "");
                  setContextProduct(s.productId || undefined);
                  setTab("results");
                  setNotice(
                    "Saved filters loaded. Search Apollo when ready; no Apollo call has been made.",
                  );
                }}
              >
                Load filters
              </Button>
              <Button
                className="secondary"
                onClick={() =>
                  void task(async () => {
                    await call({ action: "delete-search", id: s.id });
                    await metadata();
                  })
                }
              >
                Remove
              </Button>
            </article>
          ))}
          <h3>Recent operations</h3>
          <p className="muted small">
            Short-lived operation history lets you resume a review. Opening it
            does not repeat enrichment.
          </p>
          {meta?.recent.map((r) => (
            <div key={r.id} className="apollo-saved-row">
              <span>
                {r.query && (
                  <strong>
                    {r.query}
                    <br />
                  </strong>
                )}
                {new Date(r.createdAt).toLocaleString()} · {r.status}
              </span>
              <Button
                onClick={() =>
                  void task(async () => {
                    const o = await call<OperationView>({
                      action: "operation",
                      id: r.id,
                    });
                    setOp(o);
                    if (o.data.resultStageId)
                      await loadPage(o.data.resultStageId);
                  })
                }
              >
                Open operation
              </Button>
            </div>
          ))}
        </section>
      )}
      {tab === "usage" && (
        <section className="panel execution-card">
          <h2>
            <Coins size={20} /> Apollo Credit Center
          </h2>
          <p>
            Cached account counters and your recent Enercore operations. Opening
            this page does not contact Apollo.
          </p>
          <Button
            disabled={busy || preview}
            onClick={() =>
              void task(async () => {
                await call({ action: "refresh-account", company, branch });
                await metadata();
              })
            }
          >
            Refresh Apollo counters · 0 credits
          </Button>
          <p className="muted small">
            Refresh is cached for 10 minutes. The plan name and prior
            2,890-credit review are not treated as current billing data.
          </p>
          {meta?.account ? (
            <>
              <p>{meta.account.source}</p>
              <div className="apollo-stat-grid">
                <p>
                  Available{" "}
                  <strong>{meta.account.available ?? "Unavailable"}</strong>
                </p>
                <p>
                  Used <strong>{meta.account.used ?? "Unavailable"}</strong>
                </p>
                <p>
                  Allowance{" "}
                  <strong>{meta.account.allowance ?? "Unavailable"}</strong>
                </p>
              </div>
              <p>
                Checked {new Date(meta.account.checkedAt).toLocaleString()} ·
                Cycle end{" "}
                {meta.account.cycleEnd
                  ? new Date(meta.account.cycleEnd).toLocaleDateString()
                  : "Unavailable"}
              </p>
              {meta.account.creditError && (
                <p role="alert">{meta.account.creditError}</p>
              )}
              {meta.account.limitsError && <p>{meta.account.limitsError}</p>}
              <details>
                <summary>Reported endpoint limits</summary>
                <ul>
                  {meta.account.limits.map((l, i) => (
                    <li key={i}>
                      {l.endpoint}: {l.limit}/{l.window},{" "}
                      {l.remaining ?? "unknown"} remaining
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <p>
              No cached account counter. Refresh explicitly to check API access;
              phone credit buckets are not shown or summed.
            </p>
          )}
          <h3>Your recent Apollo usage</h3>
          <p className="muted small">
            Estimated and observed charges are separate. Unreported charges
            remain unknown. History retained for 90 days; this is not Apollo’s
            account-wide invoice.
          </p>
          <div className="apollo-usage-list">
            {!meta?.usage.length && <p>No operations recorded.</p>}
            {meta?.usage.map((u) => (
              <article key={u.id}>
                <strong>{u.operation.replaceAll("_", " ")}</strong>
                <span>
                  {u.actorName} · {new Date(u.createdAt).toLocaleString()}
                </span>
                <span>
                  Results {u.count} · Estimated {u.estimatedCredits} credits ·
                  Observed {u.actualCredits ?? "unknown"}
                </span>
                <small>{u.status}</small>
              </article>
            ))}
          </div>
        </section>
      )}
      {drawer && (
        <Dialog
          title="Apollo search filters"
          className="execution-editor apollo-filter-sheet"
          onClose={() => {
            setDrawer(false);
            restoreFocus();
          }}
        >
          {filterForm}
          <DialogActions
            onCancel={() => {
              setDrawer(false);
              restoreFocus();
            }}
            primary={{
              label: "Apply filters",
              type: "submit",
              form: formId,
              disabled: busy || preview,
            }}
          />
        </Dialog>
      )}
      {op && (
        <CreditDialog
          op={op}
          error={error}
          busy={busy}
          onClose={closeOperation}
          onRun={() => void run()}
          onRetry={() =>
            void task(async () => {
              setOp(
                await call({
                  action: "retry-failed",
                  id: op.id,
                  requestId: crypto.randomUUID(),
                }),
              );
            })
          }
          onPhones={() =>
            void task(async () => {
              const next = await call<OperationView>({
                action: "phone-results",
                id: op.id,
              });
              setOp(next);
              if (next.data.resultStageId)
                await loadPage(next.data.resultStageId);
            })
          }
        />
      )}
      {review && (
        <ProspectReview
          key={review.stageId + review.prospect.id}
          review={review}
          company={company}
          branch={branch}
          productId={contextProduct}
          onClose={() => {
            setReview(null);
            restoreFocus();
          }}
          onEnrich={(ref) => {
            setReview(null);
            void task(() => prepare("enrich", undefined, [ref]));
          }}
          onImported={(ids) => {
            setReview(null);
            setNotice("Reviewed relationship imported into Enercore.");
            void metadata();
            openReference({
              id: "",
              label: "Imported relationship",
              target: {
                type: "record",
                kind: ids.leadId ? "leads" : "customers",
                id: ids.leadId || ids.customerId,
              },
            });
          }}
        />
      )}
      {bulk && (
        <BulkImportDialog
          review={bulk}
          productId={contextProduct}
          onClose={() => {
            setBulk(null);
            restoreFocus();
          }}
          onDone={() => {
            if (page) void task(() => loadPage(page.stageId));
          }}
        />
      )}
      {report && (
        <ReportDialog
          report={report}
          onClose={() => {
            setReport(null);
            restoreFocus();
          }}
        />
      )}
      {save && (
        <Dialog
          title="Save prospecting search"
          onClose={() => {
            setSave(false);
            restoreFocus();
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void task(async () => {
                await call({
                  action: "save-search",
                  company,
                  branch,
                  name: f.get("name"),
                  market: f.get("market"),
                  criteria: draft,
                  productId: contextProduct,
                });
                await metadata();
                setSave(false);
                setNotice("Search saved. No Apollo call was made.");
                restoreFocus();
              });
            }}
          >
            <Field label="Search name">
              <Input name="name" required maxLength={100} />
            </Field>
            <Field label="Market context">
              <Input
                name="market"
                maxLength={200}
                defaultValue={draft.location}
              />
            </Field>
            <p>Only these structured filters and context will be saved.</p>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <Button className="primary" type="submit" disabled={busy}>
              Save filters
            </Button>
          </form>
        </Dialog>
      )}
    </section>
  );
}
