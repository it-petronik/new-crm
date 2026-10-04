"use client";
import { useEffect, useId, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { CircleHelp, X } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import styles from "./layout.module.css";
import { useOverflowFade } from "@/lib/use-overflow-fade";
import { pageGuides, type PageHelp } from "@/lib/workspace-help";

/* ---------------------------------------------------------------------------
   Layout primitives.

   One vocabulary for page structure, so every screen reads the same way:

     PageHeader   title, one line of context, the page's actions
     Section      a titled group of content — spacing and a heading, no box
     Tabs         switches between a record's areas (ARIA tabs, arrow keys)
     Metric       one figure with its label, for compact summaries
     EmptyState   what is empty, why, and what to do
     Surface      a shared boundary with explicit padding
     Toolbar      a wrapping row of related controls
     FormGrid     responsive, equal-width form fields

   Only Surface draws a card. Add one where it means something, such as a
   record list, comparison, or financial summary.
   ------------------------------------------------------------------------ */

const cx = (...values: (string | false | null | undefined)[]) => values.filter(Boolean).join(" ");

export function PageHeader({
  title,
  description,
  actions,
  kicker,
  className,
  guide,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  kicker?: ReactNode;
  className?: string;
  guide?: PageHelp;
}) {
  const pageGuide = guide || (typeof title === "string" ? pageGuides[title] : undefined);
  return (
    <header data-ui="page-header" className={cx("ui-page-header", styles.pageHeader, className?.split(" ").filter(name => name !== "page-heading").join(" "))}>
      <div className={styles.heading}>
        {kicker && <p className="ui-page-kicker">{kicker}</p>}
        <div className={styles.titleRow}><h1>{title}</h1>
        {pageGuide && <Popover.Root>
          <Popover.Trigger className={cx("ui-page-guide", styles.guide)} aria-label="How this page works"><CircleHelp size={15} aria-hidden="true"/><span>Guide</span></Popover.Trigger>
          <Popover.Portal><Popover.Content className={cx("ui-guide-popover", styles.guideContent)} align="start" sideOffset={10} collisionPadding={16} aria-label="How this page works">
            <div className={styles.guideHeading}><span><CircleHelp size={17} aria-hidden="true"/><strong>How this page works</strong></span><Popover.Close aria-label="Close guide"><X size={16}/></Popover.Close></div>
            <p>{pageGuide.purpose}</p><ol>{pageGuide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            <p className={styles.guideTip}>Open a name for details. A question mark explains an unfamiliar field.</p>
          </Popover.Content></Popover.Portal>
        </Popover.Root>}
        </div>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={cx("ui-page-actions", styles.actions)}>{actions}</div>}
    </header>
  );
}

/** Shared boundaries: pages compose these, rather than adding another panel style. */
export function Surface({ children, className, padding = "normal", ...props }: HTMLAttributes<HTMLDivElement> & { padding?: "none" | "normal" | "compact" }) {
  return <div {...props} data-ui="surface" data-padding={padding} className={cx(styles.surface, className)}>{children}</div>;
}

/** Wraps naturally; do not use role=toolbar without implementing arrow-key navigation. */
export function Toolbar({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-ui="toolbar" className={cx(styles.toolbar, className)}>{children}</div>;
}

/** Equal fields at desktop widths, one column at a usable field width. */
export function FormGrid({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-ui="form-grid" className={cx(styles.formGrid, className)}>{children}</div>;
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
