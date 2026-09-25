"use client";
import { useState } from "react";
import { BrandLogo } from "./brand";
import Link from "next/link";
import * as Drawer from "@radix-ui/react-dialog";
import {
  Activity,
  Box,
  Building2,
  CalendarDays,
  ChevronDown,
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
  Bell,
  Sun,
  Keyboard,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import {
  allowedModules,
  labels,
  canManageUsers,
  type Actor,
  type Module,
} from "@/lib/domain";
import { type WorkspaceView } from "./workspace-pages";
import { Button, Tooltip } from "./ui/controls";
import { Avatar } from "./avatar";
import { useAvatar } from "@/lib/avatar-store";
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
const groups: [string, Module[]][] = [
  ["Workspace", ["overview", "leads", "quotations", "orders"]],
  [
    "Operations",
    ["logistics", "accounts", "customers", "suppliers", "products"],
  ],
  ["Organization", ["hr", "marketing", "it"]],
  ["Manage", ["approvals", "activity", "settings"]],
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
  const [closed, setClosed] = useState<string[]>([]);
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
        <nav aria-label={isMobile ? "Mobile navigation" : "Main navigation"}>
          <Tooltip label="Collaboration" enabled={compact}>
            <Button
              className={`nav-item nav-item-collab ${module === "collaboration" ? "active" : ""}`}
              onClick={() => onView("collaboration")}
              aria-label={
                collabUnread
                  ? `Collaboration, ${collabUnread} unread${collabMentions ? `, ${collabMentions} mentions` : ""}`
                  : "Collaboration"
              }
              aria-current={module === "collaboration" ? "page" : undefined}
            >
              <MessagesSquare size={19} />
              <span className="nav-label">Collaboration</span>
              {collabMentions > 0 ? (
                <b className="nav-count nav-count-mention">@</b>
              ) : collabUnread > 0 ? (
                <b className="nav-count nav-count-subtle">{collabUnread > 99 ? "99+" : collabUnread}</b>
              ) : null}
            </Button>
          </Tooltip>
          {groups.map(([title, items]) => {
            const visible = items.filter((m) => permitted.includes(m));
            if (!visible.length) return null;
            const open = compact || !closed.includes(title);
            return (
              <section className="nav-group" key={title}>
                <Button
                  className="nav-group-toggle"
                  tabIndex={compact ? -1 : 0}
                  aria-hidden={compact}
                  aria-expanded={open}
                  aria-controls={`${isMobile ? "mobile" : "desktop"}-${title}`}
                  onClick={() =>
                    setClosed(
                      closed.includes(title)
                        ? closed.filter((t) => t !== title)
                        : [...closed, title],
                    )
                  }
                >
                  <span>{title}</span>
                  <ChevronDown size={12} className={open ? "" : "is-rotated"} />
                </Button>
                <div
                  className={`nav-group-content ${open ? "is-expanded" : ""}`}
                  id={`${isMobile ? "mobile" : "desktop"}-${title}`}
                  inert={!open}
                >
                  <div>
                    {visible.map((m) => {
                      const Icon = icons[m];
                      return (
                        <Tooltip key={m} label={labels[m]} enabled={compact}>
                          <Button
                            className={`nav-item ${module === m ? "active" : ""}`}
                            onClick={() => onNavigate(m)}
                            aria-label={labels[m]}
                            aria-current={module === m ? "page" : undefined}
                          >
                            <Icon size={19} />
                            <span className="nav-label">{labels[m]}</span>
                            {m === "approvals" && approvalCount > 0 && (
                              <b className="nav-count">{approvalCount}</b>
                            )}
                          </Button>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              </section>
            );
          })}
          {canManageUsers(actor) && (
            <Tooltip label="Access control" enabled={compact}>
              <Button
                className={`nav-item ${module === "access" ? "active" : ""}`}
                onClick={() => onView("access")}
                aria-label="Access control"
              >
                <ShieldCheck size={19} />
                <span className="nav-label">Access control</span>
              </Button>
            </Tooltip>
          )}
          <Tooltip label="Notifications" enabled={compact}>
            <Button
              className={`nav-item ${module === "notifications" ? "active" : ""}`}
              onClick={() => onView("notifications")}
              aria-label="Notifications"
            >
              <Bell size={19} />
              <span className="nav-label">Notifications</span>
            </Button>
          </Tooltip>
          <Tooltip label="Shortcuts" enabled={compact}>
            <Button
              className={`nav-item ${module === "shortcuts" ? "active" : ""}`}
              onClick={() => onView("shortcuts")}
              aria-label="Shortcuts"
            >
              <Keyboard size={19} />
              <span className="nav-label">Shortcuts</span>
            </Button>
          </Tooltip>
        </nav>
        <div className="sidebar-bottom">
          <Tooltip label="Appearance" enabled={compact}>
            <Button
              className={`nav-item ${module === "appearance" ? "active" : ""}`}
              onClick={() => onView("appearance")}
              aria-label="Appearance"
            >
              <Sun size={19} />
              <span className="nav-label">Appearance</span>
            </Button>
          </Tooltip>
          <Tooltip label="My requests" enabled={compact}>
            <Link
              className={`nav-item ${module === "my-requests" ? "active" : ""}`}
              aria-current={module === "my-requests" ? "page" : undefined}
              href="/my-requests"
              onClick={(event) => {
                if (
                  onMyRequests &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey
                ) {
                  event.preventDefault();
                  onMyRequests();
                }
              }}
              aria-label="My requests"
            >
              <CalendarDays size={19} />
              <span className="nav-label">My requests</span>
            </Link>
          </Tooltip>
          <div className="connection">
            <i />
            <span>{preview ? "Preview environment" : "Secure workspace"}</span>
            <ShieldCheck size={13} />
          </div>
          <Button
            className="profile profile-link"
            aria-label="Open my profile"
            onClick={() => onView("profile")}
          >
            <Avatar name={actor.name} image={photo} size={36} />
            <span className="profile-info">
              {actor.name}
              <small>{actor.role}</small>
            </span>
            <span className="profile-presence" />
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
