"use client";

import styles from "./studio/navigation.module.css";
import { BrandLogo } from "./brand";
import Link from "next/link";
import * as Drawer from "@radix-ui/react-dialog";
import {
  Activity,
  Box,
  Building2,
  CalendarDays,
  FileText,
  Globe2,
  LayoutDashboard,
  Monitor,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Target,
  Truck,
  Users,
  Wallet,
  X,
  Settings2,
  MessagesSquare,
  Mail,
  Sparkles,
  ListChecks,
  Radar,
  type LucideIcon,
} from "lucide-react";
import {
  allowedModules,
  labels,
  canManageUsers,
  type Actor,
  type Module,
} from "@/lib/domain";
import { canProspect } from "@/lib/execution/model";
import { type WorkspaceView } from "./workspace-pages";
import { Button, Tooltip } from "./ui/controls";
import { moduleHelp, viewHelp } from "@/lib/workspace-help";
import { Avatar } from "./avatar";
import { useAvatar } from "@/lib/avatar-store";
import { useOverflowFade } from "@/lib/use-overflow-fade";

/**
 * The navigation's scroll area. When more items sit below (or above) the
 * visible part — the Manage group on a short screen — a soft fade at that
 * edge says so; it disappears once scrolled to the end.
 */
function FadingNav(props: React.ComponentProps<"nav">) {
  const ref = useOverflowFade<HTMLElement>("y");
  return (
    <nav
      ref={ref}
      {...props}
      className={["overflow-fade-y", props.className].filter(Boolean).join(" ")}
    />
  );
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
/**
 * Navigation by the work people do, not by database table. Every entry is
 * still gated exactly as before: modules by allowedModules(), Enercore AI and
 * the Action Center by the live workspace, Prospecting by canProspect(),
 * Access control by canManageUsers().
 */
type NavEntry =
  { module: Module } | { view: WorkspaceView; label: string; icon: LucideIcon };
const groups: [string, NavEntry[]][] = [
  [
    "",
    [
      { module: "overview" },
      { view: "actions", label: "Action Center", icon: ListChecks },
    ],
  ],
  [
    "Sales",
    [
      { module: "leads" },
      { module: "quotations" },
      { module: "orders" },
      { module: "customers" },
      { module: "suppliers" },
      { module: "products" },
      { view: "prospecting", label: "Prospecting", icon: Radar },
    ],
  ],
  [
    "Team",
    [
      { view: "collaboration", label: "Collaboration", icon: MessagesSquare },
      { view: "mail", label: "Email", icon: Mail },
      { view: "ai", label: "Enercore AI", icon: Sparkles },
    ],
  ],
  ["Delivery & payments", [{ module: "logistics" }, { module: "accounts" }]],
  [
    "People & support",
    [{ module: "hr" }, { module: "marketing" }, { module: "it" }],
  ],
  [
    "Manage",
    [
      { module: "approvals" },
      { module: "activity" },
      { module: "settings" },
      { view: "access", label: "Access control", icon: ShieldCheck },
    ],
  ],
];
export default function Sidebar({
  actor,
  preview,
  module,
  collapsed,
  mobile,
  approvalCount,
  collabUnread = 0,
  collabMentions = 0,
  onCollapse,
  onMobileChange,
  onNavigate,
  onMyRequests,
  onView,
}: {
  actor: Actor;
  preview: boolean;
  module: Module | "my-requests" | WorkspaceView;
  collapsed: boolean;
  mobile: boolean;
  approvalCount: number;
  /** Unread chat messages across all conversations. */
  collabUnread?: number;
  /** Unread messages that mention this person. */
  collabMentions?: number;
  onCollapse: () => void;
  onMobileChange: (open: boolean) => void;
  onNavigate: (module: Module) => void;
  onMyRequests?: () => void;
  onView: (view: WorkspaceView) => void;
}) {
  const photo = useAvatar(actor.id);
  const entryAllowed = (e: NavEntry) =>
    "module" in e
      ? allowedModules(actor).includes(e.module)
      : e.view === "prospecting"
        ? canProspect(actor)
        : e.view === "access"
          ? canManageUsers(actor)
          : e.view === "ai" || e.view === "actions"
            ? !preview
            : true;
  function contents(isMobile: boolean) {
    const compact = collapsed && !isMobile;
    return (
      <div className={styles.panel}>
        <div className={styles.header}>
          {compact ? <Button className={styles.expand} aria-label="Expand sidebar" onClick={onCollapse}><PanelLeftOpen size={20}/></Button> : <>
            <Link href="/" className="brand" aria-label="Enercore workspace"><BrandLogo company="Enercore"/><span><strong>Enercore</strong><small>Business workspace</small></span></Link>
            <Button className={styles.toggle} aria-label={isMobile ? "Close navigation" : "Collapse sidebar"} onClick={isMobile ? () => onMobileChange(false) : onCollapse}>{isMobile ? <X size={18}/> : <PanelLeftClose size={17}/>}</Button>
          </>}
        </div>
        <FadingNav className={styles.nav} aria-label={isMobile ? "Mobile navigation" : "Main navigation"}>
          {groups.map(([title, entries]) => {
            const visible = entries.filter(entryAllowed);
            if (!visible.length) return null;
            return <section className={styles.group} key={title || "workspace"} aria-label={title || "Workspace"}>
              {!compact && <h2 className={styles.groupTitle}>{title || "Workspace"}</h2>}
              {visible.map(e => {
                const key = "module" in e ? e.module : e.view;
                const Icon = "module" in e ? icons[e.module] : e.icon;
                const label = "module" in e ? labels[e.module] : e.label;
                const count = key === "approvals" ? approvalCount : key === "collaboration" ? collabMentions ? "@" : collabUnread || 0 : 0;
                return <Tooltip key={key} label={compact ? label : `${label} — ${"module" in e ? moduleHelp[e.module].purpose : viewHelp[e.view] || label}`}>
                  <Button className={styles.item} aria-label={label} aria-current={module === key ? "page" : undefined} onClick={() => "module" in e ? onNavigate(e.module) : onView(e.view)}>
                    <Icon size={18}/>{!compact && <span className="nav-label">{label}</span>}
                    {!!count && <b className="nav-count">{typeof count === "number" && count > 99 ? "99+" : count}</b>}
                  </Button>
                </Tooltip>;
              })}
            </section>;
          })}
        </FadingNav>
        <div className={styles.bottom}>
          <Tooltip label="My requests"><Link className={styles.item} aria-label="My requests" aria-current={module === "my-requests" ? "page" : undefined} href="/my-requests" onClick={event => {
            if (onMyRequests && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onMyRequests(); }
          }}><CalendarDays size={18}/>{!compact && <span className="nav-label">My requests</span>}</Link></Tooltip>
          <div className={styles.utilities}>
            <Tooltip label="Shortcuts & help"><Button className={styles.utility} aria-label="Shortcuts & help" onClick={() => onView("shortcuts")}><ListChecks size={17}/>{!compact && <span>Help & shortcuts</span>}</Button></Tooltip>
            <Tooltip label="Appearance"><Button className={styles.utility} aria-label="Appearance" onClick={() => onView("appearance")}><Settings2 size={17}/></Button></Tooltip>
          </div>
          <Button className={styles.person} aria-label="Open my profile" onClick={() => onView("profile")}>
            <Avatar name={actor.name} image={photo} avatarId={actor.id} size={30}/>
            {!compact && <span className="profile-info">{actor.name}<small>{actor.role}{preview ? " · Preview" : ""}</small></span>}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <aside className={`${styles.desktop} ${collapsed ? styles.compact : ""}`}>
        {contents(false)}
      </aside>
      <Drawer.Root open={mobile} onOpenChange={onMobileChange}>
        <Drawer.Portal>
          <Drawer.Overlay className={styles.overlay} />
          <Drawer.Content
            className={styles.mobile}
            aria-describedby={undefined}
          >
            <Drawer.Title className="sr-only">
              Workspace navigation
            </Drawer.Title>
            {contents(true)}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
