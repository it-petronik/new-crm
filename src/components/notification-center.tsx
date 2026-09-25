"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Bell,
  CheckCheck,
  CircleCheck,
  Clock,
  MessageSquare,
  ShieldAlert,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "./ui/controls";
import { PageTitle } from "./workspace-pages";
import { businessStamp, businessTime, businessToday } from "@/lib/gst";
import type { NotificationCategory, NotificationPreferences, NotificationView } from "@/lib/notification-types";
import { desktopPermission, desktopSupported } from "@/lib/notifications-client";
import { useOverflowFade } from "@/lib/use-overflow-fade";

/**
 * The notification inbox, its settings, and the in-app toasts. Every item
 * comes from the server; opening one goes through the normal record or
 * conversation access checks again.
 */

const ICONS: Record<NotificationCategory, LucideIcon> = {
  assignment: UserPlus,
  approval: CircleCheck,
  collaboration: MessageSquare,
  reminder: Clock,
  update: Activity,
  security: ShieldAlert,
};

type Filter = "all" | "unread" | "assignment" | "approval" | "collaboration";
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["unread", "Unread"],
  ["assignment", "Assignments"],
  ["approval", "Approvals"],
  ["collaboration", "Collaboration"],
];

/** Today's items show a time; older ones a date and time. Always Gulf time. */
function when(at: string) {
  const date = new Date(at);
  return businessToday(date) === businessToday() ? `${businessTime(date)} GST` : businessStamp(date);
}

function Priority({ level }: { level: NotificationView["priority"] }) {
  if (level === "normal") return null;
  return <span className={`notify-priority is-${level}`}>{level === "urgent" ? "Urgent" : "Important"}</span>;
}

function Row({
  n,
  onOpen,
  onRead,
}: {
  n: NotificationView;
  onOpen: (n: NotificationView) => void;
  onRead: (ids: string[], read: boolean) => void;
}) {
  const Icon = ICONS[n.category] ?? Bell;
  const unread = !n.readAt;
  return (
    <li className={`notify-row${unread ? " is-unread" : ""}`}>
      <button
        type="button"
        className="notify-main"
        disabled={!n.target}
        onClick={() => onOpen(n)}
        aria-label={`${n.title}${unread ? ", unread" : ""}`}
      >
        <span className={`notify-icon is-${n.category}`} aria-hidden="true">
          <Icon size={17} />
        </span>
        <span className="notify-text">
          <span className="notify-title">
            {n.title}
            <Priority level={n.priority} />
          </span>
          {!!n.body && <span className="notify-body">{n.body}</span>}
          <span className="notify-meta">
            {n.actor ? `${n.actor.name} · ` : ""}
            <time dateTime={n.createdAt}>{when(n.createdAt)}</time>
          </span>
        </span>
        {unread && <i className="notify-dot" aria-hidden="true" />}
      </button>
      <Button
        className="icon-button notify-toggle"
        aria-label={unread ? `Mark "${n.title}" as read` : `Mark "${n.title}" as unread`}
        title={unread ? "Mark as read" : "Mark as unread"}
        onClick={() => onRead([n.id], unread)}
      >
        {unread ? <CheckCheck size={16} /> : <Bell size={16} />}
      </Button>
    </li>
  );
}

