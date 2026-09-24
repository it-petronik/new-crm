"use client";
import { companyName } from "@/lib/company-name";
import { recordsToCsv, exportFilename, downloadCsv } from "@/lib/export";
import { isImportable, type ImportableKind } from "@/lib/import";
import { attentionItems, isoDate, nextAction } from "@/lib/attention";
import LogActivity from "./log-activity";
import MorningBrief from "./morning-brief";
import BusinessClock from "./business-clock";
import MyDay from "./my-day";
import QuickAdd from "./quick-add";
import { SkeletonDashboard, SkeletonMyDay, SkeletonList } from "./ui/skeleton";
import FollowUpControl, { FollowUpMenu } from "./follow-up-control";
import ImportDialog from "./import-dialog";
import { salaryAttributes } from "@/lib/salary";
import { workspaceUrl, workspaceParams } from "@/lib/workspace-url";
import { Cashbook } from "./cashbook";
import { isCashEntry, cashEntryError } from "@/lib/cashbook";
import { mutateRecord, deletionReason } from "@/lib/record-mutations";
import { BrandLogo } from "./brand";
import DashboardInsights from "./dashboard-insights";
import { QuotationDocument } from "./quotation-document";
import { Pagination, ListFilters, ListEmpty, SortHeader, usePagination } from "./pagination";
import {
  Button,
  Input,
  Select,
  Textarea,
  Field,
} from "@/components/ui/controls";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Pencil,
  Trash2,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Box,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Command,
  Download,
  FileText,
  Globe2,
  LayoutDashboard,
  List,
  LogOut,
  Menu,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
  Phone,
  Target,
  Truck,
  Users,
  Wallet,
  X,
  Monitor,
  CalendarDays,
  CalendarRange,
  LayoutGrid,
  Filter,
  type LucideIcon,
} from "lucide-react";
import {
  allowedModules,
  canApprove,
  canWrite,
  canManageUsers,
  companies,
  labels,
  localISO,
  money,
  outstanding,
  scopedWorkspace,
  stages,
  windowStart,
  type Actor,
  type Audit,
  type Kind,
  type Module,
  type RecordItem,
  type Workspace as WorkspaceData,
} from "@/lib/domain";
import { makePreview } from "@/lib/fixtures";
import { transition, addNote, recordPayment } from "@/lib/workflow";
import { RecordActivity } from "./record-tools";
import Sidebar from "./sidebar";
import { Dialog, DialogPresence, DialogActions } from "./ui/controls";
import ThemeToggle from "./theme-toggle";
import MyRequests from "./my-requests";
import { storedPreviewActor, previewActorKey } from "@/lib/fixtures";
import { Avatar } from "./avatar";
import RecordForm from "./record-form";
import { recordProfiles, detailFields } from "@/lib/record-profiles";
import UserAdmin from "./user-admin";
import {
  ProfilePage,
  AppearancePage,
  NotificationsPage,
  ShortcutsPage,
  PageTitle,
  viewLabels,
  type WorkspaceView,
} from "./workspace-pages";
import CommandMenu from "./command-menu";
import { workspaceNotifications } from "@/lib/notifications";
import Link from "next/link";
const icons: Record<Module, LucideIcon> = {
  overview: LayoutDashboard,
  leads: Target,
  quotations: FileText,
  orders: Package,
  logistics: Truck,
  accounts: Wallet,
  customers: Users,
  suppliers: Building2,
  products: Box,
  hr: Users,
  marketing: Globe2,
  it: Monitor,
  approvals: ShieldCheck,
  activity: Activity,
  settings: Settings2,
};
const subtitles: Record<Module, string> = {
  overview: "A clear view of your business. A focused start to your day.",
  leads: "Every conversation, connected to your next opportunity.",
  quotations: "From first enquiry to a confident offer.",
  orders: "A single handover from sales to operations.",
  logistics: "Keep every shipment moving in the right direction.",
  accounts: "Know what is due. Keep collections on track.",
  customers: "Relationships that move your business forward.",
  suppliers: "Company-specific supply partners, contacts and commercial terms.",
  products: "Your products, grades and availability in one place.",
  hr: "Take care of the people behind your business.",
  marketing: "Turn the right attention into new opportunities.",
  it: "Keep your team connected and productive.",
  approvals: "The decisions waiting for your attention.",
  activity: "A traceable history of what changed and when.",
  settings: "Your company structure and access overview.",
};
const companyColors: Record<string, string> = {
  Petronik: "#169c88",
  Afrilube: "#d0a351",
  Petronex: "#668ee2",
  Istanegry: "#ac84ce",
};
const moduleGroups: [string, Module[]][] = [
  ["WORKSPACE", ["overview", "leads", "quotations", "orders"]],
  [
    "OPERATIONS",
    ["logistics", "accounts", "customers", "suppliers", "products"],
  ],
  ["ORGANIZATION", ["hr", "marketing", "it"]],
  ["MANAGE", ["approvals", "activity", "settings"]],
];
const newLabels: Partial<Record<Module, string>> = {
  leads: "New lead",
  quotations: "New quotation",
  customers: "Add customer",
  suppliers: "Add supplier",
  products: "Add product",
  hr: "Add employee",
  marketing: "New campaign",
  it: "New ticket",
};
const cardModules: Module[] = [
  "suppliers",
  "customers",
  "products",
  "hr",
  "marketing",
  "it",
  "logistics",
];
function Badge({ status }: { status: string }) {
  const tone = [
    "Approved",
    "Active",
    "Available",
    "Paid",
    "Delivered",
    "Won",
    "Accepted",
    "Completed",
    "Resolved",
  ].includes(status)
    ? "green"
    : [
          "Overdue",
          "Delayed",
          "Rejected",
          "Lost",
          "Cancelled",
          "Credit Hold",
        ].includes(status)
      ? "red"
      : [
            "Pending Approval",
            "Low Stock",
            "Negotiation",
            "Documents Pending",
            "On Leave",
          ].includes(status)
        ? "amber"
        : "blue";
  return (
    <span className={`badge ${tone}`}>
      <i />
      {status}
    </span>
  );
}
function Company({ name }: { name: string }) {
  return (
    <span className="company-label">
      <i style={{ background: companyColors[name] }} />
      {companyName(name)}
    </span>
  );
}
function Empty({
  title = "Nothing here yet",
  detail = "Create a record to get started.",
}: {
  title?: string;
  detail?: string;
}) {
  return (
    <div className="empty">
      <Box size={30} />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
function shortMoney(value: number) {
  return value >= 1e6
    ? `$${(value / 1e6).toFixed(2)}M`
    : value >= 1000
      ? `$${(value / 1000).toFixed(1)}k`
      : money(value);
}
/** Resolves a URL to the page it names, honouring the actor's access. */
function routeFromUrl(actor: Actor, path: string, search: string) {
  const params = workspaceParams(path, search);
  const selfService = path === "/my-requests" || params.get("module") === "my-requests";
  const requestedView = params.get("view") as WorkspaceView;
  const requestedCompany = params.get("company");
  const requestedModule = params.get("module");
  return {
    selfService,
    view:
      requestedView in viewLabels &&
      (requestedView !== "access" || canManageUsers(actor))
        ? requestedView
        : null,
    company:
      requestedCompany && actor.companies.includes(requestedCompany)
        ? requestedCompany
        : "All companies",
    module:
      requestedModule && allowedModules(actor).includes(requestedModule as Module)
        ? (requestedModule as Module)
        : allowedModules(actor)[0] || "overview",
  };
}

export default function Workspace({
  actor,
  preview,
  initialSelfService = false,
  initialPath = "/",
  initialSearch = "",
}: {
  actor: Actor;
  preview: boolean;
  initialSelfService?: boolean;
  initialPath?: string;
  initialSearch?: string;
}) {
  // Preview signs in through demo accounts, so the acting role comes from the
  // browser. Read after mount to keep the server and first client render equal.
  const [previewSignedIn, setPreviewSignedIn] = useState<Actor | null>(null);
  useEffect(() => {
    if (preview) setPreviewSignedIn(storedPreviewActor());
  }, [preview]);
  actor = preview && previewSignedIn ? previewSignedIn : actor;
  // Derived from the server-supplied URL so a reload paints the requested page
  // immediately instead of flashing the overview first.
  const initial = routeFromUrl(actor, initialPath, initialSearch);
  const [selfService, setSelfService] = useState(initialSelfService || initial.selfService);
  const [view, setView] = useState<WorkspaceView | null>(initial.view);
  const [commandOpen, setCommandOpen] = useState(false);
  const [readNotifications, setReadNotifications] = useState<string[]>([]);
  const [module, setModule] = useState<Module>(initial.module);
  const [company, setCompany] = useState(initial.company);
  useEffect(() => {
    document.documentElement.dataset.company = company;
    return () => {
      delete document.documentElement.dataset.company;
    };
  }, [company]);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<WorkspaceData>({ records: [], audit: [] });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const syncLocation = () => {
      const params = workspaceParams(window.location.pathname, window.location.search);
      const self = window.location.pathname === "/my-requests" || params.get("module") === "my-requests";
      setSelfService(self);
      // Older bookmarks now open the ordinary company-filtered overview.
      if (params.get("view") === "companies") {
        params.delete("view");
        params.set("module", "overview");
        window.history.replaceState(null, "", `/?${params}`);
      }
      const requestedView = params.get("view") as WorkspaceView;
      setView(
        requestedView in viewLabels &&
          (requestedView !== "access" || canManageUsers(actor))
          ? requestedView
          : null,
      );
      const requestedCompany = params.get("company");
      setCompany(
        requestedCompany && actor.companies.includes(requestedCompany)
          ? requestedCompany
          : "All companies",
      );
      const requested = params.get("module");
      window.history.replaceState(null, "", workspaceUrl(self ? "my-requests" : params.get("view") || requested || "overview", params.get("company") || "All companies"));
      setModule(
        requested && allowedModules(actor).includes(requested as Module)
          ? (requested as Module)
          : allowedModules(actor)[0] || "overview",
      );
      setForm(null);
      setSelected(null);
      setMobile(false);
      setNotifications(false);
    };
    syncLocation();
    window.addEventListener("popstate", syncLocation);
    try {
      setCollapsed(
        localStorage.getItem("enercore-sidebar-collapsed") === "true",
      );
      const savedRead = JSON.parse(
        localStorage.getItem(`enercore-notifications-${actor.id}`) || "[]",
      );
      setReadNotifications(
        Array.isArray(savedRead)
          ? savedRead.filter((id): id is string => typeof id === "string")
          : [],
      );
    } catch {}
    return () => window.removeEventListener("popstate", syncLocation);
  }, []);
  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("enercore-sidebar-collapsed", String(next));
    } catch {}
  }
  const [form, setForm] = useState<Kind | null>(null);
  const [editing, setEditing] = useState<RecordItem | null>(null);
  const [deleting, setDeleting] = useState<RecordItem | null>(null);
  const [importing, setImporting] = useState(false);
  const [quickAdd, setQuickAdd] = useState<{ open: boolean; kind?: Kind }>({ open: false });
  const [logging, setLogging] = useState<RecordItem | null>(null);
  // After advancing a record, offer the follow-up rather than relying on the
  // person to remember. Dismissable, never blocking.
  const [prompt, setPrompt] = useState<{ record: RecordItem; status: string } | null>(null);
  // Who sees the company view rather than their own day.
  const executive = ["MD", "IT Administrator", "Group Manager", "Branch Manager"].includes(actor.role);
  const [mutationError, setMutationError] = useState("");
  useEffect(() => { if (!form) { setEditing(null); setMutationError(""); } }, [form]);
  // "n" opens quick add, the way a mail client opens a compose window. Ignored
  // while typing, so it never swallows a character mid-field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      e.preventDefault();
      setQuickAdd({ open: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  /**
   * One key per create-form session. Sent with the submission so a
   * double-click, a retry or a dropped response resolves to the same record
   * instead of creating a second one. A new key is minted only when a create
   * form opens, so a genuine second record still gets its own.
   */
  const createKey = useRef("");
  useEffect(() => { if (form && !editing) createKey.current = crypto.randomUUID(); }, [form, editing]);
  const [quoteSource, setQuoteSource] = useState<RecordItem | null>(null);
  const [selected, setSelected] = useState<RecordItem | null>(null);
  const [board, setBoard] = useState(true);
  // Dashboard period lives here so its control can sit beside the company filter.
  const [period, setPeriod] = useState("all");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [filter, setFilter] = useState("All statuses");
  const [notifications, setNotifications] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hrTab, setHrTab] = useState<"people" | "leave">("people");
  const searchRef = useRef<HTMLInputElement>(null);
  const permitted = allowedModules(actor);
  async function reload() {
    const response = await fetch("/api/records", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Unable to load workspace.");
    setData(result);
  }
  useEffect(() => {
    let active = true;
    if (preview) {
      try {
        const saved = localStorage.getItem("enercore-preview-v1");
        const value = saved ? JSON.parse(saved) : makePreview();
        if (active) setData(value);
      } catch {
        setData(makePreview());
      }
      setLoaded(true);
    } else {
      reload()
        .catch((e) => setError(e.message))
        .finally(() => setLoaded(true));
    }
    return () => {
      active = false;
    };
  }, [preview]);
  useEffect(() => {
    if (preview && loaded) {
      try {
        localStorage.setItem("enercore-preview-v1", JSON.stringify(data));
      } catch {
        setError(
          "Browser storage is unavailable. Preview changes will not survive a refresh.",
        );
      }
    }
  }, [data, preview, loaded]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((open) => !open);
      }
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if (!typing && !form && !selected && e.key === "/") {
        e.preventDefault();
        setCommandOpen(true);
      }
      if (
        !typing &&
        !form &&
        !selected &&
        !view &&
        !selfService &&
        e.altKey &&
        e.key.toLowerCase() === "n"
      ) {
        const kind =
          module === "hr" ? (hrTab === "people" ? "hr" : "leave") : module;
        if (
          newLabels[module] &&
          canWrite(actor, {
            kind,
            company: company === "All companies" ? actor.companies[0] : company,
            branch: actor.branches[0] || "Main",
            ownerId: actor.id,
          } as RecordItem)
        ) {
          e.preventDefault();
          setForm(kind as Kind);
        }
      }
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        setNotifications(false);
        setMobile(false);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [module, hrTab, view, selfService, form, selected, company, actor]);
  const scoped = scopedWorkspace(actor, data);
  const notificationItems = workspaceNotifications(actor, scoped);
  const markRead = (ids: string[]) => {
    const next = Array.from(new Set([...readNotifications, ...ids])).slice(
      -2000,
    );
    setReadNotifications(next);
    try {
      localStorage.setItem(
        `enercore-notifications-${actor.id}`,
        JSON.stringify(next),
      );
    } catch {
      setToast("Read status could not be saved on this device.");
    }
  };
  const openView = (next: WorkspaceView) => {
    if (next === "access" && !canManageUsers(actor)) return;
    setView(next);
    setSelfService(false);
    setMobile(false);
    setForm(null);
    setSelected(null);
    setNotifications(false);
    window.history.pushState(
      null,
      "",
      workspaceUrl(next, company),
    );
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const records = scoped.records.filter(
    (r) => company === "All companies" || r.company === company,
  );
  const approvals = records.filter(
    (r) => r.status === "Pending Approval" && canApprove(actor, r),
  );
  const today = new Date().toISOString().slice(0, 10);
  const attention = records.filter(
    (r) =>
      ["Delayed", "Overdue"].includes(r.status) ||
      (r.kind === "leads" &&
        r.due < today &&
        !["Won", "Lost"].includes(r.status)),
  );
  const go = (m: Module, scope = company) => {
    if (!permitted.includes(m)) return;
    setView(null);
    setCompany(scope);
    setSelfService(false);
    window.history.pushState(
      null,
      "",
      workspaceUrl(m, scope),
    );
    setModule(m);
    setSearch("");
    setFilter("All statuses");
    setMobile(false);
    setNotifications(false);
    setForm(null);
    setSelected(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const openSelfService = () => {
    setView(null);
    if (!selfService)
      window.history.pushState(
        null,
        "",
        workspaceUrl("my-requests", company),
      );
    setSelfService(true);
    setMobile(false);
    setNotifications(false);
    setForm(null);
    setSelected(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const activeKind =
    module === "hr" ? (hrTab === "people" ? "hr" : "leave") : module;
  // The kanban board has no shared filter row, so it keeps its own status
  // control; every other view uses the filter row above its list instead.
  const kanbanView = module === "leads" && board;
  const visible = records.filter(
    (r) =>
      r.kind === activeKind && !isCashEntry(r) &&
      (!kanbanView || filter === "All statuses" || r.status === filter) &&
      `${r.title} ${r.product} ${r.contact} ${r.id} ${r.owner}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const results = search
    ? records
        .filter((r) =>
          `${r.title} ${r.product} ${r.contact} ${r.id}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .slice(0, 8)
    : [];
  const selectedCurrent = selected
    ? data.records.find((r) => r.id === selected.id) || selected
    : null;
  async function update(r: RecordItem, status: string) {
    setBusy(true);
    try {
      if (preview) setData(transition(data, actor, r.id, status));
      else {
        const response = await fetch("/api/records", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: r.id, status }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        await reload();
      }
      setToast(
        status === "Accepted"
          ? "Order, shipment and draft invoice created."
          : `Updated to ${status}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update.");
    } finally {
      setBusy(false);
    }
  }
  /**
   * Sets the next follow-up on a record.
   *
   * A follow-up is a dated note, which the record API already supports, so
   * this goes through the same authenticated, audited, concurrency-guarded
   * path as any other change — it simply removes the typing.
   */
  /**
   * Records a contact and, when one was chosen, the next follow-up — in one
   * write through the same audited action a typed note uses.
   */
  async function logActivity(r: RecordItem, text: string, due?: string) {
    await extraAction(r, { action: "note", text, ...(due ? { due } : {}) });
    setToast(due ? `Activity logged · follow-up ${due}.` : "Activity logged.");
  }

  async function setFollowUp(r: RecordItem, date: string) {
    await extraAction(r, {
      action: "note",
      text: `Follow-up scheduled for ${date}`,
      due: date,
    });
    setToast(`Follow-up set for ${date}.`);
  }

  async function extraAction(
    r: RecordItem,
    action:
      | { action: "note"; text: string; due?: string }
      | { action: "payment"; amountCents: number; reference: string },
  ) {
    setBusy(true);
    try {
      if (preview)
        setData(
          action.action === "note"
            ? addNote(data, actor, r.id, action.text, action.due)
            : recordPayment(
                data,
                actor,
                r.id,
                action.amountCents,
                action.reference,
              ),
        );
      else {
        const response = await fetch("/api/records", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: r.id, ...action }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        await reload();
      }
      setToast(
        action.action === "note" ? "Activity saved." : "Payment recorded.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function create(
    values: Omit<
      RecordItem,
      "id" | "status" | "ownerId" | "owner" | "createdAt" | "updatedAt"
    >,
  ) {
    setBusy(true);
    try {
      if (isCashEntry(values)) {
        const error = cashEntryError(values);
        if (error) throw new Error(error);
      }
      if(values.kind === "hr") values.attributes = salaryAttributes(values.attributes);
      if (preview) {
        const now = new Date().toISOString();
        const record: RecordItem = {
          ...values,
          id: `EC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          status: isCashEntry(values) ? "Recorded" : stages[values.kind][0],
          ownerId: actor.id,
          owner: actor.name,
          createdAt: now,
          updatedAt: now,
        };
        if (!canWrite(actor, record))
          throw new Error("You do not have access to create this record.");
        setData({
          ...data,
          records: [record, ...data.records],
          audit: [
            {
              id: crypto.randomUUID(),
              actor: actor.name,
              action: `Created ${values.kind}`,
              recordId: record.id,
              company: values.company,
              at: now,
            },
            ...data.audit,
          ],
        });
      } else {
        const response = await fetch("/api/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...values, requestId: createKey.current }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        await reload();
      }
      setForm(null);
      setToast("Saved to your workspace.");
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  async function saveEdit(values: Parameters<typeof create>[0]) {
    if (!editing) return;
    setBusy(true);
    setMutationError("");
    try {
      if (preview) setData(mutateRecord(data, actor, editing.id, editing.updatedAt, values));
      else {
        const response = await fetch("/api/records", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "edit", id: editing.id, expectedUpdatedAt: editing.updatedAt, values }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        await reload();
      }
      setForm(null);
      setSelected(editing);
      setEditing(null);
      setToast("Changes saved.");
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Unable to save changes.");
    } finally { setBusy(false); }
  }
  async function deleteRecord() {
    if (!deleting) return;
    setBusy(true);
    setMutationError("");
    try {
      if (preview) setData(mutateRecord(data, actor, deleting.id, deleting.updatedAt));
      else {
        const response = await fetch("/api/records", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: deleting.id, expectedUpdatedAt: deleting.updatedAt }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        await reload();
      }
      setDeleting(null);
      setSelected(null);
      setToast("Record removed from the workspace; audit history retained.");
    } catch (error) { setMutationError(error instanceof Error ? error.message : "Unable to delete record."); }
    finally { setBusy(false); }
  }
  return (
    <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar
        actor={actor}
        preview={preview}
        module={selfService ? "my-requests" : view || module}
        collapsed={collapsed}
        mobile={mobile}
        approvalCount={approvals.length}
        onCollapse={toggleSidebar}
        onMobileChange={setMobile}
        onNavigate={go}
        onMyRequests={openSelfService}
        onView={openView}
      />
      <div className="main-shell">
        <header className="topbar">
          <div className="top-left">
            <Button
              className="icon-button mobile-menu"
              onClick={() => setMobile(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </Button>
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <Button
                className="breadcrumb-link"
                onClick={() =>
                  go(permitted.includes("overview") ? "overview" : permitted[0])
                }
              >
                Workspace
              </Button>{" "}
              <ChevronRight size={13} />
              <Button
                className="breadcrumb-link current"
                aria-current="page"
                onClick={() =>
                  selfService
                    ? openSelfService()
                    : view
                      ? openView(view)
                      : go(module)
                }
              >
                {selfService
                  ? "My requests"
                  : view
                    ? viewLabels[view]
                    : labels[module]}
              </Button>
            </nav>
          </div>
          <div className="top-right">
            <BusinessClock />
            {/* Always reachable, on every screen, so creating a record is
                never a navigation task. The shortcut is a convenience on top
                of this button, never a requirement. */}
            <Button
              className="primary quick-add-trigger"
              onClick={() => setQuickAdd({ open: true })}
              title="Quick add (press n)"
            >
              <Plus size={17} aria-hidden="true" />
              <span className="quick-add-trigger-label">Quick add</span>
            </Button>
            {!selfService && !view && (
              <div className="global-search">
                <Search size={16} />
                <Input
                  aria-label="Search workspace"
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search anything…"
                />
                {search && module === "overview" && (
                  <div className="search-results">
                    {results.length ? (
                      results.map((r) => (
                        <Button
                          key={r.id}
                          onClick={() => {
                            setSelected(r);
                            setSearch("");
                          }}
                        >
                          <span>
                            {r.title}
                            <small>
                              {r.kind} · {companyName(r.company)}
                            </small>
                          </span>
                          <ArrowUpRight size={14} />
                        </Button>
                      ))
                    ) : (
                      <p>No matching records</p>
                    )}
                  </div>
                )}
              </div>
            )}
            <span className="top-divider" />
            <Button
              className="command-trigger"
              aria-label="Quick actions"
              onClick={() => setCommandOpen(true)}
            >
              <Command size={16} />
              <span>Quick actions</span>
              <kbd>⌘ K</kbd>
            </Button>
            <ThemeToggle />
            <Button
              className="icon-button notification-button"
              aria-label="Open notifications"
              onClick={() => openView("notifications")}
            >
              <Bell size={19} />
              {notificationItems.some(
                (n) => !readNotifications.includes(n.id),
              ) && <i />}
            </Button>
            <Button
              className="avatar small-avatar profile-trigger"
              aria-label="My profile"
              onClick={() => openView("profile")}
            >
              {actor.name
                .split(" ")
                .map((x) => x[0])
                .slice(0, 2)
                .join("")}
            </Button>
          </div>
        </header>
        {preview && (
          <div className="preview-bar">
            <Sparkles size={13} />
            <span>
              Interactive preview <b>·</b> Fictional data, saved only in this
              browser.
            </span>
            <span className="preview-right">
              Preview data · not connected to the workspace database
            </span>
          </div>
        )}
        <main
          id="main"
          className="main-content page-enter"
          key={selfService ? "my-requests" : view || `${module}-${company}`}
        >
          {selfService ? (
            <MyRequests actor={actor} preview={preview} />
          ) : view ? (
            <>
              {view === "profile" && (
                <ProfilePage
                  actor={actor}
                  preview={preview}
                  onAppearance={() => openView("appearance")}
                />
              )}
              {view === "appearance" && <AppearancePage />}
              {view === "notifications" && (
                <NotificationsPage
                  items={notificationItems}
                  read={readNotifications}
                  onRead={(id) => markRead([id])}
                  onReadAll={() => markRead(notificationItems.map((n) => n.id))}
                  onOpen={(id) => {
                    const record = scoped.records.find((r) => r.id === id);
                    if (record) setSelected(record);
                    else
                      setToast(
                        "This update has no record available in your access scope.",
                      );
                  }}
                />
              )}
              {view === "access" && canManageUsers(actor) && (
                <>
                  <PageTitle
                    title="Access control"
                    subtitle="Manage who can use each company and module."
                  />
                  <UserAdmin actor={actor} preview={preview} />
                </>
              )}
              {view === "shortcuts" && (
                <ShortcutsPage onCommand={() => setCommandOpen(true)} />
              )}
            </>
          ) : (
            <>
              <div className={`page-heading${module === "overview" && !executive ? " is-my-day" : ""}`}>
                <div>
                  {module === "overview" && executive && (
                    <p className="welcome-message">
                      Welcome back, {actor.name.split(" ")[0]}{" "}
                      <span>— here’s your business at a glance.</span>
                    </p>
                  )}
                  {/* On the employee home, My Day provides the heading, so the
                      executive framing is omitted rather than stacked on top. */}
                  {!(module === "overview" && !executive) && (
                    <>
                      <div className="eyebrow">
                        {module === "overview"
                          ? "PERFORMANCE & OPERATIONS"
                          : "ENERCORE WORKSPACE"}
                      </div>
                      <h1>
                        {module === "overview"
                          ? company === "All companies"
                            ? "Group dashboard"
                            : `${companyName(company)} dashboard`
                          : labels[module]}
                      </h1>
                      <p>
                        {module === "overview"
                          ? company === "All companies"
                            ? "Consolidated view of your assigned companies."
                            : `Performance and activity for ${companyName(company)}.`
                          : subtitles[module]}
                      </p>
                    </>
                  )}
                </div>
                <div className="heading-actions">
                  {module === "overview" && !selfService && !view && (
                    <Field className="company-switch period-switch">
                      <CalendarRange size={16} />
                      <Select aria-label="Dashboard time range" value={period} onChange={(e) => setPeriod(e.target.value)}>
                        <option value="all">All time</option>
                        <option value="1">Today</option>
                        <option value="7">Last 7 days</option>
                        <option value="30">Last 30 days</option>
                        <option value="90">Last 90 days</option>
                        <option value="365">Last 12 months</option>
                        <option value="custom">Custom dates</option>
                      </Select>
                    </Field>
                  )}
                  {module === "overview" && !selfService && !view && period === "custom" && (
                    <>
                      <Input type="date" aria-label="Dashboard start date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
                      <Input type="date" aria-label="Dashboard end date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
                    </>
                  )}
                  {/* Hidden where it changes nothing: on views that ignore the
                      company scope, and when there is only one company. */}
                  {!view && !selfService && actor.companies.length > 1 && (
                  <Field className="company-switch">
                    {company !== "All companies" ? (
                      <BrandLogo company={company} className="switch-logo" />
                    ) : (
                      <Building2 size={16} />
                    )}
                    <Select
                      aria-label="Company"
                      value={company}
                      onChange={(e) => {
                        setCompany(e.target.value);
                        window.history.replaceState(
                          null,
                          "",
                          workspaceUrl(selfService ? "my-requests" : view || module, e.target.value),
                        );
                      }}
                    >
                      <option>All companies</option>
                      {actor.companies.map((c) => (
                        <option key={c} value={c}>
                          {companyName(c)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  )}
                  {newLabels[module] &&
                    canWrite(actor, {
                      kind:
                        module === "hr"
                          ? hrTab === "people"
                            ? "hr"
                            : "leave"
                          : module,
                      company:
                        company === "All companies"
                          ? actor.companies[0]
                          : company,
                      branch: actor.branches[0] || "Main",
                      ownerId: actor.id,
                    } as RecordItem) && (
                      <Button
                        className="primary"
                        onClick={() =>
                          setForm(
                            module === "hr"
                              ? hrTab === "people"
                                ? "hr"
                                : "leave"
                              : (module as Kind),
                          )
                        }
                      >
                        <Plus size={17} />
                        {module === "hr" && hrTab === "leave"
                          ? "Request leave"
                          : newLabels[module]}
                      </Button>
                    )}
                </div>
              </div>
              {error && (
                <div className="error" role="alert">
                  {error}
                  <Button
                    className="icon-button"
                    aria-label="Dismiss error"
                    onClick={() => setError("")}
                  >
                    <X size={15} />
                  </Button>
                </div>
              )}
              {!loaded ? (
                // The page keeps its own shape while data arrives: an
                // executive sees the attention block and KPI row, an employee
                // sees their day, a list keeps its toolbar and loses only its
                // rows. Nothing moves when the data lands.
                module === "overview" ? (
                  executive ? <SkeletonDashboard /> : <SkeletonMyDay />
                ) : (
                  <SkeletonList />
                )
              ) : module === "overview" ? (
                <Overview
                  records={records}
                  actor={actor}
                  executive={executive}
                  onFollowUp={setFollowUp}
                  onQuickAdd={(kind) => setQuickAdd({ open: true, kind })}
                  busy={busy}
                  approvals={approvals}
                  attention={attention}
                  audit={scoped.audit}
                  onSelect={setSelected}
                  go={go}
                  company={company}
                  period={period}
                  from={periodFrom}
                  to={periodTo}
                />
              ) : module === "approvals" ? (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        Decisions to make{" "}
                        <span className="count">{approvals.length}</span>
                      </h2>
                      <p>Review the details before approving.</p>
                    </div>
                    <ShieldCheck size={22} />
                  </div>
                  {approvals.length ? (
                    approvals.map((r) => (
                      <div className="approval-row" key={r.id}>
                        <div className="record-icon">
                          <FileText size={20} />
                        </div>
                        <Button
                          className="record-link"
                          onClick={() => setSelected(r)}
                        >
                          {r.title}
                          <small>
                            {r.kind === "leave"
                              ? "Leave request"
                              : money(r.amount, r.currency)}{" "}
                            · {companyName(r.company)} · {r.owner}
                          </small>
                        </Button>
                        <Button
                          className="secondary"
                          disabled={busy}
                          onClick={() => update(r, "Rejected")}
                        >
                          Reject
                        </Button>
                        <Button
                          className="primary"
                          disabled={busy}
                          onClick={() => update(r, "Approved")}
                        >
                          <Check size={15} />
                          Approve
                        </Button>
                      </div>
                    ))
                  ) : (
                    <Empty
                      title="All caught up"
                      detail="There are no requests you can approve right now."
                    />
                  )}
                </section>
              ) : module === "activity" ? (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Workspace activity</h2>
                    <span className="muted small">Most recent first</span>
                  </div>
                  <ActivityList
                    events={scoped.audit.filter(
                      (a) =>
                        company === "All companies" || a.company === company,
                    )}
                  />
                </section>
              ) : module === "settings" ? (
                <Settings actor={actor} preview={preview} />
              ) : (
                <>
                  <div className="module-metrics">
                    {[
                      {
                        label: "Total records",
                        value: visible.length,
                        icon: Box,
                      },
                      {
                        label: "Needs attention",
                        value: visible.filter((r) =>
                          [
                            "Pending Approval",
                            "Overdue",
                            "Delayed",
                            "Open",
                          ].includes(r.status),
                        ).length,
                        icon: Clock,
                      },
                      {
                        label: "Companies",
                        value: new Set(visible.map((r) => r.company)).size,
                        icon: Building2,
                      },
                    ].map((s) => (
                      <div className="mini-stat" key={s.label}>
                        <s.icon size={18} />
                        <span>{s.label}</span>
                        <b>{s.value}</b>
                      </div>
                    ))}
                  </div>
                  {module === "accounts" && <Cashbook records={records} actor={actor} company={company} onAdd={() => { setEditing(null); setForm("accounts"); }} onOpen={setSelected} />}
                  <section className="panel records-panel">
                    <div className="records-toolbar">
                      <div className="toolbar-title">
                        {module === "hr" ? (
                          <div className="segmented">
                            <Button
                              className={hrTab === "people" ? "selected" : ""}
                              onClick={() => {
                                setHrTab("people");
                                setFilter("All statuses");
                              }}
                            >
                              People
                            </Button>
                            <Button
                              className={hrTab === "leave" ? "selected" : ""}
                              onClick={() => {
                                setHrTab("leave");
                                setFilter("All statuses");
                              }}
                            >
                              Leave requests
                            </Button>
                          </div>
                        ) : (
                          <>
                            <h2>
                              {module === "leads"
                                ? "Your opportunities"
                                : module === "accounts" ? "Invoices" : labels[module]}
                            </h2>
                            <span className="count">{visible.length}</span>
                          </>
                        )}
                      </div>
                      <div className="toolbar-actions">
                        {kanbanView && (
                        <Field className="status-filter">
                          <Filter size={14} />
                          <Select
                            aria-label="Filter by status"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                          >
                            <option>All statuses</option>
                            {stages[activeKind as Kind]?.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </Select>
                        </Field>
                        )}
                        {(module === "leads" ||
                          cardModules.includes(module)) && (
                          <div className="segmented">
                            <Button
                              aria-label={
                                module === "leads" ? "Board view" : "Card view"
                              }
                              className={board ? "selected" : ""}
                              onClick={() => setBoard(true)}
                            >
                              <LayoutGrid size={16} />
                            </Button>
                            <Button
                              aria-label="List view"
                              className={!board ? "selected" : ""}
                              onClick={() => setBoard(false)}
                            >
                              <List size={16} />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                    {visible.length === 0 ? (
                      <Empty
                        detail={
                          search
                            ? "Try a different search."
                            : "New records will appear here."
                        }
                      />
                    ) : module === "leads" && board ? (
                      <div className="kanban">
                        {[
                          "New",
                          "Contacted",
                          "Qualified",
                          "Quote Sent",
                          "Negotiation",
                          "Won",
                          "Lost",
                          "On Hold",
                        ]
                          .filter(
                            (s) => filter === "All statuses" || s === filter,
                          )
                          .map((s) => (
                            <section key={s} className="kanban-column">
                              <div className="kanban-title">
                                <span>
                                  <i />
                                  {s}
                                </span>
                                <b>
                                  {visible.filter((r) => r.status === s).length}
                                </b>
                              </div>
                              {visible
                                .filter((r) => r.status === s)
                                .map((r) => (
                                  <div className="record-card-shell pipeline-card-shell" key={r.id}>
                                  <Button
                                    className="lead-card"
                                    onClick={() => setSelected(r)}
                                  >
                                    <Company name={r.company} />
                                    <h3>{r.title}</h3>
                                    <p>{r.product}</p>
                                    <strong>
                                      {money(r.amount, r.currency)}
                                    </strong>
                                    <div className="lead-card-footer">
                                      <span>
                                        <Clock size={12} />
                                        {r.due}
                                      </span>
                                      <span className="tiny-avatar">
                                        {r.owner
                                          .split(" ")
                                          .map((x) => x[0])
                                          .join("")}
                                      </span>
                                    </div>
                                  </Button>
                                  <RecordIcons record={r} actor={actor} onEdit={r => { setMutationError(""); setEditing(r); setForm(r.kind); }} onDelete={r => { setMutationError(""); setDeleting(r); }} />
                                  </div>
                                ))}
                              <Button
                                className="add-column"
                                disabled={
                                  !canWrite(actor, {
                                    kind: "leads",
                                    company:
                                      company === "All companies"
                                        ? actor.companies[0]
                                        : company,
                                    branch: actor.branches[0] || "Main",
                                    ownerId: actor.id,
                                  } as RecordItem)
                                }
                                onClick={() => setForm("leads")}
                              >
                                <Plus size={13} />
                                Add opportunity
                              </Button>
                            </section>
                          ))}
                      </div>
                    ) : cardModules.includes(module) && board ? (
                      <RecordCards records={visible} onSelect={setSelected} actor={actor} onEdit={r => { setMutationError(""); setEditing(r); setForm(r.kind); }} onDelete={r => { setMutationError(""); setDeleting(r); }} onLog={setLogging} onStatus={(r, status) => { void update(r, status).then(() => setPrompt({ record: r, status })); }} onImport={isImportable(module) ? () => setImporting(true) : undefined} />
                    ) : (
                      <RecordTable records={visible} onSelect={setSelected} actor={actor} onEdit={r => { setMutationError(""); setEditing(r); setForm(r.kind); }} onDelete={r => { setMutationError(""); setDeleting(r); }} onLog={setLogging} onStatus={(r, status) => { void update(r, status).then(() => setPrompt({ record: r, status })); }} onImport={isImportable(module) ? () => setImporting(true) : undefined} />
                    )}
                  </section>
                  {["orders", "accounts", "logistics"].includes(module) && (
                    <div className="workflow-note">
                      <Sparkles size={16} />
                      <span>
                        Accept an approved quotation to create the connected
                        order, shipment and draft invoice automatically.
                      </span>
                      <Button onClick={() => go("quotations")}>
                        Open quotations <ArrowRight size={14} />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
      <DialogPresence>
        {form && (
          <RecordForm
            records={scoped.records}
            initial={editing || (form === "quotations" ? quoteSource : null)}
            editing={Boolean(editing)}
            saveError={mutationError}
            kind={form}
            actor={actor}
            company={company}
            busy={busy}
            onClose={() => {
              if (busy) return;
              setForm(null);
              setQuoteSource(null);
            }}
            onSave={editing ? saveEdit : create}
          />
        )}
      </DialogPresence>
      <DialogPresence>
        {commandOpen && (
          <CommandMenu
            onClose={() => setCommandOpen(false)}
            items={[
              ...Object.entries(newLabels)
                .filter(([m]) =>
                  canWrite(actor, {
                    kind: m === "hr" ? "hr" : m,
                    company:
                      company === "All companies"
                        ? actor.companies[0]
                        : company,
                    branch: actor.branches[0] || "Main",
                    ownerId: actor.id,
                  } as RecordItem),
                )
                .map(([m, label]) => ({
                  id: `create-${m}`,
                  label: label!,
                  detail: "Create · Quick action",
                  run: () => {
                    go(m as Module);
                    setForm(m === "hr" ? "hr" : (m as Kind));
                  },
                })),
              ...permitted.map((m) => ({
                id: m,
                label: labels[m],
                detail: "Open workspace page",
                run: () => go(m),
              })),
              ...Object.entries(viewLabels)
                .filter(([v]) => v !== "access" || canManageUsers(actor))
                .map(([v, label]) => ({
                  id: v,
                  label,
                  detail: "Workspace tools",
                  run: () => openView(v as WorkspaceView),
                })),
              {
                id: "my-requests",
                label: "My requests",
                detail: "Leave and support self-service",
                run: openSelfService,
              },
              ...actor.companies.map((c) => ({
                id: `company-${c}`,
                label: `${companyName(c)} dashboard`,
                detail: "Company performance",
                run: () => go("overview", c),
              })),
              ...scoped.records.map((r) => ({
                id: r.id,
                label: r.title,
                detail: `${companyName(r.company)} · ${recordProfiles[r.kind].noun}`,
                record: true,
                run: () => setSelected(r),
              })),
            ]}
          />
        )}
      </DialogPresence>
      <DialogPresence>
        {selectedCurrent && (
          <Detail
            record={selectedCurrent}
            actor={actor}
            busy={busy}
            onClose={() => setSelected(null)}
            onEdit={() => { setMutationError(""); setEditing(selectedCurrent); setSelected(null); setForm(selectedCurrent.kind); }}
            onDelete={() => { setMutationError(""); setDeleting(selectedCurrent); setSelected(null); }}
            onUpdate={(s) => update(selectedCurrent, s)}
            onAction={(action) => extraAction(selectedCurrent, action)}
            onQuote={() => {
              setQuoteSource(selectedCurrent);
              setSelected(null);
              setForm("quotations");
            }}
          />
        )}
      </DialogPresence>
      <DialogPresence>
        {logging && (
          <LogActivity
            record={logging}
            busy={busy}
            onLog={(text, due) => logActivity(logging, text, due)}
            onClose={() => setLogging(null)}
          />
        )}
      </DialogPresence>
      <DialogPresence>
        {quickAdd.open && (
          <QuickAdd
            actor={actor}
            company={company === "All companies" ? actor.companies[0] : company}
            branch={actor.branches[0] || "Main"}
            initialKind={quickAdd.kind}
            onCreate={create}
            onClose={() => setQuickAdd({ open: false })}
            onOpenFullForm={(kind) => { setMutationError(""); setEditing(null); setForm(kind); }}
          />
        )}
      </DialogPresence>
      <DialogPresence>
        {importing && isImportable(module) && (
          <ImportDialog
            kind={module as ImportableKind}
            company={company === "all-companies" ? actor.companies[0] : company}
            branch={actor.branches[0] || "Main"}
            actor={actor}
            existing={records}
            onClose={() => setImporting(false)}
            onDone={reload}
          />
        )}
      </DialogPresence>
      <DialogPresence>{deleting && <Dialog title="Delete record?" className="delete-record-dialog" onClose={() => { if (!busy) { setSelected(deleting); setDeleting(null); } }}>
        <p className="delete-record-name">{deleting.title}</p>
        <p className="muted">{companyName(deleting.company)} · {deleting.id}</p>
        <p>{deletionReason(deleting, data.records) || "This removes the record from the workspace. Its audit history is retained. It will not delete related records."}</p>
        {mutationError && <p className="error" role="alert">{mutationError}</p>}
        <DialogActions><div className="form-footer">
          <Button className="secondary" disabled={busy} onClick={() => { setSelected(deleting); setDeleting(null); }}>Cancel</Button>
          {!deletionReason(deleting, data.records) && <Button className="danger-button" disabled={busy} loading={busy} onClick={deleteRecord}>Delete record</Button>}
        </div></DialogActions>
      </Dialog>}</DialogPresence>
      {prompt && (
        <div className="after-action" role="status">
          <span>
            {prompt.record.title} is now <b>{prompt.status}</b>. Set the next follow-up?
          </span>
          <FollowUpControl
            compact
            busy={busy}
            onChoose={(date) => { void setFollowUp(prompt.record, date); setPrompt(null); }}
            onClear={() => setPrompt(null)}
          />
          <Button className="icon-button" aria-label="Dismiss" onClick={() => setPrompt(null)}>
            <X size={15} />
          </Button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
type RecordActionsProps = {
  actor: Actor;
  onEdit: (r: RecordItem) => void;
  onDelete: (r: RecordItem) => void;
  onImport?: () => void;
  /** Inline status change; omitted where a row must not be changed in place. */
  onStatus?: (r: RecordItem, status: string) => void;
  /** Opens the quick activity log; omitted for kinds nobody contacts. */
  onLog?: (r: RecordItem) => void;
};

/** Kinds where "I contacted them" is a real event. */
const LOGGABLE = ["leads", "customers", "suppliers", "quotations", "orders"];
/** The next action, with its date kept as secondary detail. */
function NextActionCell({ record }: { record: RecordItem }) {
  const action = nextAction(record);
  return (
    <span className="next-action-cell">
      <span className={`next-action tone-${action.tone}`}>{action.label}</span>
      {record.due && (
        <small className="muted cell-date">
          <CalendarDays size={12} aria-hidden="true" />
          {record.due}
        </small>
      )}
    </span>
  );
}

function RecordIcons({ record, actor, onEdit, onDelete, onStatus, onLog }: RecordActionsProps & { record: RecordItem }) {
  if (!canWrite(actor, record)) return null;
  const options = stages[record.kind] || [];
  return <span className="record-icon-actions">
    {/* Logging a contact is the most frequent thing that happens to a record
        and should never require opening it. */}
    {onLog && LOGGABLE.includes(record.kind) && (
      <Button
        className="icon-button log-activity-trigger"
        title="Log activity"
        aria-label={`Log activity for ${record.title}`}
        onClick={(e) => { e.stopPropagation(); onLog(record); }}
      >
        <Phone size={15} />
      </Button>
    )}
    {/* Advancing a record is the most repeated action in the CRM, so it
        happens in the row. It still goes through the same authenticated,
        audited, version-guarded update as the full dialog. */}
    {onStatus && options.length > 1 && (
      <Select
        className="inline-status"
        aria-label={`Status for ${record.title}`}
        value={record.status}
        onChange={(e) => onStatus(record, e.target.value)}
        onClick={(e) => e.stopPropagation()}
      >
        {options.map((s) => <option key={s}>{s}</option>)}
      </Select>
    )}
    <Button className="icon-button" title="Edit record" aria-label={`Edit ${record.title}`} onClick={() => onEdit(record)}><Pencil size={16} /></Button>
    <Button className="icon-button delete-action" title="Delete record" aria-label={`Delete ${record.title}`} onClick={() => onDelete(record)}><Trash2 size={16} /></Button>
  </span>;
}
/**
 * Exports the filtered list as CSV. Company and kind come from the records
 * themselves, so this needs no extra props and cannot name a scope the rows do
 * not belong to. The rows are already permission-scoped and filtered by the
 * caller; nothing extra is fetched.
 */
function exportRecords(records: RecordItem[]) {
  if (!records.length) return;
  const first = records[0];
  downloadCsv(
    exportFilename(first.company, labels[first.kind as Module] || first.kind),
    recordsToCsv(records),
  );
}

function RecordCards({
  records,
  onSelect,
  onImport,
  ...actions
}: {
  records: RecordItem[];
  onSelect: (r: RecordItem) => void;
} & RecordActionsProps) {
  const pagination = usePagination(records);
  return (
    <>
      <ListFilters
        {...pagination}
        label="records"
        exportCount={pagination.matched.length}
        onExport={() => exportRecords(pagination.matched as RecordItem[])}
        onImport={onImport}
      />
      <div className="record-grid">
        {pagination.items.map((r) => {
          const description =
            r.kind === "hr"
              ? r.contact
              : r.kind === "customers"
                ? r.contact
                : r.kind === "marketing"
                  ? r.product
                  : r.product || r.detail;
          return (
            <div className="record-card-shell" key={r.id}>
            <Button
              className="collection-card"
              onClick={() => onSelect(r)}
            >
              {/* The avatar identifies the record and the page already names
                  the module, so the separate module glyph row is dropped. */}
              <div className="collection-identity">
                <Avatar name={r.title} size={36} />
                <div>
                  <h3>{r.title}</h3>
                  <p>
                    {description ||
                      (r.kind === "leave" && `${r.quantity} working days`) ||
                      "Details available in record"}
                  </p>
                </div>
                <Badge status={r.status} />
              </div>
              <Company name={r.company} />
              <div className="collection-bottom">
                <span>
                  {r.kind === "products"
                    ? `${r.quantity.toLocaleString()} ${r.unit}`
                    : r.kind === "marketing"
                      ? `${r.quantity} leads`
                      : r.kind === "hr"
                        ? r.detail || r.owner
                        : r.kind === "customers"
                          ? r.owner
                          : r.due}
                </span>
                {["products", "marketing"].includes(r.kind) && r.amount > 0 ? (
                  <strong>{money(r.amount, r.currency)}</strong>
                ) : (
                  <ArrowUpRight size={16} />
                )}
              </div>
            </Button>
            <RecordIcons record={r} {...actions} />
            </div>
          );
        })}
      </div>
      <ListEmpty {...pagination} label="records" />
      <Pagination {...pagination} label="records" />
    </>
  );
}
function RecordTable({
  records,
  onSelect,
  onImport,
  ...actions
}: {
  records: RecordItem[];
  onSelect: (r: RecordItem) => void;
} & RecordActionsProps) {
  const pagination = usePagination(records);
  return (
    <>
      <ListFilters
        {...pagination}
        label="records"
        sortable={false}
        exportCount={pagination.matched.length}
        onExport={() => exportRecords(pagination.matched as RecordItem[])}
        onImport={onImport}
      />
      {pagination.total > 0 && <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <SortHeader sortKey="name" query={pagination.query} setQuery={pagination.setQuery}>Record / Customer</SortHeader>
              <SortHeader sortKey="company" query={pagination.query} setQuery={pagination.setQuery}>Company</SortHeader>
              <SortHeader sortKey="product" query={pagination.query} setQuery={pagination.setQuery}>Product / Details</SortHeader>
              <SortHeader sortKey="amount" query={pagination.query} setQuery={pagination.setQuery}>Value</SortHeader>
              <SortHeader sortKey="status" query={pagination.query} setQuery={pagination.setQuery}>Status</SortHeader>
              <SortHeader sortKey="due" query={pagination.query} setQuery={pagination.setQuery}>Next action</SortHeader>
              <SortHeader sortKey="owner" query={pagination.query} setQuery={pagination.setQuery}>Created by</SortHeader>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagination.items.map((r) => (
              <tr key={r.id}>
                <td>
                  <Button className="record-link avatar-name" onClick={() => onSelect(r)}>
                    <Avatar name={r.title} size={32} />
                    <span>
                      {r.title}
                      <small>
                        {r.id} · {r.contact || r.owner}
                      </small>
                    </span>
                  </Button>
                </td>
                <td>
                  <Company name={r.company} />
                </td>
                <td>
                  <span className="truncate">
                    {r.product || r.detail || "—"}
                  </span>
                  <small>
                    {r.quantity
                      ? `${r.quantity.toLocaleString()} ${r.unit}`
                      : ""}
                  </small>
                </td>
                <td className="amount">
                  {r.amount ? money(r.amount, r.currency) : "—"}
                </td>
                <td>
                  <Badge status={r.status} />
                </td>
                {/* The derived next action replaces a bare date: it says what
                    to do as well as when, so nobody opens a record to find
                    out. The date remains visible underneath. */}
                <td>
                  <NextActionCell record={r} />
                </td>
                <td>
                  {r.owner ? (
                    <span className="avatar-name"><Avatar name={r.owner} size={26} /><span>{r.owner}</span></span>
                  ) : "—"}
                </td>
                <td>
                  <div className="table-record-actions">
                  <RecordIcons record={r} {...actions} />
                  <Button
                    className="icon-button"
                    aria-label={`Open ${r.title}`}
                    onClick={() => onSelect(r)}
                  >
                    <ArrowUpRight size={16} />
                  </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      <ListEmpty {...pagination} label="records" />
      <Pagination {...pagination} label="records" />
    </>
  );
}
function Overview({
  records: allRecords,
  actor,
  approvals,
  attention,
  audit,
  onSelect,
  go,
  company,
  period,
  from,
  to,
  executive,
  onFollowUp,
  onQuickAdd,
  busy,
}: {
  records: RecordItem[];
  actor: Actor;
  approvals: RecordItem[];
  attention: RecordItem[];
  audit: Audit[];
  onSelect: (r: RecordItem) => void;
  go: (m: Module, company?: string) => void;
  company: string;
  period: string;
  from: string;
  to: string;
  /** Executives get the company view; everyone else gets their own day. */
  executive: boolean;
  onFollowUp: (r: RecordItem, date: string) => Promise<void> | void;
  onQuickAdd: (kind?: Kind) => void;
  busy?: boolean;
}) {
  const [showAllAttention, setShowAllAttention] = useState(false);
  const custom = period === "custom";
  const reversed = custom && Boolean(from && to && from > to);
  const incomplete = custom && !(from && to);
  const lower = custom ? from : period === "all" ? "" : windowStart(Number(period));
  const upper = custom ? to : period === "all" ? "" : localISO(new Date());
  const records = reversed ? [] : allRecords.filter(r => (!lower || r.createdAt.slice(0,10) >= lower) && (!upper || r.createdAt.slice(0,10) <= upper));
  const scopeNote = reversed
    ? "The end date is before the start date, so no records are in scope. Adjust either date."
    : incomplete
      ? `Choose both a start and an end date. Until then ${from || to ? "only one bound is applied" : "all dates are included"}.`
      : records.length === 0
        ? "No records were created in this period. Choose a wider range to see metrics and charts."
        : "";
  const leads = records.filter((r) => r.kind === "leads");
  const orders = records.filter(
    (r) =>
      r.kind === "orders" &&
      ["Confirmed", "In Progress", "Completed"].includes(r.status),
  );
  const shipments = records.filter(
    (r) =>
      r.kind === "logistics" && !["Delivered", "Cancelled"].includes(r.status),
  );
  const invoices = records.filter((r) => r.kind === "accounts" && !isCashEntry(r));
  const usd = (rs: RecordItem[]) =>
    rs.filter((r) => r.currency === "USD").reduce((a, r) => a + r.amount, 0);
  const pipeline = usd(
    leads.filter((r) => !["Won", "Lost"].includes(r.status)),
  );
  const allowed = allowedModules(actor);
  // Order value and demand rankings are only shown to roles that work with
  // that data; HR or IT sign-ins get their own modules instead.
  const commercial = ["leads", "orders", "quotations"].some((m) => allowed.includes(m as Module));
  const kind = (k: Kind) => records.filter((r) => r.kind === k);
  const people = kind("hr");
  const leave = kind("leave");
  const tickets = kind("it");
  const campaigns = kind("marketing");
  const quotes = kind("quotations");
  const customers = kind("customers");
  const suppliers = kind("suppliers");
  const catalogue = kind("products");
  const pad = (n: number) => String(n).padStart(2, "0");
  // Each module contributes its own cards, so a role never lands on a
  // dashboard with gaps where another role's cards would have been.
  const cards: Partial<Record<Module, {
    label: string; value: string; sub: string; icon: typeof Target; to: Module; accent: string;
  }[]>> = {
    leads: [{
      label: "Open pipeline",
      value: shortMoney(pipeline),
      sub: `${leads.filter((r) => !["Won", "Lost"].includes(r.status)).length} active opportunities · USD value only`,
      icon: Target, to: "leads", accent: "mint",
    }],
    orders: [{
      label: "Confirmed orders",
      value: shortMoney(usd(orders)),
      sub: `${orders.length} orders in your workspace · USD value only`,
      icon: Package, to: "orders", accent: "blue",
    }],
    logistics: [{
      label: "Active shipments",
      value: pad(shipments.length),
      sub: `${shipments.filter((r) => r.status === "Delayed").length} need your attention`,
      icon: Truck, to: "logistics", accent: "purple",
    }],
    accounts: [
      {
        label: "Invoices awaiting payment",
        value: shortMoney(
          invoices
            .filter((r) => r.currency === "USD" && !["Paid", "Cancelled"].includes(r.status))
            .reduce((sum, r) => sum + outstanding(r), 0),
        ),
        sub: `${invoices.filter((r) => r.status === "Overdue").length} overdue invoices · USD value only`,
        icon: Wallet, to: "accounts", accent: "gold",
      },
      {
        label: "Invoices raised",
        value: pad(invoices.length),
        sub: `${invoices.filter((r) => r.status === "Paid").length} settled in this period`,
        icon: FileText, to: "accounts", accent: "blue",
      },
    ],
    hr: [
      {
        label: "People",
        value: pad(people.length),
        sub: `${people.filter((r) => r.status === "Active").length} active · ${people.filter((r) => r.status === "On Leave").length} on leave`,
        icon: Users, to: "hr", accent: "mint",
      },
      {
        label: "Leave requests",
        value: pad(leave.filter((r) => r.status === "Pending Approval").length),
        sub: `${leave.length} requests in this period`,
        icon: CalendarDays, to: "hr", accent: "gold",
      },
    ],
    it: [
      {
        label: "Open tickets",
        value: pad(tickets.filter((r) => r.status !== "Resolved").length),
        sub: `${tickets.filter((r) => r.status === "In Progress").length} in progress`,
        icon: Monitor, to: "it", accent: "purple",
      },
      {
        label: "Resolved tickets",
        value: pad(tickets.filter((r) => r.status === "Resolved").length),
        sub: `${tickets.length} raised in this period`,
        icon: ShieldCheck, to: "it", accent: "mint",
      },
    ],
    marketing: [
      {
        label: "Campaigns",
        value: pad(campaigns.length),
        sub: `${campaigns.filter((r) => r.status === "Active").length} running now`,
        icon: Globe2, to: "marketing", accent: "gold",
      },
      {
        label: "Leads recorded",
        value: pad(campaigns.reduce((sum, r) => sum + (r.quantity || 0), 0)),
        sub: "Captured against campaigns, not attributed revenue",
        icon: Target, to: "marketing", accent: "blue",
      },
    ],
    quotations: [{
      label: "Open quotations",
      value: pad(quotes.filter((r) => !["Accepted", "Rejected", "Expired"].includes(r.status)).length),
      sub: `${quotes.filter((r) => r.status === "Accepted").length} accepted in this period`,
      icon: FileText, to: "quotations", accent: "blue",
    }],
    customers: [{
      label: "Customers",
      value: pad(customers.length),
      sub: `${customers.filter((r) => r.status === "Active").length} active accounts`,
      icon: Users, to: "customers", accent: "mint",
    }],
    suppliers: [{
      label: "Suppliers",
      value: pad(suppliers.length),
      sub: `${suppliers.filter((r) => r.status === "Active").length} active suppliers`,
      icon: Building2, to: "suppliers", accent: "purple",
    }],
    products: [{
      label: "Products",
      value: pad(catalogue.length),
      sub: `${catalogue.filter((r) => r.status === "Low Stock").length} marked low stock`,
      icon: Box, to: "products", accent: "gold",
    }],
  };
  // Business importance order. A role only ever sees cards for the modules it
  // has, so a narrow role still fills the row from its own modules.
  const cardOrder: Module[] = ["leads", "orders", "logistics", "accounts", "hr", "it", "marketing", "quotations", "customers", "suppliers", "products"];
  const metrics = cardOrder
    .filter((m) => allowed.includes(m))
    .flatMap((m) => cards[m] || [])
    .slice(0, 4);

  // The cards a role already gets from its own modules. Kept for everyone:
  // they are the role's summary, and dropping them for non-executives would
  // trade one useful thing for another rather than adding.
  const roleCards = metrics.length > 0 && (
    <div className="stats-grid">
      {metrics.map((m) => (
        <Button className={`stat-card metric-${m.accent}`} key={m.label} onClick={() => go(m.to)}>
          <div className="stat-top">
            <span>{m.label}</span>
            <div className={`stat-icon ${m.accent}`}><m.icon size={18} /></div>
          </div>
          <strong>{m.value}</strong>
          <div className="stat-bottom"><span>{m.sub}</span><ArrowUpRight size={15} /></div>
        </Button>
      ))}
    </div>
  );

  // Someone whose job is to contact people today should not open with a
  // company performance report. They get their own work first, with the action
  // attached, and their module summary underneath.
  if (!executive)
    return (
      <>
        <MyDay
          actor={actor}
          records={allRecords}
          company={company}
          onOpen={onSelect}
          onFollowUp={onFollowUp}
          onQuickAdd={onQuickAdd}
          onGo={(m) => go(m as Module)}
          busy={busy}
        />
        {roleCards}
      </>
    );

  // Exceptions first: the executive view leads with what needs a decision,
  // then the numbers, then the analysis. Ranked by business impact so the
  // most costly problem is the first thing read.
  const rankedAll = attentionItems(actor, allRecords);
  // Five is what fits the first screen beside the brief and the KPI strip.
  // The rest are one click away rather than pushing the numbers off-screen.
  const ranked = showAllAttention ? rankedAll : rankedAll.slice(0, 5);

  return (
    <>
      <MorningBrief actor={actor} records={allRecords} onGo={(m) => go(m as Module)} />
      {ranked.length > 0 && (
        <section className="panel attention-section tone-urgent command-attention">
          <div className="panel-heading">
            <h2><AlertTriangle size={16} /> Needs attention</h2>
            <span className="attention-count">{rankedAll.length}</span>
          </div>
          <ul className="attention-list">
            {ranked.map((item) => (
              <li key={item.id} className={`attention-row sev-${item.severity}`}>
                <Button className="record-link attention-open" onClick={() => onSelect(item.record)}>
                  <span className="my-day-title">{item.record.title}</span>
                  <small>
                    <span className={`attention-tag sev-${item.severity}`}>{item.category}</span>
                    {item.reason}
                    {item.record.amount ? ` · ${money(item.record.amount, item.record.currency)}` : ""}
                    {item.record.owner ? ` · ${item.record.owner}` : ""}
                  </small>
                </Button>
                {item.action === "follow-up" && (
                  <FollowUpMenu busy={busy} onChoose={(date) => void onFollowUp(item.record, date)} />
                )}
              </li>
            ))}
          </ul>
          {rankedAll.length > ranked.length && (
            <Button className="secondary attention-more" onClick={() => setShowAllAttention(true)}>
              View all {rankedAll.length} <ArrowRight size={14} />
            </Button>
          )}
        </section>
      )}
      <p className="dashboard-scope">
        <span>Metrics and charts use record creation date. Daily focus remains current.</span>
        {scopeNote && <span className="dashboard-period-note" role={reversed ? "alert" : "status"}>{scopeNote}</span>}
      </p>
      <section className="insight-banner">
        <div className="insight-icon">
          <Sparkles size={21} />
        </div>
        <div>
          <b>Your daily focus</b>
          <p>
            {approvals.length || attention.length ? (
              <>
                {approvals.length} {approvals.length === 1 ? "approval" : "approvals"} and{" "}
                {attention.length} {attention.length === 1 ? "item needs" : "items need"} attention.
              </>
            ) : (
              "No outstanding actions."
            )}
          </p>
        </div>
        <Button
          onClick={() =>
            go(
              approvals.length
                ? "approvals"
                : allowed.includes("leads")
                  ? "leads"
                  : allowed.includes("it")
                    ? "it"
                    : "hr",
            )
          }
        >
          Review actions <ArrowRight size={16} />
        </Button>
      </section>
      {metrics.length > 0 && <div className="stats-grid">
        {metrics.map((m) => (
          <Button
            className={`stat-card metric-${m.accent}`}
            key={m.label}
            onClick={() => go(m.to)}
          >
            <div className="stat-top">
              <span>{m.label}</span>
              <div className={`stat-icon ${m.accent}`}>
                <m.icon size={18} />
              </div>
            </div>
            <strong>{m.value}</strong>
            <div className="stat-bottom">
              <span>{m.sub}</span>
              <ArrowUpRight size={15} />
            </div>
          </Button>
        ))}
      </div>}
      {commercial && (
        <DashboardInsights actor={actor} records={records} onSelect={onSelect} />
      )}
      <div className="overview-grid">
        {commercial && <section className="panel performance">
          <div className="panel-heading">
            <div>
              <h2>Business performance</h2>
              <p>Order value and open pipeline by company</p>
            </div>
            <span className="unit-tag">USD only</span>
          </div>
          <div className="chart-summary">
            <strong>{shortMoney(usd(orders) + pipeline)}</strong>
            <span>
              Orders + open opportunities
              <br />
              <small>Current workspace snapshot</small>
            </span>
          </div>
          <div
            className="bar-chart"
            role="img"
            aria-label="Order and pipeline values by company"
          >
            {(company === "All companies" ? actor.companies : [company]).map(
              (c) => {
                const p = usd(
                  leads.filter(
                    (r) =>
                      r.company === c && !["Won", "Lost"].includes(r.status),
                  ),
                );
                const o = usd(orders.filter((r) => r.company === c));
                const max = Math.max(
                  1,
                  ...actor.companies.map((c) =>
                    usd(
                      records.filter(
                        (r) =>
                          r.company === c &&
                          ["orders", "leads"].includes(r.kind),
                      ),
                    ),
                  ),
                );
                return (
                  <div className="chart-column" key={c}>
                    <div className="bar-pair">
                      <div
                        className="bar orders"
                        role="button"
                        tabIndex={0}
                        aria-label={`${c} confirmed orders: ${money(o)}. Open orders`}
                        onClick={() => go("orders", c)}
                        onKeyDown={e => { if(e.key === "Enter" || e.key === " "){e.preventDefault();go("orders", c);} }}
                        style={{
                          height: `${Math.max(o ? 4 : 0, (o / max) * 100)}%`,
                        }}
                        title={`${c} orders: ${money(o)}`}
                      >
                        <span>{shortMoney(o)}</span>
                      </div>
                      <div
                        className="bar pipeline"
                        role="button"
                        tabIndex={0}
                        aria-label={`${c} pipeline: ${money(p)}. Open sales pipeline`}
                        onClick={() => go("leads", c)}
                        onKeyDown={e => { if(e.key === "Enter" || e.key === " "){e.preventDefault();go("leads", c);} }}
                        style={{
                          height: `${Math.max(p ? 4 : 0, (p / max) * 100)}%`,
                        }}
                        title={`${c} pipeline: ${money(p)}`}
                      >
                        <span>{shortMoney(p)}</span>
                      </div>
                    </div>
                    <span className="chart-label">{companyName(c)}</span>
                  </div>
                );
              },
            )}
          </div>
          <div className="chart-legend">
            <span>
              <i />
              Confirmed orders
            </span>
            <span>
              <i />
              Open pipeline
            </span>
          </div>
        </section>}
        <section className="panel attention-panel">
          <div className="panel-heading">
            <div>
              <h2>Needs your attention</h2>
              <p>Pending approvals and overdue work.</p>
            </div>
            <span className="count">{attention.length + approvals.length}</span>
          </div>
          {[...approvals, ...attention].slice(0, 4).map((r, i) => (
            <Button
              className="attention-row"
              key={r.id}
              onClick={() => onSelect(r)}
            >
              <span className={`attention-icon ${i % 2 ? "amber" : "mint"}`}>
                {r.status === "Pending Approval" ? (
                  <ShieldCheck size={18} />
                ) : (
                  <Clock size={18} />
                )}
              </span>
              <span>
                <b>
                  {r.status === "Pending Approval"
                    ? "Approval requested"
                    : r.status === "Delayed"
                      ? "Shipment delayed"
                      : "Follow-up needed"}
                </b>
                <small>{r.title}</small>
                <em>
                  {companyName(r.company)} ·{" "}
                  {r.kind === "quotations"
                    ? money(r.amount, r.currency)
                    : r.due}
                </em>
              </span>
              <ChevronRight size={16} />
            </Button>
          ))}
          {!attention.length && !approvals.length && (
            <Empty title="All clear" detail="No urgent items in your scope." />
          )}
          <div className="panel-bottom">
            <ShieldCheck size={14} /> Visible only within your access scope
          </div>
        </section>
      </div>
      <div className="overview-lower">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                {allowed.includes("logistics")
                  ? "Shipment watch"
                  : "Recent records"}
              </h2>
              <p>
                {allowed.includes("logistics")
                  ? "Active deliveries and expected arrival dates."
                  : "Your latest workspace updates."}
              </p>
            </div>
            {allowed.includes("logistics") && (
              <Button className="text-button" onClick={() => go("logistics")}>
                View all <ArrowRight size={14} />
              </Button>
            )}
          </div>
          {(allowed.includes("logistics") ? shipments : records)
            .slice(0, 3)
            .map((r) => (
              <Button
                key={r.id}
                className="shipment-row"
                onClick={() => onSelect(r)}
              >
                <span className="shipment-symbol">
                  <Truck size={19} />
                </span>
                <span>
                  <b>{r.title}</b>
                  <small>{r.detail || r.product || r.kind}</small>
                </span>
                <Badge status={r.status} />
                <span className="shipment-date">
                  <small>EXPECTED</small>
                  {r.due}
                </span>
                <ArrowUpRight size={16} />
              </Button>
            ))}
          {!(allowed.includes("logistics") ? shipments : records).length && (
            <Empty />
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Workspace activity</h2>
              <p>Recent updates in your access scope.</p>
            </div>
            <Activity size={19} />
          </div>
          <ActivityList
            paginated={false}
            events={audit
              .filter(
                (a) => company === "All companies" || a.company === company,
              )
              .slice(0, 3)}
          />
        </section>
      </div>
    </>
  );
}
/** Splits "leads: Quote Sent → Qualified" into a subject and a change. */
function activityParts(action: string) {
  const at = action.indexOf(":");
  if (at < 0) return { area: "", change: action };
  return { area: action.slice(0, at).trim(), change: action.slice(at + 1).trim() };
}
const activityWhen = (at: string) =>
  new Date(at).toLocaleString("en-GB", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

function ActivityList({
  events,
  paginated = true,
}: {
  events: Audit[];
  paginated?: boolean;
}) {
  const pagination = usePagination(events);
  const [detail, setDetail] = useState<Audit | null>(null);
  if (!events.length)
    return (
      <Empty
        title="No activity yet"
        detail="Authorised activity will appear here."
      />
    );
  // The dashboard widget keeps the compact timeline; the full page uses the
  // table, which fills the available width and opens each entry.
  if (!paginated)
    return (
      <div className="activity-list">
        {events.map((a) => (
          <div className="activity-item" key={a.id}>
            <span className="activity-dot" />
            <div>
              <b>{a.actor}</b>
              <p>{a.action}</p>
              <small>
                {companyName(a.company)} · {activityWhen(a.at)}
              </small>
            </div>
          </div>
        ))}
      </div>
    );
  return (
    <>
      <ListFilters {...pagination} label="events" sortable={false} />
      {pagination.total > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <SortHeader sortKey="actor" query={pagination.query} setQuery={pagination.setQuery}>Person</SortHeader>
                <SortHeader sortKey="action" query={pagination.query} setQuery={pagination.setQuery}>What changed</SortHeader>
                <SortHeader sortKey="company" query={pagination.query} setQuery={pagination.setQuery}>Company</SortHeader>
                <SortHeader sortKey="at" query={pagination.query} setQuery={pagination.setQuery}>When</SortHeader>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {pagination.items.map((a) => {
                const { area, change } = activityParts(a.action);
                return (
                  <tr key={a.id}>
                    <td>
                      <Button className="record-link avatar-name" onClick={() => setDetail(a)}>
                        <Avatar name={a.actor} size={32} />
                        <span>
                          {a.actor}
                          <small>{a.recordId}</small>
                        </span>
                      </Button>
                    </td>
                    <td>
                      <span className="truncate">{change}</span>
                      {area && <small>{labels[area as Module] || area}</small>}
                    </td>
                    <td>
                      <Company name={a.company} />
                    </td>
                    <td className="muted">
                      <span className="cell-date"><CalendarDays size={14} aria-hidden="true" />{activityWhen(a.at)}</span>
                    </td>
                    <td>
                      <div className="table-record-actions">
                        <Button
                          className="icon-button"
                          aria-label={`Open activity by ${a.actor}`}
                          onClick={() => setDetail(a)}
                        >
                          <ArrowUpRight size={16} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ListEmpty {...pagination} label="events" />
      <Pagination {...pagination} label="events" />
      <DialogPresence>
        {detail && (
          <Dialog
            title="Activity detail"
            className="record-detail-dialog"
            onClose={() => setDetail(null)}
          >
            <p className="detail-summary">
              <strong>{detail.actor}</strong> {activityParts(detail.action).change}
            </p>
            <dl className="detail-grid">
              {([
                ["Person", detail.actor],
                // Only present when the action names an area, e.g. "leads: …".
                ...(activityParts(detail.action).area
                  ? [["Area", labels[activityParts(detail.action).area as Module] || activityParts(detail.action).area]]
                  : []),
                ["Change", activityParts(detail.action).change],
                ["Company", companyName(detail.company)],
                // Account events reference a user, not a business record.
                [detail.subject === "account" ? "Account" : "Record", detail.recordId || "—"],
                ["When", new Date(detail.at).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" })],
              ] as [string, string][]).map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="muted small">
              Audit entries are a record of what changed. They cannot be edited
              or removed.
            </p>
          </Dialog>
        )}
      </DialogPresence>
    </>
  );
}
function Detail({
  record: r,
  actor,
  busy,
  onClose,
  onUpdate,
  onQuote,
  onAction,
  onEdit,
  onDelete,
}: {
  record: RecordItem;
  actor: Actor;
  busy: boolean;
  onClose: () => void;
  onUpdate: (s: string) => void;
  onQuote: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAction: (
    action:
      | { action: "note"; text: string; due?: string }
      | { action: "payment"; amountCents: number; reference: string },
  ) => Promise<void>;
}) {
  const writable = canWrite(actor, r);
  const fields = detailFields(r);
  const filledFields = fields.filter(
    ([, value]) => value.trim() && value !== "—",
  );
  const missingFields = fields.filter(
    ([, value]) => !value.trim() || value === "—",
  );
  return (
    <Dialog title={r.title} onClose={onClose} className="record-detail-dialog">
      <div className="record-context">
        <span className="record-kind">
          {isCashEntry(r) ? `${r.attributes?.entryType} entry` : recordProfiles[r.kind].noun} · {r.id}
        </span>
        <Company name={r.company} />
        <Badge status={r.status} />
      </div>
      {r.kind === "quotations" && (
        <>
          <DialogActions>
            <Button
              className="secondary print-button"
              onClick={() => window.print()}
            >
              <Download size={16} />
              Print / Save PDF
            </Button>
          </DialogActions>
          <QuotationDocument record={r} />
        </>
      )}
      {r.kind !== "quotations" && (
        <>
          <div
            className={`detail-grid ${filledFields.length <= 4 ? "detail-grid-small" : ""}`}
          >
            {filledFields.map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          {!!missingFields.length && (
            <details className="missing-record-fields">
              <summary>
                {missingFields.length}{" "}
                {missingFields.length === 1 ? "field" : "fields"} not provided
              </summary>
              <p>{missingFields.map(([label]) => label).join(" · ")}</p>
            </details>
          )}
          {!!r.detail?.trim() && (
            <div className="detail-notes">
              <h3>{recordProfiles[r.kind].notes}</h3>
              <p>{r.detail}</p>
            </div>
          )}
          {!!r.lines?.length && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Unit price</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.description}</td>
                      <td>{l.quantity}</td>
                      <td>{money(l.unitPriceCents / 100, r.currency)}</td>
                      <td>
                        {money(
                          Math.round(l.quantity * l.unitPriceCents) / 100,
                          r.currency,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(r.email || r.phone || r.destination) && (
            <p className="muted small">
              {[r.email, r.phone, r.destination].filter(Boolean).join(" · ")}
            </p>
          )}
          {r.parentId && (
            <p className="muted small">Connected record: {r.parentId}</p>
          )}
        </>
      )}
      {writable && (
        <DialogActions>
          <div className="detail-actions">
            <div className="detail-edit-actions">
            <Button className="secondary" disabled={busy} onClick={onEdit}>Edit record</Button>
            <Button className="secondary delete-action" disabled={busy} onClick={onDelete}>Delete</Button>
            </div>
            <Field>
              Update status
              <Select
                value={r.status}
                disabled={busy}
                onChange={(e) => onUpdate(e.target.value)}
              >
                {(isCashEntry(r) ? ["Recorded", "Cancelled"] : stages[r.kind]).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            {r.kind === "leads" && (
              <Button className="primary" onClick={onQuote}>
                Create quotation <ArrowRight size={15} />
              </Button>
            )}
            {r.kind === "quotations" && r.status === "Approved" && (
              <Button
                className="primary"
                disabled={busy}
                onClick={() => onUpdate("Accepted")}
              >
                Accept & create order <ArrowRight size={15} />
              </Button>
            )}
          </div>
        </DialogActions>
      )}
      {r.kind === "accounts" && !isCashEntry(r) && (
        <DialogActions>
          <Button
            className="secondary print-button"
            onClick={() => window.print()}
          >
            <Download size={16} />
            Print / Save PDF
          </Button>
        </DialogActions>
      )}
      <RecordActivity
        record={r}
        writable={writable}
        busy={busy}
        onAction={onAction}
      />
      <p className="record-timestamps">
        Created {new Date(r.createdAt).toLocaleDateString()} · Updated{" "}
        {new Date(r.updatedAt).toLocaleDateString()}
      </p>
    </Dialog>
  );
}
function Settings({ actor, preview }: { actor: Actor; preview: boolean }) {
  return (
    <div className="settings-grid">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Connected companies</h2>
            <p>Entities in your access scope</p>
          </div>
          <Building2 size={20} />
        </div>
        {actor.companies.map((c) => (
          <div className="settings-row" key={c}>
            <Company name={c} />

            <Badge status="Active" />
          </div>
        ))}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Your access</h2>
            <p>Permissions are enforced on the server.</p>
          </div>
          <ShieldCheck size={20} />
        </div>
        <div className="settings-body">
          <dl>
            <dt>Name</dt>
            <dd>{actor.name}</dd>
            <dt>Role</dt>
            <dd>{actor.role}</dd>
            <dt>Company scope</dt>
            <dd>{actor.companies.length} companies</dd>

            <dt>Environment</dt>
            <dd>{preview ? "Fictional preview" : "Cloudflare D1 workspace"}</dd>
          </dl>
          <p className="small muted">
            MD and IT can provision accounts above. Leadership access requires
            the MD. Deactivation revokes active sessions.
          </p>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Connection readiness</h2>
          <Monitor size={20} />
        </div>
        <div className="settings-body">
          <p>Database: {preview ? "Not connected" : "Configured"}</p>
          <p>Email & WhatsApp: Not connected</p>
          <p>Website enquiry integration: Not connected</p>
          <p className="small muted">
            External integrations are disabled until their credentials and
            routing are configured.
          </p>
        </div>
      </section>
    </div>
  );
}
