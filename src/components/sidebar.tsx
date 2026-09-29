"use client";
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
  return <nav ref={ref} {...props} className={["overflow-fade-y", props.className].filter(Boolean).join(" ")} />;
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
type NavEntry = { module: Module } | { view: WorkspaceView; label: string; icon: LucideIcon };
const groups: [string, NavEntry[]][] = [
  ["", [{ module: "overview" }, { view: "actions", label: "Action Center", icon: ListChecks }]],
  [
    "Commercial",
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
    "Work",
    [
      { view: "collaboration", label: "Collaboration", icon: MessagesSquare },
      { view: "ai", label: "Enercore AI", icon: Sparkles },
    ],
  ],
  ["Operations", [{ module: "logistics" }, { module: "accounts" }]],
  ["Organization", [{ module: "hr" }, { module: "marketing" }, { module: "it" }]],
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
  const permitted = allowedModules(actor);
  function contents(isMobile: boolean) {
    const compact = collapsed && !isMobile;
    return (
      <>
        <div className="sidebar-header">
          <Link href="/" className="brand" aria-label="Enercore workspace">
            <BrandLogo company="Enercore" />
          </Link>
          {isMobile ? (
            <Button
              className="sidebar-toggle"
              aria-label="Close navigation"
              onClick={() => onMobileChange(false)}
            >
              <X size={18} />
            </Button>
          ) : (
            <Tooltip label={compact ? "Expand sidebar" : "Collapse sidebar"}>
              <Button
                className="sidebar-toggle"
                onClick={onCollapse}
                aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!compact}
              >
                {compact ? (
                  <PanelLeftOpen size={17} />
                ) : (
                  <PanelLeftClose size={17} />
                )}
              </Button>
            </Tooltip>
          )}
        </div>
        <FadingNav aria-label={isMobile ? "Mobile navigation" : "Main navigation"}>
          {groups.map(([title, entries]) => {
            const visible = entries.filter((e) =>
              "module" in e
                ? permitted.includes(e.module)
                : e.view === "prospecting"
                  ? canProspect(actor)
                  : e.view === "access"
                    ? canManageUsers(actor)
                    : e.view === "ai" || e.view === "actions"
                      ? !preview
                      : true,
            );
            if (!visible.length) return null;
            return (
              <section className="nav-group" key={title || "home"} aria-label={title || undefined}>
                {title && <h2 className="nav-group-title">{title}</h2>}
                {visible.map((e) => {
                  if ("module" in e) {
                    const Icon = icons[e.module];
                    return (
                      <Tooltip key={e.module} label={labels[e.module]} enabled={compact}>
                        <Button
                          className={`nav-item ${module === e.module ? "active" : ""}`}
                          onClick={() => onNavigate(e.module)}
                          aria-label={labels[e.module]}
                          aria-current={module === e.module ? "page" : undefined}
                        >
                          <Icon size={18} />
                          <span className="nav-label">{labels[e.module]}</span>
                          {e.module === "approvals" && approvalCount > 0 && <b className="nav-count">{approvalCount}</b>}
                        </Button>
                      </Tooltip>
                    );
                  }
                  const Icon = e.icon;
                  const collab = e.view === "collaboration";
                  return (
                    <Tooltip key={e.view} label={e.label} enabled={compact}>
                      <Button
                        className={`nav-item ${collab ? "nav-item-collab " : ""}${module === e.view ? "active" : ""}`}
                        onClick={() => onView(e.view)}
                        aria-label={
                          collab && collabUnread
                            ? `Collaboration, ${collabUnread} unread${collabMentions ? `, ${collabMentions} mentions` : ""}`
                            : e.label
                        }
                        aria-current={module === e.view ? "page" : undefined}
                      >
                        <Icon size={18} />
                        <span className="nav-label">{e.label}</span>
                        {collab &&
                          (collabMentions > 0 ? (
                            <b className="nav-count nav-count-mention">@</b>
                          ) : collabUnread > 0 ? (
                            <b className="nav-count nav-count-subtle">{collabUnread > 99 ? "99+" : collabUnread}</b>
                          ) : null)}
                      </Button>
                    </Tooltip>
                  );
                })}
              </section>
            );
          })}
        </FadingNav>
        <div className="sidebar-bottom">
          <Tooltip label="My requests" enabled={compact}>
            <Link
              className={`nav-item ${module === "my-requests" ? "active" : ""}`}
              aria-current={module === "my-requests" ? "page" : undefined}
              href="/my-requests"
              onClick={(event) => {
                if (onMyRequests && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                  event.preventDefault();
                  onMyRequests();
                }
              }}
              aria-label="My requests"
            >
              <CalendarDays size={18} />
              <span className="nav-label">My requests</span>
            </Link>
          </Tooltip>
          <Button
            className={`profile profile-link ${module === "profile" ? "active" : ""}`}
            aria-label="Open my profile"
            onClick={() => onView("profile")}
          >
            <Avatar name={actor.name} image={photo} avatarId={actor.id} size={30} />
            <span className="profile-info">
              {actor.name}
              <small>
                {actor.role}
                {preview ? " · Preview" : ""}
              </small>
            </span>
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <aside
        className={`sidebar desktop-sidebar ${collapsed ? "sidebar-compact" : ""}`}
      >
        {contents(false)}
      </aside>
      <Drawer.Root open={mobile} onOpenChange={onMobileChange}>
        <Drawer.Portal>
          <Drawer.Overlay className="sidebar-overlay" />
          <Drawer.Content
            className="sidebar mobile-sidebar"
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
