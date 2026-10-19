"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, XCircle } from "lucide-react";
import styles from "../studio/tasks.module.css";
import { Button, DialogPresence, Input, Select } from "../ui/controls";
import { EmptyState, PageHeader, Surface, Tabs, Toolbar, tabPanelProps } from "../ui/layout";
import { Skeleton } from "../ui/skeleton";
import { PRIORITY_LABELS, TASK_PRIORITIES, type TaskPriority, type TaskStatus, type TaskViewName } from "@/lib/tasks/model";
import { TASKS_CHANGED, tasksApi, type TaskFilters, type TaskList, type TaskView } from "@/lib/tasks/client";
import type { Actor, RecordItem } from "@/lib/domain";
import { TaskDialog } from "./task-dialog";
import { TaskDetail } from "./task-detail";
import { TaskRows } from "./task-list";
import AutomationPanel from "./automation-panel";

type Tab = TaskViewName | "automation";
const VIEW_TEXT: Record<TaskViewName, { label: string; empty: string; detail: string }> = {
  today: { label: "Today", empty: "Nothing is due today.", detail: "Tasks due today in Dubai appear here." },
  overdue: { label: "Overdue", empty: "Nothing is overdue.", detail: "Open tasks whose due date has passed appear here." },
  upcoming: { label: "Upcoming", empty: "Nothing is planned yet.", detail: "Tasks due after today appear here." },
  completed: { label: "Completed", empty: "No completed or cancelled tasks yet.", detail: "Finished and cancelled tasks are kept here with their history." },
};

/**
 * Tasks — My Day for internal work: Today, Overdue, Upcoming and Completed,
 * your own or (for team leads) your team's, plus the automation rules that
 * create tasks. Lists come from the server already limited to what this
 * person may see; nothing here decides access.
 */
