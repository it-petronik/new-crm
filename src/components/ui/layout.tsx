"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useOverflowFade } from "@/lib/use-overflow-fade";

/* ---------------------------------------------------------------------------
   Layout primitives.

   One vocabulary for page structure, so every screen reads the same way:

     PageHeader   title, one line of context, the page's actions
     Section      a titled group of content — spacing and a heading, no box
     Tabs         switches between a record's areas (ARIA tabs, arrow keys)
     Metric       one figure with its label, for compact summaries
     EmptyState   what is empty, why, and what to do

   None of these draw a card. A surface is added by the caller only where it
   means something (a comparison card, a financial summary).
   ------------------------------------------------------------------------ */

const cx = (...values: (string | false | null | undefined)[]) => values.filter(Boolean).join(" ");

export function PageHeader({
  title,
  description,
  actions,
  kicker,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  kicker?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("ui-page-header", className)}>
      <div className="ui-page-heading">
        {kicker && <p className="ui-page-kicker">{kicker}</p>}
        <h1>{title}</h1>
        {description && <p className="ui-page-description">{description}</p>}
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
  level = 2,
  id,
  labelledBy,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  level?: 2 | 3;
  id?: string;
  /** Use an existing heading instead of this section's own. */
  labelledBy?: string;
}) {
  const auto = useId();
  const headingId = labelledBy || (title ? `${auto}-title` : undefined);
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className={cx("ui-section", className)} aria-labelledby={headingId} id={id}>
      {(title || actions) && (
        <div className="ui-section-head">
          <div>
            {title && <Heading id={`${auto}-title`}>{title}</Heading>}
            {description && <p className="ui-section-description">{description}</p>}
          </div>
          {actions && <div className="ui-section-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type TabItem<T extends string> = { id: T; label: ReactNode; count?: number | string; hidden?: boolean };

/**
 * ARIA tabs: one tab stop for the list, arrow keys move between tabs, Home and
 * End jump. Panels are rendered by the caller with `tabPanelProps`.
 */
export function Tabs<T extends string>({
  items,
  active,
  onChange,
  label,
  idBase,
  className,
}: {
  items: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  label: string;
  idBase: string;
  className?: string;
}) {
  const shown = items.filter((i) => !i.hidden);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  // On a narrow phone the strip scrolls; a soft edge says there is more.
  const strip = useOverflowFade<HTMLDivElement>("x");
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = shown.findIndex((i) => i.id === active);
    const next =
      e.key === "ArrowRight" ? (index + 1) % shown.length
      : e.key === "ArrowLeft" ? (index - 1 + shown.length) % shown.length
      : e.key === "Home" ? 0
      : e.key === "End" ? shown.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(shown[next].id);
    refs.current[shown[next].id]?.focus();
  };
  return (
    <div ref={strip} className={cx("ui-tabs overflow-fade-x", className)} role="tablist" aria-label={label} onKeyDown={move}>
      {shown.map((item) => (
        <button
          key={item.id}
          ref={(el) => {
            refs.current[item.id] = el;
          }}
          type="button"
          role="tab"
          id={`${idBase}-tab-${item.id}`}
          aria-controls={`${idBase}-panel-${item.id}`}
          aria-selected={item.id === active}
          tabIndex={item.id === active ? 0 : -1}
          className="ui-tab"
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined && item.count !== "" && <span className="ui-tab-count">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

export const tabPanelProps = (idBase: string, id: string) => ({
  role: "tabpanel" as const,
  id: `${idBase}-panel-${id}`,
  "aria-labelledby": `${idBase}-tab-${id}`,
  tabIndex: 0,
});

export function Metric({
  label,
  value,
  detail,
  tone,
  onClick,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "danger" | "warning" | "success";
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="ui-metric-label">{label}</span>
      <span className="ui-metric-value">{value}</span>
      {detail && <span className={cx("ui-metric-detail", tone && `tone-${tone}`)}>{detail}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className="ui-metric is-link" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="ui-metric">{body}</div>
  );
}

export function EmptyState({ title, detail, action }: { title: ReactNode; detail?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <p className="ui-empty-title">{title}</p>
      {detail && <p className="ui-empty-detail">{detail}</p>}
      {action}
    </div>
  );
}

/** True while the media query matches; false on the server and first render. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}
