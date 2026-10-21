"use client";
import { CrmTable } from "@/components/ui/crm-table";
import {requestJson,readJsonResponse} from "@/lib/client-request";
import { companyName } from "@/lib/company-name";
import { operationsAccess } from "@/lib/operations/model";
import { recordsToCsv, exportFilename, downloadCsv } from "@/lib/export";
import { isImportable, type ImportableKind } from "@/lib/import";
import { attentionItems, isoDate, nextAction, operationalViews } from "@/lib/attention";
import { businessStampShort, businessDateTimeLong } from "@/lib/gst";
import frame from "./studio/frame.module.css";
import recordStyles from "./studio/records.module.css";
import LeadDesk from "./leads/lead-desk";
import { PipelineBoard } from "./leads/pipeline-board";
import { applyLeadFeedback, initializeLead, type LeadFeedbackAction } from "@/lib/lead-desk";
import { SkeletonDashboard, SkeletonRoleHome, SkeletonList, SkeletonPage } from "./ui/skeleton";
import { DialogSkeleton, DialogLoadingContext } from "./ui/dialog-skeleton";
import { AiCompanion } from "./ai/ai-companion";
import type { AiPageContext } from "@/lib/ai/page-context";
import WorkspaceBoot from "@/app/loading";
import { FollowUpMenu } from "./follow-up-control";
import { salaryAttributes } from "@/lib/salary";
import { workspaceUrl, workspaceParams } from "@/lib/workspace-url";
import { isCashEntry, cashEntryError } from "@/lib/cashbook";
import { mutateRecord, deletionReason } from "@/lib/record-mutations";
import { BrandLogo } from "./brand";
import { Pagination, ListFilters, ListEmpty, SortHeader, usePagination } from "./pagination";
import { emptyQuery, type ListQuery } from "@/lib/list-query";
import {
  Button,
  Input,
  Select,
  Textarea,
  Field,
} from "@/components/ui/controls";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  FileText,
  Globe2,
  LayoutDashboard,
  Columns3,
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
  Target,
  Truck,
  Users,
  Wallet,
  X,
  Monitor,
  CalendarDays,
  CalendarRange,
  Filter,
  type LucideIcon,
} from "lucide-react";
import {
  allowedModules,
  canApprove,
  canRead,
  canWrite,
  canManageUsers,
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
import { previewPeople } from "@/lib/team-preview";
import { mayOwn } from "@/lib/notification-rules";
import { transition, addNote, recordPayment, canAssign, assign, availableStatuses } from "@/lib/workflow";
import Sidebar from "./sidebar";
import {PageMotion} from "./page-motion";
import { TableExportProvider } from "./table-export";
import { BulkDeleteDialog, SelectionActions, SelectionCheckbox, SelectionHeader, SelectionCell, useRowSelection } from "./row-selection";
import { deletePreviewSelection, recordDeleteProblem, type BulkDeleteResult } from "@/lib/table-selection";
import { Dialog, DialogPresence, DialogActions } from "./ui/controls";
import { WorkspaceAccount } from "./workspace-account";
import { storedPreviewActor, previewActorKey } from "@/lib/fixtures";
import { RECORDS_CHANGED } from "@/lib/proactive/client";
import { Avatar } from "./avatar";
import { useAvatar } from "@/lib/avatar-store";
import { MetricTrend } from "./metric-trend";
import { RoleHome } from "./role-home";
import { roleHome } from "@/lib/role-home";
import { canCreateProforma, proformaError, proformaReference } from "@/lib/proforma";
import { isProforma, recordStages } from "@/lib/domain";
import { canProspect } from "@/lib/execution/model";
import { type ContentValues } from "./content-calendar";
import { contentError } from "@/lib/content-calendar";
import { recordProfiles } from "@/lib/record-profiles";
import { PageHeader, Surface } from "./ui/layout";
import { moduleHelp } from "@/lib/workspace-help";
import { quickCreateKinds, viewLabels, type WorkspaceView } from "@/lib/workspace-experience";
import { StatusBadge as Badge } from "./ui/status-badge";
import { RowActions, rowActionIcons } from "./ui/row-actions";
import { formatMoney, formatMoneyCompact, totalsByCurrency, describeTotals } from "@/lib/money-format";
import { recentRecords, rememberRecord, pinnedIds, togglePin, resolveVisible } from "@/lib/workspace-prefs";
import { NotificationsPage, NotificationToasts } from "./notification-center";
import { openPrejoin } from "@/lib/meeting-client";
import { installSessionRecovery } from "@/lib/session-client";
import { useNotifications, claimAlert, showDesktop } from "@/lib/notifications-client";
import { badgeCount, moduleForKind, titleWithCount, type NotificationView, type NotificationPreferences } from "@/lib/notification-types";
import Link from "next/link";
import dynamic from "next/dynamic";
import { hrAccess } from "@/lib/hr/model";
const HrWorkspace = dynamic(() => import("./hr/hr-workspace"), { loading: () => <SkeletonPage /> });
import { useCollabSummary } from "@/lib/collab-client";
import { HubSkeleton } from "./collaboration/skeletons";
import { MyDaySuggestions } from "./ai/sales-copilot";
import { applySuggestion, type Suggestion } from "@/lib/ai/client";

/** An AI task to start when a record opens. */
type AutoAi = "brief" | "draft" | "customer-brief";
type QuoteDraftPrefill = { leadId: string; product: string; quantity: number; unit: string; destination: string; incoterm: string; packaging: string; paymentTerms: string };

// Loaded only when someone opens Collaboration, so the rest of the CRM does
// not carry it. The skeleton keeps the three-pane shape while it arrives.
const panelLoading = () => <SkeletonPage />;
const StudioDashboard = dynamic(() => import("./studio/dashboard"), { loading: () => <SkeletonDashboard /> });
const MyDay = dynamic(() => import("./my-day"), { loading: panelLoading });
const WorkspaceSettings = dynamic(() => import("./workspace-settings"), { loading: panelLoading });
const OptionCatalogs = dynamic(() => import("./option-catalogs"), { loading: panelLoading });
const MyRequests = dynamic(() => import("./my-requests"), { loading: panelLoading });
const Prospecting = dynamic(() => import("./commercial/prospecting"), { loading: panelLoading });
const MailHub = dynamic(() => import("./mail-hub"), { loading: panelLoading });
const ContentCalendar = dynamic(() => import("./content-calendar"), { loading: panelLoading });
const Cashbook = dynamic(() => import("./cashbook").then(m => m.Cashbook), { loading: panelLoading });
const DashboardInsights = dynamic(() => import("./dashboard-insights"), { loading: panelLoading });
const ProfilePage = dynamic(() => import("./workspace-pages").then(m => m.ProfilePage), { loading: panelLoading });
const AppearancePage = dynamic(() => import("./workspace-pages").then(m => m.AppearancePage), { loading: panelLoading });
const ShortcutsPage = dynamic(() => import("./workspace-pages").then(m => m.ShortcutsPage), { loading: panelLoading });
const UserAdmin = dynamic(() => import("./user-admin"), { loading: panelLoading });
const RecordWorkspace = dynamic(() => import("./record/record-workspace"), { loading: panelLoading });
const RecordForm = dynamic(() => import("./record-form"), { loading: () => <PendingDialog /> });
const ProformaForm = dynamic(() => import("./proforma-form"), { loading: () => <PendingDialog /> });
const QuickAdd = dynamic(() => import("./quick-add"), { loading: () => <PendingDialog /> });
const ImportDialog = dynamic(() => import("./import-dialog"), { loading: () => <PendingDialog /> });
const LogActivity = dynamic(() => import("./log-activity"), { loading: () => <PendingDialog /> });
const AssignDialog = dynamic(() => import("./assign-dialog"), { loading: () => <PendingDialog /> });
const CommandMenu = dynamic(() => import("./command-menu"), { loading: () => <PendingDialog /> });
const QuotationSummary = dynamic(() => import("./quotation-document").then(m => m.QuotationSummary), { loading: panelLoading });
const QuotationDocument = dynamic(() => import("./quotation-document").then(m => m.QuotationDocument), { loading: () => <PendingDialog /> });
const MeetingLayer = dynamic(() => import("./meetings/meeting-layer"), { ssr: false });
const TodayMeetings = dynamic(() => import("./meetings/today-meetings"), { loading: panelLoading });
const AiWorkspace = dynamic(() => import("./ai/ai-chat"), { ssr: false, loading: ()=><SkeletonPage variant="chat"/> });
const ActionCenter = dynamic(() => import("./ai/action-center"), { ssr: false, loading: panelLoading });
const ActionDigest = dynamic(() => import("./ai/action-center").then((m) => m.ActionDigest), { ssr: false });
const TasksPage = dynamic(() => import("./tasks/tasks-page"), { ssr: false, loading: panelLoading });
const OperationsPage = dynamic(() => import("./operations/operations-page"), { ssr: false, loading: panelLoading });
const CollaborationHub = dynamic(() => import("./collaboration/collaboration-hub"), {
  ssr: false,
  loading: () => <HubSkeleton />,
});
function PendingDialog() {
  return <DialogSkeleton/>;
}
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
  overview: "What needs attention across your companies.",
  leads: "Buyer inquiries, prospects and supplier opportunities. One owner and a clear next step.",
  quotations: "Quotations in draft, awaiting approval, sent and accepted.",
  orders: "Confirmed orders handed over to operations.",
  logistics: "Shipments in progress and expected arrivals.",
  accounts: "Track invoices, payments, company income and expenses.",
  customers: "Companies you sell to, with their contacts and deals.",
  suppliers: "Supply partners, what they can supply and their offers.",
  products: "Products, grades and recorded availability.",
  hr: "People and leave requests.",
  marketing: "Campaigns and the enquiries they bring in.",
  it: "Support tickets and requests.",
  approvals: "Decisions waiting for you.",
  activity: "What changed, when and by whom.",
  settings: "Companies and access in your scope.",
};
const companyColors: Record<string, string> = {
  Petronik: "#169c88",
  Afrilube: "#d0a351",
  Petronex: "#668ee2",
  Istanegry: "#ac84ce",
  Enercore: "#178ca6",
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

type WorkspaceProps = { actor: Actor; preview: boolean; initialSelfService?: boolean; initialPath?: string; initialSearch?: string };
/** Never mount a privileged preview shell before its stored role is known.
 * This gate is presentation-only: live roles still come from the server. */
export default function Workspace(props: WorkspaceProps) {
  const [signedIn, setSignedIn] = useState<Actor | null>(null);
  useEffect(() => { if (props.preview) setSignedIn(storedPreviewActor()); }, [props.preview]);
  if (props.preview && !signedIn) return <WorkspaceBoot />;
  return <ReadyWorkspace {...props} actor={props.preview ? signedIn! : props.actor} />;
}
function ReadyWorkspace({
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
  // Before any child fetches: a lapsed session renews itself quietly (see
  // session-client). Preview has no sessions.
  useState(() => {
    if (!preview) installSessionRecovery();
  });
  // Derived from the server-supplied URL so a reload paints the requested page
  // immediately instead of flashing the overview first.
  const initial = routeFromUrl(actor, initialPath, initialSearch);
  const [selfService, setSelfService] = useState(initialSelfService || initial.selfService);
  const [view, setView] = useState<WorkspaceView | null>(initial.view);
  // Unread chat totals for the sidebar, from server-side read cursors.
  const { summary: collabSummary } = useCollabSummary(!preview);
  const [commandOpen, setCommandOpen] = useState(false);
  // When set, the palette lists the records in that operational slice.
  const [commandView, setCommandView] = useState<string | null>(null);
  // Local, per-person conveniences. Kept in state so pinning re-renders, and
  // read from storage on mount so the server render stays identical.
  const [recent, setRecent] = useState<ReturnType<typeof recentRecords>>([]);
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => {
    setRecent(recentRecords(actor.id));
    setPins(pinnedIds(actor.id));
  }, [actor.id]);
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
  const [moduleLoading, setModuleLoading] = useState<Module | null>(null);
  const loadedKinds = useRef(new Set<Module>());
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Record pages and the browser history: see openRecordPage below.
  const dataRef = useRef<WorkspaceData>({ records: [], audit: [] });
  const pendingRecord = useRef<string | null>(null);
  const recordPushed = useRef(false);
  const restoreOnClose = useRef(false);
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
      // The open conversation (?c=) is the Collaboration Hub's own state and
      // survives the canonical-URL rewrite, so a shared link opens the thread.
      const conversation = params.get("view") === "collaboration" ? params.get("c") : null;
      // …and a notification's deep link may also name the message (?m=).
      const message = conversation ? params.get("m") : null;
      // …as does Collaboration → Meetings (?tab=meetings&meeting=<id>).
      const meetingsTab = params.get("view") === "collaboration" && params.get("tab") === "meetings";
      const meeting = meetingsTab ? params.get("meeting") : null;
      const report = meetingsTab && params.get("mview") === "report";
      // An open record (?record=) is a page of its own and survives too.
      const recordId = params.get("record");
      const suffix = conversation
        ? `?c=${encodeURIComponent(conversation)}${message ? `&m=${encodeURIComponent(message)}` : ""}`
        : meetingsTab
          ? `?tab=meetings${meeting ? `&meeting=${encodeURIComponent(meeting)}${report ? "&mview=report" : ""}` : ""}`
          : recordId
            ? `?record=${encodeURIComponent(recordId)}`
            : "";
      window.history.replaceState(null, "", workspaceUrl(self ? "my-requests" : params.get("view") || requested || "overview", params.get("company") || "All companies") + suffix);
      setModule(
        requested && allowedModules(actor).includes(requested as Module)
          ? (requested as Module)
          : allowedModules(actor)[0] || "overview",
      );
      setForm(null);
      // Back from a record returns to the page underneath it, as it was.
      const known = recordId ? dataRef.current.records.find((r) => r.id === recordId && !r.deletedAt) : null;
      if (recordId && !known) pendingRecord.current = recordId;
      setSelected((current) => {
        if (current && !recordId) restoreOnClose.current = true;
        return known ?? null;
      });
      recordPushed.current = false;
      setMobile(false);
      setNotifications(false);
    };
    syncLocation();
    window.addEventListener("popstate", syncLocation);
    try {
      setCollapsed(
        localStorage.getItem("enercore-sidebar-collapsed") === "true",
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
  const [proformaSource, setProformaSource] = useState<RecordItem | null>(null);
  const [proformaOpen, setProformaOpen] = useState(false);
  const [editing, setEditing] = useState<RecordItem | null>(null);
  const [deleting, setDeleting] = useState<RecordItem | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState<RecordItem[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [quickAdd, setQuickAdd] = useState<{ open: boolean; kind?: Kind }>({ open: false });
  const canQuickAdd = quickCreateKinds(actor, company === "All companies" ? actor.companies[0] : company).length > 0;
  const [logging, setLogging] = useState<RecordItem | null>(null);
  const [assigning, setAssigning] = useState<RecordItem | null>(null);
  // After advancing a record, offer the follow-up rather than relying on the
  // person to remember. Dismissable, never blocking.
  const [prompt, setPrompt] = useState<{ record: RecordItem; status: string } | null>(null);
  /**
   * Who reads the company view rather than their own day.
   *
   * IT shares MD capabilities under the approved access policy, while keeping
   * its own identity and existing company/module restrictions.
   */
  const executive = ["MD", "MD Assistant", "IT Administrator", "Group Manager", "Branch Manager"].includes(actor.role);
  const [mutationError, setMutationError] = useState("");
  useEffect(() => { if (!form) { setEditing(null); setMutationError(""); setMutationFields({}); } }, [form]);
  // "n" opens quick add, the way a mail client opens a compose window. Ignored
  // while typing, so it never swallows a character mid-field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey || !canQuickAdd || document.querySelector('[role="dialog"]')) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      e.preventDefault();
      setQuickAdd({ open: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canQuickAdd]);
  /**
   * One key per create-form session. Sent with the submission so a
   * double-click, a retry or a dropped response resolves to the same record
   * instead of creating a second one. A new key is minted only when a create
   * form opens, so a genuine second record still gets its own.
   */
  const createKey = useRef("");
  useEffect(() => { if (form && !editing) createKey.current = crypto.randomUUID(); }, [form, editing]);
  const [quoteSource, setQuoteSource] = useState<RecordItem | null>(null);
  const [mailSource, setMailSource] = useState<RecordItem | null>(null);
  // What a lead form was started from, shown at the top of the form.
  const [leadContext, setLeadContext] = useState("");
  const [mutationFields, setMutationFields] = useState<Record<string, string>>({});
  // A starting record belongs to one form opening only.
  useEffect(() => {
    if (!form) {
      setQuoteSource(null);
      setMailSource(null);
      setLeadContext("");
    }
  }, [form]);
  const [selected, setSelected] = useState<RecordItem | null>(null);
  // The meeting screens cover the workspace. A record is a page, not a modal,
  // so it simply stays underneath — on the same tab and scroll — and is there
  // again when the meeting is left.
  const [board, setBoard] = useState(true);
  const [leadDeskOpen, setLeadDeskOpen] = useState(true);
  // The pipeline opens as a board; every other list opens as a table.
  useEffect(() => setBoard(module === "leads"), [module]);
  // One set of filters for a module's list, whichever layout shows it, so
  // switching between cards and the table keeps the search.
  const [listQuery, setListQuery] = useState<ListQuery>(emptyQuery);
  useEffect(() => setListQuery(emptyQuery), [module]);
  const sharedQuery = { query: listQuery, setQuery: setListQuery };
  // Dashboard period lives here so its control can sit beside the company filter.
  const [period, setPeriod] = useState("all");
  const [dashboardCurrency, setDashboardCurrency] = useState("USD");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [filter, setFilter] = useState("All statuses");
  const [notifications, setNotifications] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hrTab, setHrTab] = useState<"people" | "leave">("people");
  const permitted = allowedModules(actor);
  const isRecordModule = (m: Module) => Object.hasOwn(stages, m);
  async function reload() {
    const [base, page] = await Promise.all([
      requestJson<WorkspaceData>("/api/records",{},"Your workspace couldn’t refresh. Please try again."),
      isRecordModule(module) && module !== "leads" ? requestJson<WorkspaceData>(`/api/records?kind=${module}`) : Promise.resolve(null),
    ]);
    const combined = new Map(base.records.map(record => [record.id, record]));
    page?.records.forEach(record => combined.set(record.id, record));
    loadedKinds.current = new Set(page ? [module] : []);
    setData({records:[...combined.values()],audit:base.audit});
    // Open Action Center / My Day digests recompute from the new data.
    window.dispatchEvent(new Event(RECORDS_CHANGED));
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
  // A busy lead table must not crowd quotations, customers or people out of
  // the shared window. Fetch just the page opened, once until the next reload.
  useEffect(() => {
    if (preview || !loaded || view || !isRecordModule(module) || module === "leads" || loadedKinds.current.has(module)) return;
    const controller = new AbortController();
    setModuleLoading(module);
    void requestJson<WorkspaceData>(`/api/records?kind=${module}`,{signal:controller.signal})
      .then(result => {
        if (controller.signal.aborted) return;
        loadedKinds.current.add(module);
        setData(previous => ({ ...previous, records:[...previous.records.filter(record => module === "hr" ? !["hr","leave"].includes(record.kind) : record.kind !== module),...result.records] }));
      })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setModuleLoading(null); });
    return () => controller.abort();
  }, [module, view, preview, loaded]);
  // A layout effect, so a reloaded or linked record opens before the loaded
  // list is ever painted: the list must not flash up and vanish again.
  useLayoutEffect(() => {
    dataRef.current = data;
    const id = pendingRecord.current;
    if (!loaded || !id) return;
    pendingRecord.current = null;
    const record = data.records.find((r) => r.id === id && !r.deletedAt);
    if (record && canRead(actor, record)) setSelected(record);
  }, [data, loaded, actor]);
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
          if (kind === "leads") setQuickAdd({open:true,kind:"leads"}); else setForm(kind as Kind);
        }
      }
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        setNotifications(false);
        setMobile(false);
        const layered = document.querySelector('[role="dialog"], [data-radix-popper-content-wrapper]');
        // A meeting covers the record; Escape belongs to the meeting then.
        const inMeeting = !!document.documentElement.dataset.meeting;
        if (selected && !typing && !layered && !inMeeting) closeRecordRef.current();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [module, hrTab, view, selfService, form, selected, company, actor]);
  // Stable arrays prevent background refresh effects from restarting whenever
  // a menu, toast, filter or notification changes unrelated UI state.
  const scoped = useMemo(() => scopedWorkspace(actor, data), [actor, data]);
  const openView = (next: WorkspaceView, query = "") => {
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
      workspaceUrl(next, company) + query,
    );
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  /* ------------------------------------------------------ notifications */

  const [alerts, setAlerts] = useState<NotificationView[]>([]);
  const dismissAlert = (id: string) => setAlerts((list) => list.filter((n) => n.id !== id));
  /**
   * Goes where a notification points. Nothing here grants access: a record
   * is fetched through the normal records API (which applies the read rule)
   * and a conversation through the Collaboration Hub's own checks.
   */
  async function openNotification(n: NotificationView) {
    if (!n.readAt) void inbox.setRead([n.id], true);
    dismissAlert(n.id);
    const target = n.target;
    if (!target) {
      setToast("This item is no longer available to you.");
      return;
    }
    if (target.kind === "profile") return openView("profile");
    if (target.kind === "conversation") {
      if (view === "collaboration" && !selfService) {
        window.dispatchEvent(new CustomEvent("enercore:open-conversation", { detail: target }));
        return;
      }
      const query = `?c=${encodeURIComponent(target.conversationId)}${target.messageId ? `&m=${encodeURIComponent(target.messageId)}` : ""}`;
      return openView("collaboration", query);
    }
    // A meeting opens its pre-join screen; joining re-checks access.
    if (target.kind === "meeting") return openPrejoin(target.meetingId);
    if (target.kind === "task") {
      if (view === "tasks") window.dispatchEvent(new CustomEvent("enercore:open-task", { detail: { taskId: target.taskId } }));
      else openView("tasks", `?task=${encodeURIComponent(target.taskId)}`);
      return;
    }
    await openRecordById(target.recordKind, target.recordId);
  }
  /** Opens one record's detail through the normal records API (its read rule applies). */
  async function openRecordById(kind: Kind, id: string) {
    let record = data.records.find((r) => r.id === id && !r.deletedAt) ?? null;
    if (!record) {
      try {
        const response = await fetch(`/api/records?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (response.ok) record = ((await readJsonResponse(response,"We couldn’t confirm the latest information. Refresh to check it before trying again.")) as { record: RecordItem }).record;
      } catch {}
    }
    if (!record || !canRead(actor, record)) {
      setToast("This item is no longer available to you.");
      return;
    }
    const module = moduleForKind(kind);
    // From Enercore AI the record opens over the answers (their history is
    // kept only on that page); elsewhere its module opens behind it.
    if (permitted.includes(module) && view !== "ai") go(module, "All companies");
    if (kind === "leave") setHrTab("leave");
    setSelected(record);
  }
  // A meeting's related record, or a record's meeting page, from anywhere.
  const [autoAi, setAutoAi] = useState<{ id: string; task: AutoAi } | null>(null);
  async function startQuoteDraft(prefill: QuoteDraftPrefill) {
    let lead = data.records.find((r) => r.id === prefill.leadId && !r.deletedAt) ?? null;
    if (!lead) {
      try {
        const response = await fetch(`/api/records?id=${encodeURIComponent(prefill.leadId)}`, { cache: "no-store" });
        if (response.ok) lead = ((await readJsonResponse(response,"We couldn’t confirm the latest information. Refresh to check it before trying again.")) as { record: RecordItem }).record;
      } catch {}
    }
    if (!lead || !canRead(actor, lead)) {
      setToast("This lead is no longer available to you.");
      return;
    }
    // Known values only. The unit price stays 0 (amount 0) — never guessed.
    const source: RecordItem = {
      ...lead,
      product: prefill.product,
      quantity: prefill.quantity,
      unit: prefill.unit || lead.unit,
      destination: prefill.destination,
      amount: 0,
      detail: "",
      attributes: {
        ...(lead.attributes?.country ? { country: lead.attributes.country } : {}),
        ...(prefill.incoterm ? { incoterm: prefill.incoterm } : {}),
        ...(prefill.paymentTerms ? { paymentTerms: prefill.paymentTerms } : {}),
      },
      lines: [{ description: prefill.product || lead.title, quantity: prefill.quantity || 1, unitPriceCents: 0, ...(prefill.packaging ? { packaging: prefill.packaging } : {}) }],
    };
    setSelected(null);
    setQuoteSource(source);
    setForm("quotations");
  }
  const quoteDraftRef = useRef(startQuoteDraft);
  useEffect(() => {
    quoteDraftRef.current = startQuoteDraft;
  });
  const openRecordRef = useRef(openRecordById);
  const openViewRef = useRef(openView);
  const viewRef = useRef(view);
  useEffect(() => {
    openRecordRef.current = openRecordById;
    openViewRef.current = openView;
    viewRef.current = view;
  });
  useEffect(() => {
    const onRecord = (e: Event) => {
      const { kind, id, ai } = (e as CustomEvent<{ kind: Kind; id: string; ai?: AutoAi }>).detail;
      setAutoAi(ai ? { id, task: ai } : null);
      void openRecordRef.current(kind, id);
    };
    // Sales Copilot → "Create quotation draft": the ordinary quotation form,
    // pre-filled with known values only (no price), for the person to review.
    const onQuoteDraft = (e: Event) => void quoteDraftRef.current((e as CustomEvent<QuoteDraftPrefill>).detail);
    const onMeeting = (e: Event) => {
      const { meetingId, view: page } = (e as CustomEvent<{ meetingId: string; view: "details" | "report" }>).detail;
      setSelected(null);
      if (viewRef.current === "collaboration") window.dispatchEvent(new CustomEvent("enercore:meeting-details", { detail: { meetingId, view: page } }));
      else openViewRef.current("collaboration", `?tab=meetings&meeting=${encodeURIComponent(meetingId)}${page === "report" ? "&mview=report" : ""}`);
    };
    // A conversation (or one message in it), e.g. from an Enercore AI source.
    const onConversation = (e: Event) => {
      const { conversationId, messageId } = (e as CustomEvent<{ conversationId: string; messageId: string | null }>).detail;
      setSelected(null);
      if (viewRef.current === "collaboration") window.dispatchEvent(new CustomEvent("enercore:open-conversation", { detail: { conversationId, messageId } }));
      else openViewRef.current("collaboration", `?c=${encodeURIComponent(conversationId)}${messageId ? `&m=${encodeURIComponent(messageId)}` : ""}`);
    };
    // A task (from the Action Center or a notification): Tasks opens it.
    const onTask = (e: Event) => {
      if (viewRef.current === "tasks") return; // the Tasks page handles it
      const { taskId } = (e as CustomEvent<{ taskId: string }>).detail;
      setSelected(null);
      openViewRef.current("tasks", `?task=${encodeURIComponent(taskId)}`);
    };
    window.addEventListener("enercore:open-task", onTask);
    window.addEventListener("enercore:open-record", onRecord);
    window.addEventListener("enercore:open-meeting-page", onMeeting);
    window.addEventListener("enercore:open-conversation-link", onConversation);
    window.addEventListener("enercore:quote-draft", onQuoteDraft);
    return () => {
      window.removeEventListener("enercore:quote-draft", onQuoteDraft);
      window.removeEventListener("enercore:open-task", onTask);
      window.removeEventListener("enercore:open-record", onRecord);
      window.removeEventListener("enercore:open-meeting-page", onMeeting);
      window.removeEventListener("enercore:open-conversation-link", onConversation);
    };
  }, []);
  const selectedRef = useRef<RecordItem | null>(null);
  const placeRef = useRef<{ view: WorkspaceView | null; selfService: boolean }>({ view: null, selfService: false });
  useEffect(() => {
    selectedRef.current = selected;
    placeRef.current = { view, selfService };
  });
  /**
   * A live notification: one toast in the visible tab, or one desktop alert
   * from a background tab — coordinated so several open tabs alert once —
   * and nothing when the person is already looking at the thing itself.
   */
  async function onNotification(n: NotificationView, prefs: NotificationPreferences) {
    // Something changed somewhere: open Action Center views recompute.
    window.dispatchEvent(new Event(RECORDS_CHANGED));
    if (!(await claimAlert(actor.id, n.id))) return;
    const t = n.target;
    if (document.visibilityState === "visible") {
      // A ringing call already shows its own answer card.
      if (n.type === "meeting.invited") return;
      const place = placeRef.current;
      const inConversation =
        t?.kind === "conversation" &&
        place.view === "collaboration" &&
        !place.selfService &&
        new URLSearchParams(window.location.search).get("c") === t.conversationId;
      const onRecord = t?.kind === "record" && selectedRef.current?.id === t.recordId;
      if (inConversation || onRecord) return;
      setAlerts((list) => [n, ...list.filter((x) => x.id !== n.id)].slice(0, 3));
      setTimeout(() => dismissAlert(n.id), n.priority === "normal" ? 6000 : 9000);
      return;
    }
    showDesktop(n, prefs, () => void openNotification(n));
  }
  const inbox = useNotifications(!preview, (n, prefs) => void onNotification(n, prefs));
  const photo = useAvatar(actor.id);
  // "(4) Enercore …" in the tab, from the unified unread count.
  const baseTitle = useRef("");
  useEffect(() => {
    if (!baseTitle.current) baseTitle.current = document.title.replace(/^\(\d+\+?\) /, "");
    document.title = titleWithCount(baseTitle.current, inbox.unread);
  }, [inbox.unread]);
  const records = useMemo(() => scoped.records.filter(
    (r) => company === "All companies" || r.company === company,
  ), [scoped.records, company]);
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
  const kanbanView = module === "leads" && !leadDeskOpen;
  const visible = records.filter(
    (r) =>
      r.kind === activeKind && !isCashEntry(r) &&
      (!kanbanView || filter === "All statuses" || r.status === filter) &&
      `${r.title} ${r.product} ${r.contact} ${r.id} ${r.owner}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selectedCurrent = selected
    ? data.records.find((r) => r.id === selected.id) || selected
    : null;
  /**
   * A record is a page: it has a URL (?record=), Back returns to the page it
   * was opened from with its scroll position and focus, and the browser's
   * Back button does the same thing.
   */
  const recordOpener = useRef<HTMLElement | null>(null);
  const recordScroll = useRef(0);
  const openedRecord = useRef<string | null>(null);
  // Read on scroll, not when the record opens: by then the list is hidden and
  // the browser has already clamped the position to the shorter record page.
  const listScroll = useRef(0);
  useEffect(() => {
    const save = () => {
      if (!openedRecord.current) listScroll.current = window.scrollY;
    };
    save();
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, []);
  useLayoutEffect(() => {
    const id = selected?.id ?? null;
    if (id && !openedRecord.current) {
      recordOpener.current = document.activeElement as HTMLElement | null;
      recordScroll.current = listScroll.current;
      window.scrollTo({ top: 0, behavior: "instant" });
    } else if (id && id !== openedRecord.current) {
      window.scrollTo({ top: 0, behavior: "instant" });
    } else if (!id && openedRecord.current && restoreOnClose.current) {
      const opener = recordOpener.current;
      const y = recordScroll.current;
      requestAnimationFrame(() => {
        window.scrollTo({ top: y, behavior: "instant" });
        if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
      });
    }
    if (!id) restoreOnClose.current = false;
    openedRecord.current = id;
  }, [selected?.id]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const current = url.searchParams.get("record");
    const id = selected?.id ?? null;
    if (id === current) return;
    if (id) {
      url.searchParams.set("record", id);
      if (current) window.history.replaceState(null, "", url);
      else {
        window.history.pushState(null, "", url);
        recordPushed.current = true;
      }
    } else if (current) {
      url.searchParams.delete("record");
      window.history.replaceState(null, "", url);
    }
  }, [selected?.id]);
  function closeRecord() {
    restoreOnClose.current = true;
    if (recordPushed.current && new URL(window.location.href).searchParams.get("record")) {
      recordPushed.current = false;
      window.history.back();
    } else setSelected(null);
  }
  const closeRecordRef = useRef(closeRecord);
  useEffect(() => {
    closeRecordRef.current = closeRecord;
  });
  const reloadQuietly = useCallback(() => {
    if (!preview) void reload().catch(() => {});
    // reload only reads state setters; a stable identity keeps the record's
    // commercial data from refetching on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);
  // Remembering happens on open, not on render, so the list reflects what was
  // actually looked at.
  useEffect(() => {
    if (selected) setRecent(rememberRecord(actor.id, selected));
  }, [selected, actor.id]);
  const pin = (r: RecordItem) => {
    setPins(togglePin(actor.id, r.id));
    setToast(pins.includes(r.id) ? "Removed from pinned." : "Pinned.");
  };
  async function update(r: RecordItem, status: string) {
    setBusy(true);
    setError("");
    setToast("");
    setPrompt(null);
    try {
      if (preview) setData(transition(data, actor, r.id, status));
      else {
        const response = await fetch("/api/records", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: r.id, status }),
        });
        const result = await readJsonResponse(response,"We couldn’t confirm the latest information. Refresh to check it before trying again.");
        if (!response.ok) throw new Error(result.error);
        await reload();
      }
      setToast(
        status === "Accepted"
          ? "Order, shipment and draft invoice created."
          : `Updated to ${status}.`,
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update.");
      return false;
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
  /**
   * One Enercore AI suggestion the person reviewed and chose to apply: sent
   * through the ordinary records API (their rights, their audit entry).
   */
  async function applyAiSuggestion(s: Suggestion) {
    await applySuggestion(s);
    await reload();
    setToast("Change applied.");
  }
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
      | { action: "payment"; amountCents: number; reference: string }
      | LeadFeedbackAction,
  ) {
    setBusy(true);
    try {
      if (preview)
        setData(
          action.action === "lead-feedback"
            ? applyLeadFeedback(data, actor, { ...action, id: r.id, expectedUpdatedAt: r.updatedAt })
            : action.action === "note"
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
          body: JSON.stringify({ id: r.id, ...action, ...(action.action === "lead-feedback" ? { expectedUpdatedAt: r.updatedAt } : {}) }),
        });
        const result = await readJsonResponse(response,"We couldn’t confirm the latest information. Refresh to check it before trying again.");
        if (!response.ok) throw new Error(result.error);
        await reload();
        if (action.action === "lead-feedback" && result.record && selected?.id === r.id) setSelected(result.record);
      }
      setToast(
        action.action === "lead-feedback" ? "Lead outcome saved." : action.action === "note" ? "Activity saved." : "Payment recorded.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function saveContent(values: ContentValues, existing: RecordItem | null, requestId: string) {
    const problem = contentError(values);
    if (problem) throw new Error(problem);
    if (preview) {
      if (existing) setData(mutateRecord(data, actor, existing.id, existing.updatedAt, values));
      else {
        const now = new Date().toISOString();
        const record: RecordItem = {...values, id:`EC-${crypto.randomUUID().slice(0,8).toUpperCase()}`, status:'Planned', ownerId:actor.id, owner:actor.name, createdAt:now, updatedAt:now};
        if (!canWrite(actor,record)) throw new Error('You cannot plan content for this company.');
        setData({...data,records:[record,...data.records],audit:[{id:crypto.randomUUID(),actor:actor.name,recordId:record.id,company:record.company,action:'Created content plan',at:now},...data.audit]});
      }
    } else {
      const response = await fetch('/api/records',{method:existing?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(existing?{action:'edit',id:existing.id,expectedUpdatedAt:existing.updatedAt,values}:{...values,requestId})});
      const result = await readJsonResponse(response,"We couldn’t confirm the latest information. Refresh to check it before trying again.");
      if(!response.ok) throw new Error(result.error || 'Unable to save post plan.');
      await reload();
    }
    setToast('Post plan saved. Nothing was published.');
  }
  async function create(
    values: Omit<
      RecordItem,
      "id" | "status" | "ownerId" | "owner" | "createdAt" | "updatedAt"
    > & { assigneeId?: string },
    throwOnError = false,
  ) {
    setBusy(true);
    setMutationFields({});
    try {
      if (isCashEntry(values)) {
        const error = cashEntryError(values);
        if (error) throw new Error(error);
      }
      if (isProforma(values)) {
        const problem = proformaError(values);
        if (problem) throw new Error(problem);
      }
      if(values.kind === "hr") values.attributes = salaryAttributes(values.attributes);
      if (preview) {
        const now = new Date().toISOString();
        const { assigneeId, ...fields } = values;
        let record: RecordItem = initializeLead({
          ...fields,
          id: `EC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          status: isCashEntry(values) ? "Recorded" : stages[values.kind][0],
          ownerId: actor.id,
          owner: actor.name,
          createdAt: now,
          updatedAt: now,
        }, actor);
        if (!canWrite(actor, record))
          throw new Error("You do not have access to create this record.");
        if (assigneeId && values.kind === "leads") {
          const person = previewPeople(actor).find(p => p.id === assigneeId && mayOwn(p, record));
          if (!person) throw new Error("Choose an active salesperson with access to this brand.");
          record = { ...record, ownerId: person.id, owner: person.name, attributes: { ...record.attributes, leadOwnerRole: person.role } };
        }
        if (isProforma(record)) record.attributes = { ...record.attributes, quoteReference: proformaReference(record.id, record.attributes!.issuedDate) };
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
        const result = await readJsonResponse(response,"We couldn’t confirm the latest information. Refresh to check it before trying again.");
        if (!response.ok) {
          if (result.fields) setMutationFields(result.fields);
          throw new Error(result.error);
        }
        await reload();
        // Go where the work continues: the new customer, supplier, product or
        // lead opens, instead of a message about having saved it.
        if (["customers", "suppliers", "products", "leads"].includes(values.kind) && result.record) {
          setForm(null);
          setSelected(result.record as RecordItem);
          setToast(values.kind === "customers" && values.contact ? "Customer and main contact added." : `${recordProfiles[values.kind].noun} added.`);
          return;
        }
      }
      setForm(null);
      setProformaOpen(false);
      setProformaSource(null);
      setToast("Saved to your workspace.");
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : "Unable to save.");
      if (throwOnError) throw e;
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
        const result = await readJsonResponse(response,"We couldn’t confirm the latest information. Refresh to check it before trying again.");
        if (!response.ok) throw new Error(result.error);
        await reload();
      }
      setForm(null);
      setProformaOpen(false);
      if (selected?.id === editing.id) setSelected(editing);
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
        const result = await readJsonResponse(response,"We couldn’t confirm the latest information. Refresh to check it before trying again.");
        if (!response.ok) throw new Error(result.error);
        await reload();
      }
      setDeleting(null);
      setSelected(null);
      setToast("Record removed from the workspace; audit history retained.");
    } catch (error) { setMutationError(error instanceof Error ? error.message : "Unable to delete record."); }
    finally { setBusy(false); }
  }
  async function deleteSelectedRecords(rows: RecordItem[]): Promise<BulkDeleteResult> {
    if (rows.length > 100) throw new Error("Select up to 100 records at a time.");
    setBusy(true);
    try {
      if (preview) {
        const outcome = deletePreviewSelection(data, actor, rows);
        setData(outcome.workspace);
        return outcome.result;
      }
      const result: BulkDeleteResult = {deleted: [], failed: []};
      for (const row of rows) {
        try {
          // Reuse the normal authorised soft-delete endpoint. Each row keeps
          // its original version, linkage checks and individual audit event.
          const response = await fetch("/api/records", {method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"delete",id:row.id,expectedUpdatedAt:row.updatedAt})});
          const body = await readJsonResponse(response,"Deletion could not be confirmed. Refresh before trying again.");
          if (!response.ok) throw new Error(body.error || "Unable to delete this record.");
          result.deleted.push(row.id);
        } catch (e) {
          result.failed.push({id:row.id,title:row.title,reason:e instanceof Error ? e.message : "Deletion could not be confirmed. Refresh before trying again."});
        }
      }
      try { await reload(); } catch { result.refreshFailed = true; }
      return result;
    } finally {setBusy(false);}
  }
  // Board / cards versus list, shown in the list's own toolbar.
  const viewToggle = module !== "leads" && cardModules.includes(module) && (
    <Select aria-label="Display records as" value={board ? "cards" : "list"} onChange={event => setBoard(event.target.value === "cards")}>
      <option value="list">List view</option>
      <option value="cards">Card view</option>
    </Select>
  );
  // An empty list names what is missing and offers the one action that fills it.
  const addKind = (module === "hr" ? (hrTab === "people" ? "hr" : "leave") : module) as Kind;
  const canAdd = Boolean(newLabels[module]) && canWrite(actor, {
    kind: addKind,
    company: company === "All companies" ? actor.companies[0] : company,
    branch: actor.branches[0] || "Main",
    ownerId: actor.id,
  } as RecordItem);
  const emptyList = (
    <>
      <p><b>No {({ leads: "leads", orders: "sales orders", hr: hrTab === "people" ? "employees" : "leave requests", it: "tickets", marketing: "campaigns", accounts: "invoices" } as Partial<Record<Module, string>>)[module] || (labels[module] || "records").toLowerCase()} yet.</b></p>
      {canAdd && (
        <Button className="primary" onClick={() => addKind === "leads" ? setQuickAdd({open:true,kind:"leads"}) : setForm(addKind)}>
          <Plus size={16} aria-hidden="true" />
          {module === "hr" && hrTab === "leave" ? "Request leave" : newLabels[module]}
        </Button>
      )}
    </>
  );
  return (
    <DialogLoadingContext.Provider value={()=>{if(busy)return;setForm(null);setProformaOpen(false);setProformaSource(null);setEditing(null);setQuickAdd({open:false});setImporting(false);setLogging(null);setAssigning(null);setCommandOpen(false);setCommandView(null);}}><TableExportProvider actor={actor}><div data-design="studio" className={`app-shell ${frame.frame} ${collapsed ? `is-collapsed ${frame.collapsed}` : ""}`}>
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
        collabUnread={collabSummary.unread}
        collabMentions={collabSummary.mentions}
        onCollapse={toggleSidebar}
        onMobileChange={setMobile}
        onNavigate={go}
        onMyRequests={openSelfService}
        onView={openView}
      />
      <div className={frame.main}>
        <header className={frame.topbar}>
          <div className={frame.topLeft}>
            <Button
              className={frame.mobileMenu}
              onClick={() => setMobile(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </Button>
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <Button
                className={`breadcrumb-link${selectedCurrent ? "" : " current"}`}
                aria-current={selectedCurrent ? undefined : "page"}
                onClick={() =>
                  selectedCurrent
                    ? closeRecord()
                    : selfService
                      ? openSelfService()
                      : view
                        ? openView(view)
                        : go(module)
                }
              >
                {selfService ? "My requests" : view ? viewLabels[view] : labels[module]}
              </Button>
              {selectedCurrent && (
                <>
                  <ChevronRight size={13} aria-hidden="true" />
                  <span className="breadcrumb-link current" aria-current="page" title={selectedCurrent.title}>
                    {selectedCurrent.title}
                  </span>
                </>
              )}
            </nav>
          </div>
          <div className={frame.topRight}>
            <Button className={frame.aiAccess} aria-label="Ask Enercore AI" onClick={()=>openView("ai")} aria-current={view==="ai"?"page":undefined}><Sparkles size={16}/><span>Ask Enercore AI</span></Button>
            {/* One way to find anything: records, pages and commands. */}
            <Button
              className={frame.search}
              aria-label="Quick actions: find anything or run a command"
              onClick={() => setCommandOpen(true)}
            >
              <Search size={15} aria-hidden="true" />
              <span>Search anything</span>
              <kbd>⌘ K</kbd>
            </Button>

            {/* Always reachable, on every screen, so creating a record is
                never a navigation task. The shortcut is a convenience on top
                of this button, never a requirement. */}
            {canQuickAdd && <Button
              className="primary quick-add-trigger"
              aria-label="Quick add"
              onClick={() => setQuickAdd({ open: true })}
              title="Quick add (press n)"
            >
              <Plus size={17} aria-hidden="true" />
              <span className="quick-add-trigger-label">Quick add</span>
            </Button>}
            <Button
              className="icon-button notification-button"
              aria-label={inbox.unread ? `Open notifications, ${badgeCount(inbox.unread)} unread` : "Open notifications"}
              onClick={() => openView("notifications")}
            >
              <Bell size={18} />
              {inbox.unread > 0 && (
                <span className="notify-badge" aria-hidden="true">
                  {badgeCount(inbox.unread)}
                </span>
              )}
            </Button>
            <WorkspaceAccount actor={actor} photo={photo} onView={openView} />
          </div>
        </header>
        {preview && (
          <div className={frame.preview}>
            <Sparkles size={13} />
            <span>
              Preview <b>·</b> Fictional data, saved only in this browser
            </span>
          </div>
        )}
        <main
          id="main"
          className={`${frame.content} main-content page-enter${view === "collaboration" && !selfService && !selectedCurrent ? " is-collaboration" : ""}${selectedCurrent ? " is-record" : ""}`}
          key={selfService ? "my-requests" : view || `${module}-${company}`}
        >
          {/* An open record is a page of its own. The page it was opened from
              stays mounted underneath — filters, scroll, answers and all — and
              returns unchanged on Back. */}
          {selectedCurrent && (
            <RecordWorkspace
              key={selectedCurrent.id}
              record={selectedCurrent}
              actor={actor}
              busy={busy}
              backLabel={selfService ? "My requests" : view ? viewLabels[view] : labels[module]}
              onClose={closeRecord}
              onEdit={() => { setMutationError(""); setEditing(selectedCurrent); setForm(selectedCurrent.kind); }}
              onDelete={() => { setMutationError(""); setDeleting(selectedCurrent); }}
              pinned={pins.includes(selectedCurrent.id)}
              onPin={() => pin(selectedCurrent)}
              onLog={() => setLogging(selectedCurrent)}
              onUpdate={(s) => update(selectedCurrent, s)}
              onAction={(action) => extraAction(selectedCurrent, action)}
              onAssign={canAssign(actor, selectedCurrent) ? () => setAssigning(selectedCurrent) : undefined}
              live={!preview}
              onAiApply={applyAiSuggestion}
              onAiChanged={reloadQuietly}
              autoAi={autoAi?.id === selectedCurrent.id ? autoAi.task : undefined}
              onQuote={() => {
                setQuoteSource(selectedCurrent);
                setForm("quotations");
              }}
              onProforma={selectedCurrent.kind === "orders" && selectedCurrent.status !== "Cancelled" && !!selectedCurrent.customerId && canCreateProforma(actor, selectedCurrent.company, selectedCurrent.branch) ? () => { setEditing(null); setMutationError(""); setProformaSource(selectedCurrent); setProformaOpen(true); } : undefined}
              onNewLead={
                (selectedCurrent.kind === "customers" || selectedCurrent.kind === "products") &&
                canWrite(actor, { kind: "leads", company: selectedCurrent.company, branch: selectedCurrent.branch || actor.branches[0] || "Main", ownerId: actor.id } as RecordItem)
                  ? (contact) => {
                      // Never ask twice: a lead started here already knows the
                      // customer (and contact), or the product. The server
                      // still checks every link.
                      const from = selectedCurrent;
                      if (from.kind === "customers") {
                        setQuoteSource({
                          ...from,
                          customerId: from.id,
                          contactId: contact?.id || from.primaryContactId || null,
                          ...(contact ? { contact: contact.name, email: contact.email || "", phone: contact.phone || "" } : {}),
                          productId: null,
                          dealId: null,
                          due: "",
                          detail: "",
                          amount: 0,
                          quantity: 0,
                        });
                        setLeadContext(contact ? `${from.title} · ${contact.name}` : from.title);
                      } else {
                        setQuoteSource({
                          ...from,
                          title: "",
                          contact: "",
                          email: "",
                          phone: "",
                          destination: "",
                          customerId: null,
                          contactId: null,
                          primaryContactId: null,
                          productId: from.id,
                          product: from.title,
                          dealId: null,
                          due: "",
                          detail: "",
                          amount: 0,
                          quantity: 0,
                          attributes: {},
                        });
                        setLeadContext(`Product: ${from.title}`);
                      }
                      setForm("leads");
                    }
                  : undefined
              }
            />
          )}
          <PageMotion routeKey={`${view??module}:${selfService}`}/>
          <div className="page-under-record" hidden={!!selectedCurrent}>
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
              {view === "collaboration" && (
                <CollaborationHub
                  actor={actor}
                  preview={preview}
                  onManageAccess={canManageUsers(actor) ? () => openView("access") : undefined}
                />
              )}
              {view === "prospecting" && <Prospecting actor={actor} preview={preview} />}
              {view === "mail" && <MailHub actor={actor} preview={preview} records={scoped.records} onCreate={(kind, message, suggestion) => {
                const entity = company === "All companies" ? actor.companies[0] : company;
                const source: RecordItem = { id:"", kind, company:entity, branch:actor.branches[0] || "Main",
                  title:kind === "it" ? suggestion.summary : suggestion.company, contact:suggestion.contact,
                  product:suggestion.product, quantity:suggestion.quantity ?? 0, unit:suggestion.unit || "MT",
                  amount:0, currency:"USD", status:"", ownerId:actor.id, owner:actor.name, due:"",
                  detail:"", source:"Email", email:message.sender, createdAt:"", updatedAt:"" };
                if (!canWrite(actor, source)) { setToast("Your role cannot create this type of record for this company."); return; }
                setMailSource(source); setEditing(null); setMutationError(""); setForm(kind);
              }}/>}
              {view === "ai" && <AiWorkspace actor={actor} preview={preview} records={scoped.records} company={company} />}
              {view === "actions" &&
                (preview ? (
                  <section className="panel ai-unavailable">
                    <p>The Action Center isn&apos;t available in the preview — it works from the live CRM records.</p>
                  </section>
                ) : (
                  <ActionCenter />
                ))}
              {view === "tasks" &&
                (preview ? (
                  <section className="panel ai-unavailable">
                    <p>Tasks aren&apos;t available in the preview — they are saved in the live CRM.</p>
                  </section>
                ) : (
                  <TasksPage actor={actor} company={company} records={scoped.records} />
                ))}
              {view === "operations" && (preview ? <p>Operations requires the connected workspace.</p> : <OperationsPage actor={actor} company={company} records={scoped.records}/>)}
              {view === "appearance" && <AppearancePage />}
              {view === "catalogs" && <OptionCatalogs actor={actor} preview={preview} />}
              {view === "notifications" && (
                <NotificationsPage
                  items={inbox.items}
                  unread={inbox.unread}
                  loaded={inbox.loaded || preview}
                  error={inbox.error}
                  hasMore={!!inbox.nextBefore}
                  preferences={inbox.preferences}
                  onOpen={(n) => void openNotification(n)}
                  onRead={(ids, read) => void inbox.setRead(ids, read)}
                  onReadAll={() => void inbox.readAll()}
                  onMore={inbox.loadMore}
                  onSavePreferences={inbox.savePreferences}
                />
              )}
              {view === "access" && canManageUsers(actor) && (
                <>
                  <PageHeader
                    title="Access control"
                    description="Manage who can use each company and module."
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
              {(() => {
                if (module === "marketing") return null;
                const headingActions = (
                <div className="heading-actions">
                  {module === "overview" && executive && !view && <Select className="dashboard-currency" aria-label="Dashboard currency" value={dashboardCurrency} onChange={e=>setDashboardCurrency(e.target.value)}>{[...new Set(["USD","AED","EUR","GBP","INR","SAR","SGD","CNY",...records.map(r=>r.currency)])].filter(Boolean).map(c=><option key={c}>{c}</option>)}</Select>}
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
                  {module === "leads" && <Button className="pipeline-toggle" variant="secondary" size="icon" aria-label={leadDeskOpen ? "Show pipeline" : "Hide pipeline"} aria-expanded={!leadDeskOpen} aria-controls="lead-pipeline" onClick={()=>{setLeadDeskOpen(v=>!v);setBoard(true);}}><Columns3 size={17} aria-hidden="true"/></Button>}
                  {newLabels[module] && !(module === "hr" && hrAccess(actor).view) &&
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
                        onClick={() => module === "leads" ? setQuickAdd({open:true,kind:"leads"}) :
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
                );
                // On the employee home My Day supplies the heading, so only the
                // controls remain rather than stacking two titles.
                if (module === "overview" && !executive)
                  return <div className="page-heading is-my-day"><div />{headingActions}</div>;
                return (
                  <PageHeader
                    guide={moduleHelp[module]}
                    className="page-heading"
                    title={
                      module === "overview"
                        ? company === "All companies"
                          ? "Group dashboard"
                          : `${companyName(company)} dashboard`
                        : labels[module]
                    }
                    description={
                      module === "overview" ? (
                        <>
                          {company === "All companies"
                            ? "Consolidated view of your assigned companies."
                            : `Performance and activity for ${companyName(company)}.`}{" "}
                          {/* Beside the time range it explains. */}
                          <span className="dashboard-scope">Metrics and charts use record creation date. Daily focus remains current.</span>
                        </>
                      ) : (
                        subtitles[module]
                      )
                    }
                    actions={headingActions}
                  />
                );
              })()}
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
              {loaded && module === "overview" && !preview && data.records.length >= 1000 && <p className="record-window-note" role="status">Overview uses a limited loaded-record window, not complete totals.{permitted.includes("leads") && <> <Button onClick={() => go("leads")}>Open full lead reports <ArrowRight size={13}/></Button></>}</p>}
              {!loaded || moduleLoading === module ? (
                // The page keeps its own shape while data arrives: an
                // executive sees the attention block and KPI row, an employee
                // sees their day, a list keeps its toolbar and loses only its
                // rows. Nothing moves when the data lands.
                module === "overview" ? (
                  executive ? <SkeletonDashboard /> : <SkeletonRoleHome actor={actor} />
                ) : (
                  <SkeletonList />
                )
              ) : module === "overview" ? (
                <Overview
                  meetingsToday={
                    preview ? null : (
                      <>
                        <TodayMeetings />
                        <ActionDigest onOpen={() => openView("actions")} />
                        <MyDaySuggestions onReview={() => openView("ai")} />
                      </>
                    )
                  }
                  records={records}
                  actor={actor}
                  executive={executive}
                  currency={dashboardCurrency}
                  live={!preview}
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
                <WorkspaceSettings actor={actor} preview={preview} onAppearance={() => openView("appearance")} onAccess={() => openView("access")} />
              ) : module === "hr" && hrAccess(actor).view ? (
                <HrWorkspace key={`${actor.id}:${actor.role}:${company}`} actor={actor} preview={preview} company={company} records={scoped.records}
                  onLegacyTab={tab => {setHrTab(tab);setFilter("All statuses");}}
                  onAddEmployee={()=>{setEditing(null);setMutationError("");setForm("hr");}}
                  onLeave={()=>{setEditing(null);setMutationError("");setForm("leave");}}
                  peopleList={<section className="records-panel" aria-label={`${hrTab === "people" ? "People" : "Leave requests"} list`}><RecordTable key={`${company}:${hrTab}`} shared={sharedQuery} empty={emptyList} records={visible} allRecords={data.records} onDeleteSelected={setBulkDeleting} onSelect={setSelected} actor={actor} onEdit={r=>{setMutationError("");setEditing(r);setForm(r.kind);}} onDelete={r=>{setMutationError("");setDeleting(r);}} onLog={setLogging} onStatus={(r,status)=>{void update(r,status);}} /></section>}
                />
              ) : module === "marketing" ? (
                <>
                  <ContentCalendar records={records} actor={actor} company={company} onSave={saveContent} onDelete={r=>{setMutationError('');setDeleting(r);}} onCampaign={()=>{setEditing(null);setForm('marketing');}} onCompany={c=>{setCompany(c);window.history.replaceState(null,'',workspaceUrl('marketing',c));}}/>
                  <details className="panel content-campaigns"><summary>Campaigns & other marketing records</summary>{records.filter(r=>r.kind === 'marketing' && r.attributes?.contentType !== 'social-post').map(r=><Button key={r.id} className="secondary" onClick={()=>setSelected(r)}>{r.title}</Button>)}</details>
                </>
              ) : (
                <>
                  {module === "leads" && <>
                    <div hidden={!leadDeskOpen} style={!leadDeskOpen ? {display:"none"}:undefined}><LeadDesk actor={actor} records={scoped.records} live={!preview} company={company} onOpen={setSelected} onAssign={setAssigning} onDeleteSelected={setBulkDeleting} onImport={canWrite(actor,{kind:"leads",company:company==="All companies"?actor.companies[0]:company,branch:actor.branches[0]||"Main",ownerId:actor.id} as RecordItem)?()=>setImporting(true):undefined} onManageTeam={canManageUsers(actor) ? ()=>openView("access") : undefined} onSave={extraAction} busy={busy}/></div>
                  </>}
                  {module === "accounts" && <>
                    {canCreateProforma(actor, company === "All companies" ? actor.companies[0] : company, actor.branches[0] || "Main") && <div className="proforma-entry"><div><h2>Customer proformas</h2><p>Prepared by Accounts. Separate from receivables and incoming supplier invoices.</p></div><Button className="primary" onClick={() => { setEditing(null); setMutationError(""); setProformaSource(null); setProformaOpen(true); }}><Plus size={16} />New proforma</Button></div>}
                    <Cashbook records={records} actor={actor} company={company} onAdd={() => { setEditing(null); setForm("accounts"); }} onOpen={setSelected} />
                    {hrAccess(actor).payrollOnly && <details className="panel"><summary>Approved payroll register</summary><HrWorkspace actor={actor} preview={preview} company={company} records={[]} payrollOnly /></details>}
                  </>}
                  <section id={module === "leads" ? "lead-pipeline" : undefined} className="records-panel" hidden={module === "leads" && leadDeskOpen} style={module === "leads" && leadDeskOpen ? { display: "none" } : undefined} aria-label={module === "leads" ? "Lead pipeline" : `${module === "hr" ? (hrTab === "people" ? "People" : "Leave requests") : labels[module]} list`}>
                    {module === "hr" && (
                      <div className="list-tabs">
                        <div className="segmented" role="group" aria-label="HR records">
                          <Button
                            className={hrTab === "people" ? "selected" : ""}
                            aria-pressed={hrTab === "people"}
                            onClick={() => {
                              setHrTab("people");
                              setFilter("All statuses");
                            }}
                          >
                            People
                          </Button>
                          <Button
                            className={hrTab === "leave" ? "selected" : ""}
                            aria-pressed={hrTab === "leave"}
                            onClick={() => {
                              setHrTab("leave");
                              setFilter("All statuses");
                            }}
                          >
                            Leave requests
                          </Button>
                        </div>
                      </div>
                    )}
                    {visible.length === 0 && module !== "leads" ? (
                      <Empty
                        detail={
                          search
                            ? "Try a different search."
                            : "New records will appear here."
                        }
                      />
                    ) : module === "leads" && board ? (
                      <PipelineBoard records={visible} filter={filter} onFilter={setFilter} onOpen={setSelected} actions={r=><RecordIcons compact record={r} actor={actor} onEdit={record=>{setMutationError("");setEditing(record);setForm(record.kind);}} onDelete={record=>{setMutationError("");setDeleting(record);}}/>}/>
                    ) : cardModules.includes(module) && board ? (
                      <RecordCards toolbar={viewToggle} shared={sharedQuery} empty={emptyList} records={visible} onSelect={setSelected} actor={actor} onEdit={r => { setMutationError(""); setEditing(r); setForm(r.kind); }} onDelete={r => { setMutationError(""); setDeleting(r); }} onLog={setLogging} onStatus={(r, status) => { void update(r, status).then((saved) => { if (saved && r.kind === "leads" && !["Won", "Lost"].includes(status)) setPrompt({ record: r, status }); }); }} onImport={canAdd && isImportable(module) ? () => setImporting(true) : undefined} />
                    ) : (
                      <RecordTable key={company} toolbar={viewToggle} shared={sharedQuery} empty={emptyList} records={visible} allRecords={data.records} onDeleteSelected={setBulkDeleting} onSelect={setSelected} actor={actor} onEdit={r => { setMutationError(""); setEditing(r); setForm(r.kind); }} onDelete={r => { setMutationError(""); setDeleting(r); }} onLog={setLogging} onStatus={(r, status) => { void update(r, status).then((saved) => { if (saved && r.kind === "leads" && !["Won", "Lost"].includes(status)) setPrompt({ record: r, status }); }); }} onImport={canAdd && isImportable(module) ? () => setImporting(true) : undefined} />
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
          </div>
        </main>
      </div>
      {!view || view !== "ai" ? <AiCompanion key={`${actor.id}:${actor.role}:${company}:${module}:${view||""}:${selectedCurrent?.id||""}`} actor={actor} module={module} company={company} records={scoped.records} record={selectedCurrent||undefined} preview={preview} view={view && ["prospecting","mail","collaboration","tasks","actions","operations","catalogs","profile","appearance","notifications","shortcuts","access"].includes(view)?view as AiPageContext["view"]:undefined} onOpen={()=>openView("ai")}/> : null}
      <DialogPresence>
        {(proformaOpen || (form && editing && isProforma(editing))) ? <ProformaForm key={editing?.id || proformaSource?.id || "new-proforma"} actor={actor} company={company} records={scoped.records} initial={editing} source={proformaSource} live={!preview} busy={busy} error={mutationError} onCustomerCreated={record => setData(prev => ({ ...prev, records: [record, ...prev.records.filter(r => r.id !== record.id)] }))} onSave={editing ? saveEdit : create} onClose={() => { setProformaOpen(false); setProformaSource(null); setEditing(null); setForm(null); }} /> : form && (
          <RecordForm
            live={!preview}
            records={scoped.records}
            initial={editing || (view === "mail" ? mailSource : null) || (form === "quotations" || form === "leads" ? quoteSource : null)}
            editing={Boolean(editing)}
            saveError={mutationError}
            serverFieldErrors={mutationFields}
            context={view === "mail" && mailSource ? "Reviewed email fields · full email remains private" : form === "leads" ? leadContext : ""}
            kind={form}
            actor={actor}
            company={company}
            busy={busy}
            onClose={() => {
              if (busy) return;
              setForm(null);
              setQuoteSource(null);
              setMailSource(null);
            }}
            onSave={editing ? saveEdit : create}
          />
        )}
      </DialogPresence>
      <DialogPresence>
        {commandOpen && (
          <CommandMenu
            live={!preview}
            onClose={() => { setCommandOpen(false); setCommandView(null); }}
            items={[
              // What this person pinned, then what they last opened. Both are
              // resolved against the records they can currently see, so an
              // entry for something they have lost access to simply vanishes.
              ...resolveVisible(pins, scoped.records).map((r) => ({
                id: `pin-${r.id}`,
                label: r.title,
                detail: `${recordProfiles[r.kind].noun} · ${companyName(r.company)}`,
                group: "Pinned",
                run: () => setSelected(r),
              })),
              ...resolveVisible(recent.map((x) => x.id), scoped.records)
                .filter((r) => !pins.includes(r.id))
                .slice(0, 6)
                .map((r) => ({
                  id: `recent-${r.id}`,
                  label: r.title,
                  detail: `${recordProfiles[r.kind].noun} · ${companyName(r.company)}`,
                  group: "Recent",
                  run: () => setSelected(r),
                })),
              // Enercore AI on the record last opened (live only; a few entries, not a menu).
              ...(preview
                ? []
                : (() => {
                    const seen = resolveVisible(recent.map((x) => x.id), scoped.records);
                    const lead = seen.find((r) => r.kind === "leads");
                    const customer = seen.find((r) => r.kind === "customers");
                    const open = (r: RecordItem, task: AutoAi) => () => {
                      setAutoAi({ id: r.id, task });
                      setSelected(r);
                    };
                    return [
                      ...(lead
                        ? [
                            { id: `ai-brief-${lead.id}`, label: `Ask AI about ${lead.title}`, detail: "Enercore AI · Lead brief", group: "Enercore AI", run: open(lead, "brief") },
                            { id: `ai-draft-${lead.id}`, label: `Draft follow-up · ${lead.title}`, detail: "Enercore AI · Draft", group: "Enercore AI", run: open(lead, "draft") },
                          ]
                        : []),
                      ...(customer ? [{ id: `ai-customer-${customer.id}`, label: `Prepare customer brief · ${customer.title}`, detail: "Enercore AI · Pre-call brief", group: "Enercore AI", run: open(customer, "customer-brief") }] : []),
                    ];
                  })()),
              // Operational slices: the questions people actually open the CRM
              // to answer, answered inside the palette rather than by building
              // a filter by hand. Each is scoped to what the actor can see.
              ...operationalViews(actor, scoped.records).map((view) => ({
                id: `view-${view.id}`,
                label: view.label,
                detail: view.detail,
                group: "Find",
                // Narrows the palette in place rather than closing it.
                keepOpen: true,
                run: () => setCommandView(view.id),
              })),
              ...(commandView
                ? operationalViews(actor, scoped.records)
                    .find((v) => v.id === commandView)
                    ?.records.slice(0, 20)
                    .map((r) => ({
                      id: `result-${r.id}`,
                      label: r.title,
                      detail: `${nextAction(r).label} · ${companyName(r.company)}`,
                      record: true,
                      group: "Records",
                      run: () => setSelected(r),
                    })) ?? []
                : []),
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
                .filter(([v]) => (v !== "operations" || (!preview && operationsAccess(actor).view)) && (v !== "prospecting" || canProspect(actor)) && (v !== "access" || canManageUsers(actor)) && (!["ai", "actions", "tasks"].includes(v) || !preview))
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
        {logging && (
          <LogActivity
            record={logging}
            actor={actor}
            onLeadSave={action=>extraAction(logging,action)}
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
            preview={preview}
            onManageTeam={canManageUsers(actor) ? ()=>{setQuickAdd({open:false});openView("access");} : undefined}
            onCreate={values=>create(values,true)}
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
            // Preview has no server records to reload; its imports write
            // nothing (the API refuses), so there is nothing to refresh.
            onDone={preview ? async () => {} : reload}
          />
        )}
      </DialogPresence>
      <DialogPresence>{bulkDeleting && <BulkDeleteDialog records={bulkDeleting} problem={r => recordDeleteProblem(actor,r,data.records)} onConfirm={deleteSelectedRecords} onClose={() => {if(!busy)setBulkDeleting(null);}} />}</DialogPresence>
      <DialogPresence>{deleting && <Dialog title="Delete record?" className="delete-record-dialog" onClose={() => { if (!busy) setDeleting(null); }}>
        <p className="delete-record-name">{deleting.title}</p>
        <p className="muted">{companyName(deleting.company)} · {deleting.id}</p>
        <p>{deletionReason(deleting, data.records) || "This removes the record from the workspace. Its audit history is retained. It will not delete related records."}</p>
        {mutationError && <p className="error" role="alert">{mutationError}</p>}
        {/* A confirmation: Delete is the act being confirmed, so it is the
            primary (danger) action on the right. When deletion is blocked
            there is nothing to confirm and the footer is just Close. */}
        <DialogActions
          onCancel={() => setDeleting(null)}
          pending={busy}
          cancel={deletionReason(deleting, data.records) ? "Close" : "Cancel"}
          primary={
            deletionReason(deleting, data.records)
              ? undefined
              : { label: "Delete record", pendingLabel: "Deleting…", tone: "danger", pending: busy, onClick: deleteRecord }
          }
        />
      </Dialog>}</DialogPresence>
      {prompt && (
        <div className="after-action" role="status">
          <span>
            {prompt.record.title} is now <b>{prompt.status}</b>. Set the next follow-up?
          </span>
          {/* The compact menu, not the full preset row: this bar sits over the
              list, so it must stay a single line rather than a panel. */}
          <FollowUpMenu
            busy={busy}
            label="Set follow-up"
            onChoose={(date) => { void setFollowUp(prompt.record, date); setPrompt(null); }}
          />
          <Button className="icon-button" aria-label="Dismiss" onClick={() => setPrompt(null)}>
            <X size={15} />
          </Button>
        </div>
      )}
      <DialogPresence>
        {assigning && (
          <AssignDialog
            record={assigning}
            previewActor={preview ? actor : undefined}
            onPreviewAssign={preview ? async person=>{setData(assign(data,actor,assigning.id,person));} : undefined}
            onManageTeam={canManageUsers(actor) ? ()=>{setAssigning(null);openView("access");} : undefined}
            onClose={() => setAssigning(null)}
            onAssigned={async (name) => {
              setAssigning(null);
              if (!preview) await reload().catch(() => {});
              setToast(`Assigned to ${name}.`);
            }}
          />
        )}
      </DialogPresence>
      {!preview && <MeetingLayer />}
      <NotificationToasts
        toasts={alerts}
        preferences={inbox.preferences}
        onOpen={(n) => void openNotification(n)}
        onDismiss={dismissAlert}
      />
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div></TableExportProvider></DialogLoadingContext.Provider>
  );
}
type RecordActionsProps = {
  actor: Actor;
  onEdit: (r: RecordItem) => void;
  onDelete: (r: RecordItem) => void;
  onImport?: () => void;
  onDeleteSelected?: (rows: RecordItem[]) => void;
  allRecords?: RecordItem[];
  /** Inline status change; omitted where a row must not be changed in place. */
  onStatus?: (r: RecordItem, status: string) => void;
  /** Opens the quick activity log; omitted for kinds nobody contacts. */
  onLog?: (r: RecordItem) => void;
};

/** Kinds where "I contacted them" is a real event. */
const LOGGABLE = ["leads", "customers", "suppliers", "quotations", "orders"];
/** The next action, with its date kept as secondary detail. */
function NextActionCell({ record }: { record: RecordItem }) {
  if (isProforma(record)) return <span className="next-action-cell"><span>{record.status === "Draft" ? "Review & issue proforma" : record.status === "Issued" ? "Proforma issued" : "Cancelled proforma"}</span><small className="muted">Valid until {record.due} · no receivable</small></span>;
  if (["products", "customers", "suppliers", "hr"].includes(record.kind)) {
    return <span className="muted">{record.updatedAt ? `Updated ${record.updatedAt.slice(0, 10)}` : "No update recorded"}</span>;
  }
  if (record.kind === "accounts" && !["Paid", "Cancelled", "Overdue"].includes(record.status)) {
    return <span className="next-action-cell"><span>Payment due</span><small className="muted">{record.due || "Not set"}</small></span>;
  }
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

/**
 * A row's actions, built from the shared component so every module presents
 * the same cluster in the same order and the same width.
 */
function RecordIcons({
  record, actor, onEdit, onDelete, onStatus, onLog, onOpen, compact,
}: RecordActionsProps & { record: RecordItem; onOpen?: (r: RecordItem) => void; compact?: boolean }) {
  if (!canWrite(actor, record)) return null;
  const options = availableStatuses(actor, record);
  return (
    <RowActions
      label={record.title}
      compact={compact}
      status={record.status}
      statusOptions={options}
      onStatus={onStatus ? (next) => onStatus(record, next) : undefined}
      onOpen={onOpen ? () => onOpen(record) : undefined}
      actions={[
        // Logging a contact is frequent, but it does not need to occupy a
        // column on every row to be one click away.
        ...(onLog && LOGGABLE.includes(record.kind)
          ? [{ id: "log", label: "Log activity", icon: rowActionIcons.log, run: () => onLog(record) }]
          : []),
        ...(!isProforma(record) || record.status === "Draft" ? [{ id: "edit", label: "Edit details", icon: rowActionIcons.edit, run: () => onEdit(record) }] : []),
        ...(!isProforma(record) ? [{
          id: "delete",
          label: "Delete record",
          icon: rowActionIcons.delete,
          destructive: true,
          run: () => onDelete(record),
        }] : []),
      ]}
    />
  );
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
  toolbar,
  shared,
  empty,
  ...actions
}: {
  records: RecordItem[];
  onSelect: (r: RecordItem) => void;
  toolbar?: React.ReactNode;
  shared?: { query: ListQuery; setQuery: (query: ListQuery) => void };
  /** What an empty list says, and the one action that fills it. */
  empty?: React.ReactNode;
} & RecordActionsProps) {
  const pagination = usePagination(records, "", shared);
  return (
    <>
      <ListFilters
        {...pagination}
        label="records"
        exportCount={pagination.matched.length}
        onExport={() => exportRecords(pagination.matched as RecordItem[])}
        onImport={onImport}
        trailing={toolbar}
      />
      <div className="record-grid">
        {pagination.items.map((r) => {
          const description =
            r.kind === "hr"
              ? r.contact
              : r.kind === "customers"
                ? [r.contact, r.attributes?.country, `Ref ${r.id.slice(-8)}`].filter(Boolean).join(" · ")
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
                    {isProforma(r) && <span>Customer proforma · </span>}
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
      <ListEmpty {...pagination} label="records" empty={empty} />
      <Pagination {...pagination} label="records" />
    </>
  );
}
function RecordTable({
  records,
  onSelect,
  onImport,
  toolbar,
  shared,
  empty,
  ...actions
}: {
  records: RecordItem[];
  onSelect: (r: RecordItem) => void;
  toolbar?: React.ReactNode;
  shared?: { query: ListQuery; setQuery: (query: ListQuery) => void };
  /** What an empty list says, and the one action that fills it. */
  empty?: React.ReactNode;
} & RecordActionsProps) {
  const pagination = usePagination(records, "", shared);
  const selection = useRowSelection(pagination.matched, JSON.stringify([actions.actor.id, actions.actor.role, actions.actor.companies, actions.actor.branches, records[0]?.kind, pagination.query.search, pagination.query.status]));
  const deletable = selection.selected.filter(r => !recordDeleteProblem(actions.actor,r,actions.allRecords || records));
  // Money is a column only where the records carry money.
  const valued = records.some((r) => ["leads", "quotations", "orders", "accounts", "products", "marketing"].includes(r.kind));
  const referenceList = ["products", "customers", "suppliers", "hr"].includes(records[0]?.kind);
  return (
    <Surface padding="none" className={`record-list-surface ${recordStyles.surface}`}>
      <ListFilters
        {...pagination}
        label="records"
        sortable={false}
        exportCount={pagination.matched.length}
        onExport={() => exportRecords(pagination.matched as RecordItem[])}
        onImport={onImport}
        trailing={toolbar}
      />
      <SelectionActions selected={selection.selected} title="records" onClear={selection.clear} onDelete={actions.onDeleteSelected ? () => actions.onDeleteSelected!(selection.selected) : undefined} deletableCount={deletable.length} />
      {pagination.total > 0 && <div className="table-scroll">
        <CrmTable className={recordStyles.table} data-reference-list={referenceList || undefined}>
          <thead>
            <tr>
              <th className="table-select-cell"><SelectionCheckbox label="Select all records on this page" checked={!!pagination.items.length && pagination.items.every(r => selection.has(r.id))} mixed={pagination.items.some(r => selection.has(r.id)) && !pagination.items.every(r => selection.has(r.id))} onChange={checked => selection.togglePage(pagination.items,checked)} /></th>
              {/* Six columns, not eight. Company and product are secondary
                  detail and now sit under the name, which removes the
                  horizontal scroll without losing anything. */}
              {/* Columns are sized by class, not position: Value is absent
                  for kinds that carry no value. */}
              <SortHeader className="e-col-record" sortKey="name" query={pagination.query} setQuery={pagination.setQuery}>{records[0]?.kind === "products" ? "Product" : records[0]?.kind === "hr" ? "Employee" : "Name / Company"}</SortHeader>
              <SortHeader className="e-col-status" sortKey="status" query={pagination.query} setQuery={pagination.setQuery}>Status</SortHeader>
              <SortHeader className="e-col-owner" sortKey="owner" query={pagination.query} setQuery={pagination.setQuery}>Owner</SortHeader>
              <SortHeader className="e-col-next" sortKey={referenceList?"updatedAt":"due"} query={pagination.query} setQuery={pagination.setQuery}>{referenceList?"Last updated":records[0]?.kind === "accounts" ? "Payment" : "Next action"}</SortHeader>
              {valued && <SortHeader className="e-col-value" sortKey="amount" query={pagination.query} setQuery={pagination.setQuery}>{records[0]?.kind === "products" ? "Unit price" : "Value"}</SortHeader>}
              <th className="e-col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagination.items.map((r) => (
              <tr key={r.id} data-selected={selection.has(r.id) || undefined}>
                <td className="table-select-cell"><SelectionCheckbox label={`Select ${r.title}`} checked={selection.has(r.id)} onChange={checked => selection.toggle(r.id,checked)} /></td>
                <td className="e-cell-identity">
                  <Button className="record-link avatar-name" onClick={() => onSelect(r)}>
                    <Avatar name={r.title} size={30} />
                    <span>
                      <span className="e-row-title" title={r.title}>{r.title}</span>
                      <small
                        className="e-row-meta"
                        title={[companyName(r.company), r.product || r.contact, r.owner && `by ${r.owner}`].filter(Boolean).join(" · ")}
                      >
                        {[isProforma(r) ? `Proforma ${r.attributes?.quoteReference || r.id}` : "", companyName(r.company), r.product || r.contact]
                          .filter(Boolean)
                          .join(" · ")}
                        {/* Where the Created by column is dropped for space
                            (narrower screens, phone cards), the creator
                            moves into this line instead of disappearing. */}
                        {r.owner && <span className="e-row-owner"> · by {r.owner}</span>}
                      </small>
                    </span>
                  </Button>
                </td>
                <td className="e-cell-status">
                  {actions.onStatus && availableStatuses(actions.actor, r).length > 1 ? (
                    <Select className="record-status-select" aria-label={`Status for ${r.title}`} value={r.status} onChange={(e) => actions.onStatus?.(r, e.target.value)}>
                      {availableStatuses(actions.actor, r).map((status) => <option key={status}>{status}</option>)}
                    </Select>
                  ) : <Badge status={r.status} />}
                </td>
                <td className="e-cell-owner">
                  {r.owner ? (
                    <span className="avatar-name"><Avatar name={r.owner} size={24} /><span title={r.owner}>{r.owner}</span></span>
                  ) : "—"}
                </td>
                {/* The derived next action says what to do as well as when,
                    so nobody opens a record to find out. */}
                <td className="e-cell-next"><NextActionCell record={r} /></td>
                {valued && (
                  <td className="amount e-numeric">
                    {r.amount ? formatMoney(r.amount, r.currency) : "—"}
                  </td>
                )}
                <td className="e-col-actions">
                  <RecordIcons record={r} onOpen={onSelect} {...actions} onStatus={undefined} />
                </td>
              </tr>
            ))}
          </tbody>
        </CrmTable>
      </div>}
      <ListEmpty {...pagination} label="records" empty={empty} />
      <Pagination {...pagination} label="records" />
    </Surface>
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
  live,
  onFollowUp,
  onQuickAdd,
  busy,
  meetingsToday,
  currency = "USD",
}: {
  /** Today's meetings for My Day (live workspace only). */
  meetingsToday?: React.ReactNode;
  currency?: string;
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
  live?: boolean;
  onFollowUp: (r: RecordItem, date: string) => Promise<void> | void;
  onQuickAdd: (kind?: Kind) => void;
  busy?: boolean;
}) {
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  useEffect(() => {
    try {
      setAnalysisOpen(false);
    } catch {}
  }, []);
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
  const invoices = records.filter((r) => r.kind === "accounts" && !isCashEntry(r) && !isProforma(r));
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
      sub: `${leads.filter((r) => !["Won", "Lost"].includes(r.status)).length} open leads · USD value only`,
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
        label: "Proformas to review",
        value: pad(records.filter(r => isProforma(r) && r.status === "Draft").length),
        sub: "Draft customer offers · not receivables",
        icon: FileText, to: "accounts", accent: "purple",
      },
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
        label: "Campaign lead targets",
        value: pad(campaigns.reduce((sum, r) => sum + (r.quantity || 0), 0)),
        sub: "Planned targets, not actual inquiries or revenue",
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
  const defaultOrder: Module[] = ["leads", "orders", "logistics", "accounts", "hr", "it", "marketing", "quotations", "customers", "suppliers", "products"];
  const cardOrder = [...new Set([...roleHome(actor).modules, ...defaultOrder])];
  const metrics = cardOrder
    .filter((m) => allowed.includes(m))
    .flatMap((m) => cards[m] || [])
    .slice(0, 4);

  // A role's own module summary. Executives now read the KPI strip instead,
  // which says the same things in one line, so these are shown only to the
  // roles that have no strip.
  const roleCards = metrics.length > 0 && (
    <div className="stats-grid">
      {metrics.map((m) => (
        <Button className={`stat-card metric-${m.accent}`} key={m.label} onClick={() => go(m.to)}>
          <div className="stat-top">
            <span>{m.label}</span>
            <div className={`stat-icon ${m.accent}`}><m.icon size={18} /></div>
          </div>
          <span className="stat-value-row"><strong>{m.value}</strong><MetricTrend actor={actor} records={allRecords.filter(r => r.kind === m.to)} /></span>
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
      <RoleHome actor={actor} records={allRecords} go={go} onSelect={onSelect}>
        {roleCards}
        {actor.role.startsWith("Sales") && <MyDay
          meetings={meetingsToday}
          actor={actor}
          records={allRecords}
          company={company}
          onOpen={onSelect}
          onFollowUp={onFollowUp}
          onQuickAdd={onQuickAdd}
          onGo={(m) => go(m as Module)}
          busy={busy}
        />}
        {!actor.role.startsWith("Sales") && meetingsToday}
        {allowed.includes("leads") && <details className="workspace-reports" open={reportsOpen} onToggle={e => setReportsOpen(e.currentTarget.open)}><summary>Lead reports & weekly review<span>Brand, owner, follow-ups and conversions</span></summary>{reportsOpen && <LeadDesk actor={actor} records={allRecords} live={live} company={company} compact onOpen={onSelect} onDesk={()=>go("leads")} from={lower} to={upper}/>}</details>}
      </RoleHome>
    );

  return (
    <>
      {/* The first screen answers four questions, in order: what needs me,
          where we stand, what is waiting, what changed. Analysis follows,
          one click away. */}
      {scopeNote && (
        <p className="dashboard-period-note" role={reversed ? "alert" : "status"}>
          {scopeNote}
        </p>
      )}
      <StudioDashboard actor={actor} records={records} currentRecords={allRecords} onSelect={onSelect} go={go} onQuickAdd={onQuickAdd} events={audit.filter(a=>company==="All companies" || a.company===company)} live={live} company={company} from={lower} to={upper} currency={currency} />
      {allowed.includes("leads") && <details className="workspace-reports" open={reportsOpen} onToggle={e => setReportsOpen(e.currentTarget.open)}><summary>Lead reports & weekly review<span>Brand, owner, follow-ups and conversions</span></summary>{reportsOpen && <LeadDesk actor={actor} records={allRecords} live={live} company={company} compact onOpen={onSelect} onDesk={()=>go("leads")} from={lower} to={upper}/>}</details>}
      <details
        className="dash-analysis"
        open={analysisOpen}
        onToggle={(e) => {
          const open = (e.currentTarget as HTMLDetailsElement).open;
          setAnalysisOpen(open);
          try {
            localStorage.setItem("enercore-dashboard-analysis", open ? "open" : "closed");
          } catch {}
        }}
      >
        <summary>
          <span className="dash-analysis-title">Business analysis</span>
          <span className="muted small">Sales, demand and performance by company</span>
        </summary>
        {analysisOpen && commercial && <DashboardInsights actor={actor} records={records} onSelect={onSelect} />}
      </details>
    </>
  );
}
/** Splits "leads: Quote Sent → Qualified" into a subject and a change. */
function activityParts(action: string) {
  const at = action.indexOf(":");
  if (at < 0) return { area: "", change: action };
  return { area: action.slice(0, at).trim(), change: action.slice(at + 1).trim() };
}
// Business time, not the device's: "04:14" with no am/pm is ambiguous next to
// the 12-hour GST clock in the header, and a local-time value would disagree
// with it entirely for anyone not in Dubai.
const activityWhen = businessStampShort;

function ActivityList({
  events,
  paginated = true,
}: {
  events: Audit[];
  paginated?: boolean;
}) {
  const pagination = usePagination(events);
  const selection = useRowSelection(pagination.matched, JSON.stringify([pagination.query.search,pagination.query.status]));
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
      <ul className="change-list">
        {events.map((a) => (
          <li key={a.id}>
            <span className="change-text">
              <b>{a.actor}</b> <span>{a.action}</span>
            </span>
            <small>
              {companyName(a.company)} · {activityWhen(a.at)}
            </small>
          </li>
        ))}
        {!events.length && <li className="change-empty">No recorded changes yet.</li>}
      </ul>
    );
  return (
    <>
      <ListFilters {...pagination} label="events" sortable={false} />
      <SelectionActions selected={selection.selected} title="Activity log" onClear={selection.clear}/>
      {pagination.total > 0 && (
        <div className="table-scroll">
          <CrmTable>
            <thead>
              <tr>
                <SelectionHeader selection={selection} rows={pagination.items} label="events"/>
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
                  <tr key={a.id} data-selected={selection.has(a.id)||undefined}>
                    <SelectionCell selection={selection} row={a} label={`${a.actor} ${a.action}`}/>
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
          </CrmTable>
        </div>
      )}
      <ListEmpty {...pagination} label="events" />
      <Pagination {...pagination} label="events" />
      <DialogPresence>
        {detail && (
          <Dialog
            title="Activity detail"
            // Its own class rather than borrowing .record-detail-dialog: that
            // class carries width and footer rules meant for an editable
            // business record, none of which apply to six read-only fields.
            className="audit-detail-dialog"
            onClose={() => setDetail(null)}
          >
            <p className="audit-detail-summary">
              <strong>{detail.actor}</strong> {activityParts(detail.action).change}
            </p>
            <dl className="audit-detail-grid">
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
                ["When", businessDateTimeLong(detail.at)],
              ] as [string, string][]).map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="audit-detail-note">
              Audit entries are a record of what changed. They cannot be edited
              or removed.
            </p>
          </Dialog>
        )}
      </DialogPresence>
    </>
  );
}