export default function TasksPage({ actor, company, records = [] }: { actor: Actor; company: string; records?: RecordItem[] }) {
  const [tab, setTab] = useState<Tab>("today");
  const [filters, setFilters] = useState<Omit<TaskFilters, "view">>({ scope: "mine", q: "", priority: "", status: "", source: "", sort: "due", page: 1, pageSize: 20, company });
  const [list, setList] = useState<TaskList | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TaskView | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("task")));
  const [automation, setAutomation] = useState(false);
  const [query, setQuery] = useState("");
  const seq = useRef(0);

  useEffect(() => setFilters((f) => ({ ...f, company, page: 1 })), [company]);
  // Debounced search, so typing does not send a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === query ? f : { ...f, q: query, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [query]);

  const view: TaskViewName = tab === "automation" ? "today" : tab;
  const load = useCallback(() => {
    const n = ++seq.current;
    const controller = new AbortController();
    setLoading(true);
    tasksApi.list({ ...filters, view }, controller.signal).then(
      (r) => {
        if (n !== seq.current) return;
        setList(r);
        setError("");
        setLoading(false);
      },
      (e) => {
        if (n !== seq.current || controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Couldn't load tasks.");
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [filters, view]);
  useEffect(() => load(), [load]);

  // Any change on this page (or a notification arriving) refreshes the list.
  useEffect(() => {
    const refresh = () => load();
    const onTask = (e: Event) => setOpenId((e as CustomEvent<{ taskId: string }>).detail.taskId);
    window.addEventListener(TASKS_CHANGED, refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("enercore:open-task", onTask);
    return () => {
      window.removeEventListener(TASKS_CHANGED, refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("enercore:open-task", onTask);
    };
  }, [load]);

  // The Automation tab exists only for people who may see a company's rules.
  useEffect(() => {
    tasksApi.rules().then((r) => setAutomation(r.companies.length > 0), () => setAutomation(false));
  }, []);

  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, page: 1, ...patch }));
  const filtered = !!(filters.q || filters.priority || filters.status || filters.source);
  const counts = list?.counts;
  const team = list?.scope === "team";
  const statusChoices: TaskStatus[] = view === "completed" ? ["completed", "cancelled"] : ["open", "in_progress"];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Tasks"
        description="My Day for internal work — what is due today, what is late and what comes next. Times are Dubai time."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New task
          </Button>
        }
      />
      <Tabs<Tab>
        label="Task views"
        idBase="tasks"
        active={tab}
        onChange={(t) => (setTab(t), setFilters((f) => ({ ...f, page: 1, status: "" })))}
        items={[
          { id: "today", label: "Today", count: counts?.today },
          { id: "overdue", label: "Overdue", count: counts?.overdue },
          { id: "upcoming", label: "Upcoming", count: counts?.upcoming },
          { id: "completed", label: "Completed", count: counts?.completed },
          { id: "automation", label: "Automation", hidden: !automation },
        ]}
      />
      {notice && (
        <div className="action-notice" role="status">
          <span>{notice}</span>
          <Button className="icon-button" aria-label="Close message" onClick={() => setNotice("")}>
            <XCircle size={15} />
          </Button>
        </div>
      )}
      {tab === "automation" ? (
        <div {...tabPanelProps("tasks", "automation")}>
          <AutomationPanel actor={actor} />
        </div>
      ) : (
        <div {...tabPanelProps("tasks", tab)}>
          <Surface padding="none">
            <Toolbar aria-label="Task filters" className={styles.filters}>
              <Input type="search" className={styles.search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" />
              {list?.teamAvailable && (
                <div className="segmented" role="group" aria-label="Whose tasks">
                  <Button className={!team ? "selected" : ""} aria-pressed={!team} onClick={() => set({ scope: "mine" })}>
                    Mine
                  </Button>
                  <Button className={team ? "selected" : ""} aria-pressed={team} onClick={() => set({ scope: "team" })}>
                    Team
                  </Button>
                </div>
              )}
              <Select className={styles.filterSelect} aria-label="Priority" value={filters.priority || "any"} onChange={(e) => set({ priority: e.target.value === "any" ? "" : (e.target.value as TaskPriority) })}>
                <option value="any">Any priority</option>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </Select>
              <Select className={styles.filterSelect} aria-label="Status" value={filters.status || "any"} onChange={(e) => set({ status: e.target.value === "any" ? "" : (e.target.value as TaskStatus) })}>
                <option value="any">Any status</option>
                {statusChoices.map((s) => (
                  <option key={s} value={s}>
                    {s === "in_progress" ? "In progress" : s[0].toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </Select>
              <Select className={styles.filterSelect} aria-label="Source" value={filters.source || "any"} onChange={(e) => set({ source: e.target.value === "any" ? "" : (e.target.value as "manual" | "automation") })}>
                <option value="any">Any source</option>
                <option value="manual">Created by people</option>
                <option value="automation">Created by automation</option>
              </Select>
              <Select className={styles.filterSelect} aria-label="Sort" value={filters.sort} onChange={(e) => set({ sort: e.target.value as TaskFilters["sort"] })}>
                <option value="due">{view === "completed" ? "Recently finished" : "Due date"}</option>
                <option value="priority">Priority</option>
                <option value="updated">Recently updated</option>
                <option value="title">Title</option>
              </Select>
            </Toolbar>
            {error ? (
              <div className={styles.state}>
                <EmptyState title="Tasks couldn't be loaded" detail={error} action={<Button variant="secondary" onClick={load}>Try again</Button>} />
              </div>
            ) : !list ? (
              <div aria-busy="true" aria-label="Loading tasks">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className={styles.skeletonRow}>
                    <Skeleton w="45%" />
                    <Skeleton w="25%" h={10} />
                  </div>
                ))}
              </div>
            ) : list.items.length === 0 ? (
              <div className={styles.state}>
                <EmptyState
                  title={filtered ? "No tasks match these filters" : VIEW_TEXT[view].empty}
                  detail={filtered ? "Clear the search or filters to see everything in this view." : VIEW_TEXT[view].detail}
                  action={
                    filtered ? (
                      <Button variant="secondary" onClick={() => (setQuery(""), set({ q: "", priority: "", status: "", source: "" }))}>
                        Clear filters
                      </Button>
                    ) : view !== "completed" ? (
                      <Button variant="secondary" onClick={() => setCreating(true)}>
                        <Plus size={15} /> New task
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <div aria-busy={loading || undefined}>
                <TaskRows items={list.items} showAssignee={team} label={`${VIEW_TEXT[view].label} tasks`} onOpen={(t) => setOpenId(t.id)} onError={setNotice} />
              </div>
            )}
            {list && list.total > 0 && (
              <nav className={styles.footer} aria-label="Task pages">
                <span role="status">
                  {(list.page - 1) * list.pageSize + 1}–{(list.page - 1) * list.pageSize + list.items.length} of {list.total} tasks
                </span>
                <div className={styles.pager}>
                  <Select aria-label="Tasks per page" value={String(filters.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>
                    {[10, 20, 50].map((n) => (
                      <option key={n} value={n}>
                        {n} per page
                      </option>
                    ))}
                  </Select>
                  <Button variant="secondary" size="icon" aria-label="Previous page" disabled={list.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: list.page - 1 }))}>
                    <ChevronLeft size={16} />
                  </Button>
                  <span>
                    {list.page} / {list.pages}
                  </span>
                  <Button variant="secondary" size="icon" aria-label="Next page" disabled={list.page >= list.pages} onClick={() => setFilters((f) => ({ ...f, page: list.page + 1 }))}>
                    <ChevronRight size={16} />
                  </Button>
                </div>
              </nav>
            )}
          </Surface>
        </div>
      )}
      <DialogPresence>
        {(creating || editing) && (
          <TaskDialog
            actor={actor}
            task={editing}
            records={records}
            defaultCompany={company}
            onClose={() => (setCreating(false), setEditing(null))}
            onSaved={(t) => {
              setCreating(false);
              setEditing(null);
              setNotice(editing ? "Task saved." : `Task created for ${t.assignee.id === actor.id ? "you" : t.assignee.name}, due ${t.dueDate}.`);
            }}
          />
        )}
      </DialogPresence>
      <DialogPresence>
        {openId && !editing && (
          <TaskDetail
            taskId={openId}
            onClose={() => {
              setOpenId(null);
              const url = new URL(window.location.href);
              if (url.searchParams.has("task")) (url.searchParams.delete("task"), window.history.replaceState(null, "", url));
            }}
            onEdit={(t) => setEditing(t)}
          />
        )}
      </DialogPresence>
    </div>
  );
}
