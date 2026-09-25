"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Command, X, Clock, Pin, CornerDownLeft } from "lucide-react";
import { Button, Input, Dialog } from "./ui/controls";

export type CommandItem = {
  id: string;
  label: string;
  detail: string;
  /** Records are grouped apart from commands and carry their own section. */
  record?: boolean;
  /** Optional grouping; defaults are derived from `detail`. */
  group?: string;
  /** Narrows the palette in place instead of dismissing it. */
  keepOpen?: boolean;
  run: () => void;
};

/**
 * The command palette.
 *
 * One place to go anywhere, create anything, or pull up a specific operational
 * slice — overdue follow-ups, quotations nobody has answered — without
 * building a filter by hand. Opened with Cmd/Ctrl+K, but every entry is also
 * reachable by pointer, so the shortcut is an accelerant rather than a
 * requirement.
 *
 * With no query it shows what the person pinned and what they last opened,
 * because the next thing someone needs is usually the last thing they touched.
 */
export default function CommandMenu({
  items,
  onClose,
}: {
  items: CommandItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const groupOf = (i: CommandItem) =>
    i.group ??
    (i.record
      ? "Records"
      : i.detail.startsWith("Create")
        ? "Create"
        : "Go to");

  // Matching is over the label and its description, in memory: the records are
  // already loaded, so a keystroke costs nothing and reaches no network.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? items.filter((i) => `${i.label} ${i.detail}`.toLowerCase().includes(needle))
      : items.filter(
          (i) =>
            i.group === "Pinned" ||
            i.group === "Recent" ||
            // A chosen slice's results, which only exist while one is active.
            i.group === "Records" ||
            !i.record,
        );
    return matched.slice(0, 40);
  }, [items, query]);

  // A changed result set must not leave the highlight pointing at nothing.
  useEffect(() => setActive(0), [query]);

  const sections = useMemo(() => {
    const order = ["Pinned", "Recent", "Go to", "Create", "Find", "Records"];
    const grouped = new Map<string, CommandItem[]>();
    for (const item of visible) {
      const group = groupOf(item);
      grouped.set(group, [...(grouped.get(group) ?? []), item]);
    }
    return [...grouped.entries()].sort(
      (a, b) => (order.indexOf(a[0]) + 99) % 99 - ((order.indexOf(b[0]) + 99) % 99),
    );
  }, [visible]);

  // Flattened in render order, so ↑/↓ move the way the eye does.
  const flat = sections.flatMap(([, list]) => list);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!flat.length) return;
      setActive((current) => {
        const next = e.key === "ArrowDown" ? current + 1 : current - 1;
        return (next + flat.length) % flat.length;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[active];
      if (item) {
        item.run();
        if (!item.keepOpen) onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  // Keep the highlighted row in view when the keyboard drives the list.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let index = -1;

  return (
    <Dialog title="Quick actions" onClose={onClose} className="command-dialog">
      <div className="command-heading">
        <span className="command-emblem"><Command size={19} aria-hidden="true" /></span>
        <div>
          <h2>Quick actions</h2>
          <p>Jump to a page, create a record, or pull up work that needs attention.</p>
        </div>
        <Button className="icon-button" aria-label="Close command menu" onClick={onClose}>
          <X size={18} />
        </Button>
      </div>

      <div className="command-search">
        <Search size={16} aria-hidden="true" />
        <Input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="command-results"
          aria-activedescendant={flat[active] ? `command-${flat[active].id}` : undefined}
          aria-label="Search commands and records"
          placeholder="Search records, pages and actions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="command-results" id="command-results" role="listbox" ref={listRef}>
        {flat.length === 0 && (
          <p className="command-empty">
            Nothing matches “{query.trim()}”. Try a company, a contact or a page name.
          </p>
        )}
        {sections.map(([group, list]) => (
          <div key={group} className="command-section">
            <p className="command-section-title">
              {group === "Recent" && <Clock size={12} aria-hidden="true" />}
              {group === "Pinned" && <Pin size={12} aria-hidden="true" />}
              {group}
            </p>
            {list.map((item) => {
              index += 1;
              const position = index;
              return (
                <Button
                  key={item.id}
                  id={`command-${item.id}`}
                  data-index={position}
                  role="option"
                  aria-selected={position === active}
                  className={`command-item${position === active ? " is-active" : ""}`}
                  onMouseEnter={() => setActive(position)}
                  onClick={() => { item.run(); if (!item.keepOpen) onClose(); }}
                >
                  <span className="command-item-label">{item.label}</span>
                  <small>{item.detail}</small>
                  {position === active && (
                    <CornerDownLeft size={13} className="command-enter" aria-hidden="true" />
                  )}
                </Button>
              );
            })}
          </div>
        ))}
      </div>

      <p className="command-hint">
        <kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close
      </p>
    </Dialog>
  );
}