export function NotificationSettings({
  preferences,
  onSave,
}: {
  preferences: NotificationPreferences;
  onSave: (p: NotificationPreferences) => Promise<void>;
}) {
  // Read after mount so the server render and the first client render agree.
  const [permission, setPermission] = useState<ReturnType<typeof desktopPermission>>("default");
  useEffect(() => setPermission(desktopPermission()), []);
  const [error, setError] = useState("");
  const save = (next: NotificationPreferences) => {
    setError("");
    onSave(next).catch((e: Error) => setError(e.message));
  };
  // Asking for permission happens only here, from the person's own click.
  const enableDesktop = async () => {
    if (!desktopSupported()) return;
    const result = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    setPermission(result);
    if (result === "granted") save({ ...preferences, desktop: true });
  };
  return (
    <section className="panel notify-settings" aria-labelledby="notify-settings-title">
      <div className="panel-heading">
        <h2 id="notify-settings-title">Notification settings</h2>
      </div>
      <div className="settings-row">
        <span>
          <strong>Desktop notifications</strong>
          <small>
            {permission === "unsupported"
              ? "This browser can't show desktop notifications."
              : permission === "denied"
                ? "Blocked in this browser. Allow notifications for this site in your browser settings."
                : "Shown when Enercore is open in a background tab. Closed-browser alerts aren't available yet."}
          </small>
        </span>
        {preferences.desktop && permission === "granted" ? (
          <Button className="secondary" onClick={() => save({ ...preferences, desktop: false })}>
            Turn off
          </Button>
        ) : (
          <Button className="primary" disabled={permission === "unsupported" || permission === "denied"} onClick={() => void enableDesktop()}>
            Enable
          </Button>
        )}
      </div>
      <div className="settings-row">
        <span>
          <strong>Message preview</strong>
          <small>Show message text in toasts and desktop notifications.</small>
        </span>
        <Button
          className="secondary"
          aria-pressed={preferences.preview}
          onClick={() => save({ ...preferences, preview: !preferences.preview })}
        >
          {preferences.preview ? "On" : "Off"}
        </Button>
      </div>
      <p className="small muted notify-settings-note">
        Security and account notifications are always kept in your inbox.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function NotificationsPage({
  items,
  unread,
  loaded,
  error,
  hasMore,
  preferences,
  onOpen,
  onRead,
  onReadAll,
  onMore,
  onSavePreferences,
}: {
  items: NotificationView[];
  unread: number;
  loaded: boolean;
  error: boolean;
  hasMore: boolean;
  preferences: NotificationPreferences;
  onOpen: (n: NotificationView) => void;
  onRead: (ids: string[], read: boolean) => void;
  onReadAll: () => void;
  onMore: () => Promise<void>;
  onSavePreferences: (p: NotificationPreferences) => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [loadingMore, setLoadingMore] = useState(false);
  // One row that scrolls sideways on a phone, like the other segmented strips.
  const filterStrip = useOverflowFade<HTMLDivElement>("x");
  const visible = items.filter((n) =>
    filter === "all" ? true : filter === "unread" ? !n.readAt : n.category === filter,
  );
  const today = businessToday();
  const action = visible.filter((n) => n.needsAction);
  const rest = visible.filter((n) => !n.needsAction);
  const sections: [string, NotificationView[]][] = [
    ["Needs action", action],
    ["Today", rest.filter((n) => businessToday(new Date(n.createdAt)) === today)],
    ["Earlier", rest.filter((n) => businessToday(new Date(n.createdAt)) !== today)],
  ];
  return (
    <>
      <PageTitle title="Notifications" subtitle="Assignments, approvals, reminders and mentions — as they happen." />
      <section className="panel notify-panel">
        <div className="notify-toolbar">
          <div ref={filterStrip} className="segmented notify-filters overflow-fade-x" role="group" aria-label="Show">
            {FILTERS.map(([value, label]) => (
              <Button key={value} className={filter === value ? "selected" : ""} aria-pressed={filter === value} onClick={(e) => {
                setFilter(value);
                e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
              }}>
                {label}
                {value === "unread" && unread > 0 ? ` (${unread > 99 ? "99+" : unread})` : ""}
              </Button>
            ))}
          </div>
          <Button className="secondary" disabled={!unread} onClick={onReadAll}>
            <CheckCheck size={16} aria-hidden="true" />
            Mark all read
          </Button>
        </div>
        {!loaded ? (
          <p className="notify-empty muted">Loading notifications…</p>
        ) : error && !items.length ? (
          <p className="notify-empty" role="alert">
            Notifications couldn&apos;t be loaded. They&apos;ll appear when you&apos;re back online.
          </p>
        ) : !visible.length ? (
          <div className="empty">
            <Bell aria-hidden="true" />
            <h3>You&apos;re all caught up</h3>
            <p>{filter === "all" ? "New assignments, approvals and mentions will appear here." : "Nothing in this view."}</p>
          </div>
        ) : (
          sections
            .filter(([, list]) => list.length)
            .map(([heading, list]) => (
              <div className="notify-section" key={heading}>
                <h2 className="notify-heading">{heading}</h2>
                <ul className="notify-list">
                  {list.map((n) => (
                    <Row key={n.id} n={n} onOpen={onOpen} onRead={onRead} />
                  ))}
                </ul>
              </div>
            ))
        )}
        {hasMore && (
          <div className="notify-more">
            <Button
              className="secondary"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                void onMore().finally(() => setLoadingMore(false));
              }}
            >
              {loadingMore ? "Loading…" : "Show older"}
            </Button>
          </div>
        )}
      </section>
      <NotificationSettings preferences={preferences} onSave={onSavePreferences} />
    </>
  );
}

/** Compact live toasts; at most three, newest on top. */
export function NotificationToasts({
  toasts,
  preferences,
  onOpen,
  onDismiss,
}: {
  toasts: NotificationView[];
  preferences: NotificationPreferences;
  onOpen: (n: NotificationView) => void;
  onDismiss: (id: string) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div className="notify-toasts" role="region" aria-label="New notifications">
      {toasts.map((n) => {
        const Icon = ICONS[n.category] ?? Bell;
        const body = n.category === "collaboration" && !preferences.preview ? "New message" : n.body;
        return (
          <div className={`notify-toast is-${n.priority}`} key={n.id} role="status">
            <button type="button" className="notify-toast-main" disabled={!n.target} onClick={() => onOpen(n)}>
              <span className={`notify-icon is-${n.category}`} aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className="notify-text">
                <span className="notify-title">{n.title}</span>
                {!!body && <span className="notify-body">{body}</span>}
                {n.actor && n.category !== "collaboration" && <span className="notify-meta">By {n.actor.name}</span>}
              </span>
            </button>
            <Button className="icon-button" aria-label="Dismiss notification" onClick={() => onDismiss(n.id)}>
              <X size={14} />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
