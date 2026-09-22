"use client";
import { companyName } from "@/lib/company-name";
import { BrandLogo, brands } from "./brand";
import { Pagination, usePagination } from "./pagination";
import { useEffect, useState } from "react";
import {
  Building2,
  ArrowUpRight,
  Bell,
  CheckCheck,
  UserRound,
  Sun,
  Moon,
  Keyboard,
  ShieldCheck,
} from "lucide-react";
import { Button, Input, Select, Field } from "./ui/controls";
import { useTheme, setTheme, usePalette, setPalette, palettes } from "./theme-toggle";
import {
  allowedModules,
  labels,
  money,
  type Actor,
  type RecordItem,
} from "@/lib/domain";
import type { NotificationItem } from "@/lib/notifications";
export type WorkspaceView =
  "notifications" | "profile" | "appearance" | "access" | "shortcuts";
export const viewLabels: Record<WorkspaceView, string> = {
  notifications: "Notifications",
  profile: "My profile",
  appearance: "Appearance",
  access: "Access control",
  shortcuts: "Shortcuts",
};
export function PageTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">WORKSPACE</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
export function ProfilePage({
  actor,
  onAppearance,
}: {
  actor: Actor;
  onAppearance: () => void;
}) {
  const modules = allowedModules(actor);
  return (
    <>
      <PageTitle
        title="My profile"
        subtitle="Your personal space, preferences and company access."
      />
      <section className="panel profile-hero">
        <div className="profile-cover">
          <span>ENERCORE</span>
          <ShieldCheck size={28} />
        </div>
        <div className="profile-hero-body">
          <span className="profile-large-avatar">
            {actor.name
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("")}
          </span>
          <div className="profile-heading">
            <h2>{actor.name}</h2>
            <p>{actor.email || "preview@example.invalid"}</p>
            <span className="badge blue">{actor.role}</span>
          </div>
          <Button className="secondary" onClick={onAppearance}>
            <Sun size={16} />
            Appearance preferences
          </Button>
        </div>
        <div className="profile-summary">
          <span>
            <strong>{actor.companies.length}</strong> Assigned companies
          </span>
          <span>
            <strong>{modules.length}</strong> Available modules
          </span>
          <span>
            <ShieldCheck size={17} /> Role-based access
          </span>
        </div>
      </section>
      <div className="profile-sections">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Account details</h2>
              <p>Your workspace identity</p>
            </div>
            <UserRound size={19} />
          </div>
          <dl className="account-details">
            <div>
              <dt>Full name</dt>
              <dd>{actor.name}</dd>
            </div>
            <div>
              <dt>Email address</dt>
              <dd>{actor.email || "Preview account · no email connected"}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{actor.role}</dd>
            </div>
          </dl>
          <p className="profile-footnote">
            Contact your administrator to update your identity or permissions.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Your companies</h2>
              <p>Companies included in your access</p>
            </div>
            <Building2 size={19} />
          </div>
          <div className="profile-companies">
            {actor.companies.map((c) => (
              <div className="profile-company" key={c}>
                <BrandLogo company={c} />
                <span>{brands[c]?.label || c}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel profile-permissions">
          <div className="panel-heading">
            <div>
              <h2>Module permissions</h2>
              <p>Your role sets the actions available within each module.</p>
            </div>
            <ShieldCheck size={19} />
          </div>
          <div className="permission-summary">
            {modules.map((m) => (
              <div key={m}>
                <span>{labels[m]}</span>
                <span className="permission-level">
                  {actor.role === "MD Assistant" ||
                  actor.moduleAccess?.[m] === "read"
                    ? "View only"
                    : "Role permissions"}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
export function AppearancePage() {
  const theme = useTheme();
  const palette = usePalette();
  return (
    <>
      <PageTitle
        title="Appearance"
        subtitle="Choose a comfortable display. Your preference is remembered on this browser."
      />
      <section className="panel appearance-panel">
        <h2>Display mode</h2>
        <div className="theme-choices">
          {(["light", "dark"] as const).map((t) => (
            <Button
              className={`theme-choice ${theme === t ? "selected" : ""}`}
              key={t}
              aria-pressed={theme === t}
              onClick={() => setTheme(t)}
            >
              <span className={`theme-preview ${t}`}>
                <i />
                <span>
                  <b />
                  <b />
                  <b />
                </span>
              </span>
              <span>
                {t === "light" ? <Sun size={18} /> : <Moon size={18} />}{" "}
                {t === "light" ? "Light mode" : "Dark mode"}
                {theme === t && <small>Selected</small>}
              </span>
            </Button>
          ))}
        </div>
        <h2 className="palette-title">Colour palette</h2>
        <p className="muted">Personalise your workspace accents. Company logos and quotation documents keep their original branding.</p>
        <div className="palette-grid">
          {palettes.map(p => <Button key={p.id} className={`palette-choice ${palette === p.id ? "selected" : ""}`} aria-pressed={palette === p.id} onClick={() => setPalette(p.id)}>
            <span className="palette-swatches" aria-hidden="true">{p.colors.map(color => <i key={color} style={{ background: color }} />)}</span>
            <span>{p.name}</span><small>{palette === p.id ? "Selected" : "Apply palette"}</small>
          </Button>)}
        </div>
      </section>
    </>
  );
}
export function NotificationsPage({
  items,
  read,
  onRead,
  onReadAll,
  onOpen,
}: {
  items: NotificationItem[];
  read: string[];
  onRead: (id: string) => void;
  onReadAll: () => void;
  onOpen: (recordId: string) => void;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [company, setCompany] = useState("all");
  const visible = items.filter(
    (n) =>
      (filter !== "unread" || !read.includes(n.id)) &&
      (filter !== "action" || n.category === "action") &&
      (company === "all" || n.company === company) &&
      `${n.title} ${n.detail}`.toLowerCase().includes(search.toLowerCase()),
  );
  const pagination = usePagination(visible, `${filter}|${search}|${company}`);
  return (
    <>
      <PageTitle
        title="Notifications"
        subtitle="Follow-ups, approvals and workspace updates in one inbox."
      />
      <section className="panel">
        <div className="records-toolbar">
          <div className="segmented">
            {[
              ["all", "All"],
              ["unread", "Unread"],
              ["action", "Needs action"],
            ].map(([v, l]) => (
              <Button
                key={v}
                className={filter === v ? "selected" : ""}
                onClick={() => setFilter(v)}
              >
                {l}
                {v === "unread"
                  ? ` (${items.filter((i) => !read.includes(i.id)).length})`
                  : ""}
              </Button>
            ))}
          </div>
          <Button className="secondary" onClick={onReadAll}>
            <CheckCheck size={16} />
            Mark all read
          </Button>
        </div>
        <div className="inbox-filters">
          <Input
            aria-label="Search notifications"
            placeholder="Search notifications…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Field>
            <Select
              aria-label="Notification company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            >
              <option value="all">All companies</option>
              {Array.from(new Set(items.map((n) => n.company))).map((c) => (
                <option key={c} value={c}>
                  {companyName(c)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {pagination.items.map((n) => (
          <article
            className={`inbox-row ${read.includes(n.id) ? "" : "unread"}`}
            key={n.id}
          >
            <span className="inbox-icon">
              <Bell size={18} />
            </span>
            <div>
              <h3>{n.title}</h3>
              <p>{n.detail}</p>
              <small>
                {companyName(n.company)} · {new Date(n.at).toLocaleString()}
              </small>
            </div>
            <div className="inbox-actions">
              <Button
                className="secondary"
                onClick={() => {
                  onRead(n.id);
                  onOpen(n.recordId);
                }}
              >
                Open
              </Button>
              {!read.includes(n.id) && (
                <Button className="text-button" onClick={() => onRead(n.id)}>
                  Mark read
                </Button>
              )}
            </div>
          </article>
        ))}
        {!visible.length && (
          <div className="empty">
            <Bell />
            <h3>No notifications</h3>
            <p>Nothing matches this view.</p>
          </div>
        )}
      </section>
      <Pagination {...pagination} label="notifications" />
      <p className="small muted preference-note">
        Read status is saved on this device. External email and WhatsApp
        delivery are not connected.
      </p>
    </>
  );
}
export function ShortcutsPage({ onCommand }: { onCommand: () => void }) {
  return (
    <>
      <PageTitle
        title="Shortcuts & quick actions"
        subtitle="Get to the next task with fewer clicks."
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>Keyboard shortcuts</h2>
          <Keyboard size={22} />
        </div>
        {[
          ["⌘ / Ctrl + K", "Search pages, records and quick actions"],
          ["/", "Open quick search (outside a text field)"],
          ["Alt + N", "Create a record in the current module"],
          ["Esc", "Close the current popup"],
        ].map(([key, text]) => (
          <div className="settings-row" key={key}>
            <span>{text}</span>
            <kbd>{key}</kbd>
          </div>
        ))}
        <div className="settings-body">
          <Button className="primary" onClick={onCommand}>
            Open command menu
          </Button>
        </div>
      </section>
      <section className="panel automation-summary">
        <div className="panel-heading">
          <h2>Less typing, connected work</h2>
        </div>
        <div className="settings-body">
          <p>
            Saved customer and product details fill quotation drafts. Accepted
            quotations create linked orders, shipments and draft invoices.
            Follow-up dates and status changes surface in your notification
            inbox.
          </p>
          <p>
            Outbound messages and scheduled reminders require a configured
            delivery service; nothing is sent automatically from this preview.
          </p>
        </div>
      </section>
    </>
  );
}
