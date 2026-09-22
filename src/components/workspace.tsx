"use client";
import { companyName } from "@/lib/company-name";
import { salaryAttributes } from "@/lib/salary";
import { workspaceUrl, workspaceParams } from "@/lib/workspace-url";
import { Cashbook } from "./cashbook";
import { isCashEntry, cashEntryError } from "@/lib/cashbook";
import { mutateRecord, deletionReason } from "@/lib/record-mutations";
import { BrandLogo } from "./brand";
import DashboardInsights from "./dashboard-insights";
import { QuotationDocument } from "./quotation-document";
import { Pagination, usePagination } from "./pagination";
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
  Target,
  Truck,
  Users,
  Wallet,
  X,
  Monitor,
  CalendarDays,
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
  money,
  outstanding,
  scopedWorkspace,
  stages,
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
export default function Workspace({
  actor,
  preview,
  initialSelfService = false,
}: {
  actor: Actor;
  preview: boolean;
  initialSelfService?: boolean;
}) {
  const [selfService, setSelfService] = useState(initialSelfService);
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [readNotifications, setReadNotifications] = useState<string[]>([]);
  const [module, setModule] = useState<Module>("overview");
  const [company, setCompany] = useState("All companies");
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
  const [mutationError, setMutationError] = useState("");
  useEffect(() => { if (!form) { setEditing(null); setMutationError(""); } }, [form]);
  const [quoteSource, setQuoteSource] = useState<RecordItem | null>(null);
  const [selected, setSelected] = useState<RecordItem | null>(null);
  const [board, setBoard] = useState(true);
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
  const visible = records.filter(
    (r) =>
      r.kind === activeKind && !isCashEntry(r) &&
      (filter === "All statuses" || r.status === filter) &&
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
          body: JSON.stringify(values),
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
              MySQL ready · No live connection
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
              <div className="page-heading">
                <div>
                  {module === "overview" && (
                    <p className="welcome-message">
                      Welcome back, {actor.name.split(" ")[0]}{" "}
                      <span>— here’s your business at a glance.</span>
                    </p>
                  )}
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
                </div>
                <div className="heading-actions">
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
                <div className="loading-grid" aria-busy="true">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} />
                  ))}
                </div>
              ) : module === "overview" ? (
                <Overview
                  records={records}
                  actor={actor}
                  approvals={approvals}
                  attention={attention}
                  audit={scoped.audit}
                  onSelect={setSelected}
                  go={go}
                  company={company}
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
                      <RecordCards records={visible} onSelect={setSelected} actor={actor} onEdit={r => { setMutationError(""); setEditing(r); setForm(r.kind); }} onDelete={r => { setMutationError(""); setDeleting(r); }} />
                    ) : (
                      <RecordTable records={visible} onSelect={setSelected} actor={actor} onEdit={r => { setMutationError(""); setEditing(r); setForm(r.kind); }} onDelete={r => { setMutationError(""); setDeleting(r); }} />
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
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
type RecordActionsProps = { actor: Actor; onEdit: (r: RecordItem) => void; onDelete: (r: RecordItem) => void };
function RecordIcons({ record, actor, onEdit, onDelete }: RecordActionsProps & { record: RecordItem }) {
  if (!canWrite(actor, record)) return null;
  return <span className="record-icon-actions">
    <Button className="icon-button" title="Edit record" aria-label={`Edit ${record.title}`} onClick={() => onEdit(record)}><Pencil size={16} /></Button>
    <Button className="icon-button delete-action" title="Delete record" aria-label={`Delete ${record.title}`} onClick={() => onDelete(record)}><Trash2 size={16} /></Button>
  </span>;
}
function RecordCards({
  records,
  onSelect,
  ...actions
}: {
  records: RecordItem[];
  onSelect: (r: RecordItem) => void;
} & RecordActionsProps) {
  const pagination = usePagination(records);
  return (
    <>
      <div className="record-grid">
        {pagination.items.map((r) => {
          const Icon =
            r.kind === "logistics"
              ? Truck
              : r.kind === "products"
                ? Box
                : r.kind === "marketing"
                  ? Globe2
                  : r.kind === "it"
                    ? Monitor
                    : r.kind === "leave"
                      ? CalendarDays
                      : Users;
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
              <div className="collection-top">
                <span className="collection-icon">
                  <Icon size={20} />
                </span>
                <Badge status={r.status} />
              </div>
              <div>
                <h3>{r.title}</h3>
                <p>
                  {description ||
                    (r.kind === "leave" && `${r.quantity} working days`) ||
                    "Details available in record"}
                </p>
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
      <Pagination {...pagination} label="records" />
    </>
  );
}
function RecordTable({
  records,
  onSelect,
  ...actions
}: {
  records: RecordItem[];
  onSelect: (r: RecordItem) => void;
} & RecordActionsProps) {
  const pagination = usePagination(records);
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Record / Customer</th>
              <th>Company</th>
              <th>Product / Details</th>
              <th>Value</th>
              <th>Status</th>
              <th>Due date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagination.items.map((r) => (
              <tr key={r.id}>
                <td>
                  <Button className="record-link" onClick={() => onSelect(r)}>
                    {r.title}
                    <small>
                      {r.id} · {r.contact || r.owner}
                    </small>
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
                <td className="muted">{r.due}</td>
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
      </div>
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
}: {
  records: RecordItem[];
  actor: Actor;
  approvals: RecordItem[];
  attention: RecordItem[];
  audit: Audit[];
  onSelect: (r: RecordItem) => void;
  go: (m: Module, company?: string) => void;
  company: string;
}) {
  const [period, setPeriod] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const today = new Date();
  const lower = period === "custom" ? from : period === "all" ? "" : new Date(today.getTime() - (Number(period) - 1) * 86400000).toISOString().slice(0,10);
  const upper = period === "custom" ? to : period === "all" ? "" : today.toISOString().slice(0,10);
  const records = allRecords.filter(r => (!lower || r.createdAt.slice(0,10) >= lower) && (!upper || r.createdAt.slice(0,10) <= upper));
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
  const metrics = [
    {
      label: "Open pipeline",
      value: shortMoney(pipeline),
      sub: `${leads.filter((r) => !["Won", "Lost"].includes(r.status)).length} active opportunities`,
      icon: Target,
      to: "leads" as Module,
      accent: "mint",
    },
    {
      label: "Confirmed orders",
      value: shortMoney(usd(orders)),
      sub: `${orders.length} orders in your workspace`,
      icon: Package,
      to: "orders" as Module,
      accent: "blue",
    },
    {
      label: "Active shipments",
      value: String(shipments.length).padStart(2, "0"),
      sub: `${shipments.filter((r) => r.status === "Delayed").length} need your attention`,
      icon: Truck,
      to: "logistics" as Module,
      accent: "purple",
    },
    {
      label: "Invoices awaiting payment",
      value: shortMoney(
        invoices
          .filter(
            (r) =>
              r.currency === "USD" && !["Paid", "Cancelled"].includes(r.status),
          )
          .reduce((sum, r) => sum + outstanding(r), 0),
      ),
      sub: `${invoices.filter((r) => r.status === "Overdue").length} overdue invoices`,
      icon: Wallet,
      to: "accounts" as Module,
      accent: "gold",
    },
  ].filter((m) => allowed.includes(m.to));
  return (
    <>
      <div className="dashboard-period"><div><strong>Dashboard period</strong><small>Metrics and charts use record creation date. Daily focus remains current.</small></div><Select aria-label="Dashboard time range" value={period} onChange={e=>setPeriod(e.target.value)}><option value="all">All time</option><option value="1">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option><option value="custom">Custom dates</option></Select>{period === "custom" && <><Input type="date" aria-label="Dashboard start date" value={from} onChange={e=>setFrom(e.target.value)}/><Input type="date" aria-label="Dashboard end date" min={from} value={to} onChange={e=>setTo(e.target.value)}/></>}{from && to && from > to && period === "custom" && <span role="alert">Start date must be before end date.</span>}</div>
      <section className="insight-banner">
        <div className="insight-icon">
          <Sparkles size={21} />
        </div>
        <div>
          <b>Your daily focus</b>
          <p>
            {approvals.length || attention.length ? (
              <>
                {approvals.length} approvals and {attention.length} items need
                attention.
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
      <div className="stats-grid">
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
      </div>
      <DashboardInsights actor={actor} records={records} onSelect={onSelect} />
      <div className="overview-grid">
        <section className="panel performance">
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
        </section>
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
              className="attention-item"
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
function ActivityList({
  events,
  paginated = true,
}: {
  events: Audit[];
  paginated?: boolean;
}) {
  const pagination = usePagination(events);
  return events.length ? (
    <>
      <div className="activity-list">
        {(paginated ? pagination.items : events).map((a) => (
          <div className="activity-item" key={a.id}>
            <span className="activity-dot" />
            <div>
              <b>{a.actor}</b>
              <p>{a.action}</p>
              <small>
                {companyName(a.company)} ·{" "}
                {new Date(a.at).toLocaleString("en-GB", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </small>
            </div>
          </div>
        ))}
      </div>
      {paginated && <Pagination {...pagination} label="events" />}
    </>
  ) : (
    <Empty
      title="No activity yet"
      detail="Authorised activity will appear here."
    />
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
            <dd>{preview ? "Fictional preview" : "MySQL workspace"}</dd>
          </dl>
          {!preview && (
            <Button
              className="secondary"
              onClick={async () => {
                const response = await fetch("/api/auth", { method: "DELETE" });
                if (response.ok) window.location.href = "/login";
              }}
            >
              <LogOut size={16} />
              Sign out
            </Button>
          )}
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
