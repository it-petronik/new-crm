"use client";
import { useRef, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ChevronDown, Pencil, Trash2, Phone, ArrowUpRight, MoreHorizontal } from "lucide-react";
import { Button, Select } from "@/components/ui/controls";

/**
 * The actions on a business row, in every module.
 *
 * Five controls on every row made lists wide and noisy, and put a delete
 * button beside routine work. Status stays in its own column; the record title
 * opens details. Secondary actions share one keyboard-accessible menu.
 */
export type RowAction = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  run: () => void;
};

/**
 * One labelled control holding secondary actions, for any row or card. The
 * popover is the same one the business tables use, so every overflow menu in
 * the CRM looks and behaves alike.
 */
export function MoreActions({ label, actions, triggerLabel = "Actions", trigger, triggerClassName, ariaLabel }: { label: string; actions: RowAction[]; triggerLabel?: string; trigger?: React.ReactNode; triggerClassName?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const lastFirst = useRef(false);
  const typeAhead = useRef({ text: "", at: 0 });
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  if (!actions.length) return null;
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button className={triggerClassName || "row-labelled-action"} aria-label={ariaLabel || `More actions for ${label}`} aria-haspopup="menu" onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            lastFirst.current = event.key === "ArrowUp";
            setOpen(true);
          }
        }}>
          {trigger || <><span>{triggerLabel}</span><ChevronDown size={14} aria-hidden="true" /></>}
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content ref={menu} role="menu" aria-label={`${label} actions`} className="row-overflow-menu" align="end" sideOffset={6}
          onOpenAutoFocus={event => {
            event.preventDefault();
            typeAhead.current = { text: "", at: 0 };
            const available = items();
            (lastFirst.current ? available.at(-1) : available[0])?.focus();
            lastFirst.current = false;
          }}
          onKeyDown={event => {
            const available = items();
            const index = available.indexOf(document.activeElement as HTMLButtonElement);
            let next: HTMLButtonElement | undefined;
            if (event.key === "ArrowDown") next = available[(index + 1) % available.length];
            if (event.key === "ArrowUp") next = available[(index - 1 + available.length) % available.length];
            if (event.key === "Home") next = available[0];
            if (event.key === "End") next = available.at(-1);
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
              const now = Date.now();
              const prefix = (now - typeAhead.current.at < 600 ? typeAhead.current.text : "") + event.key.toLowerCase();
              typeAhead.current = { text: prefix, at: now };
              next = [...available.slice(index + 1), ...available.slice(0, index + 1)].find(item => item.textContent?.trim().toLowerCase().startsWith(prefix));
            }
            if (next) { event.preventDefault(); next.focus(); }
            if (event.key === "Tab") setOpen(false);
          }}>
          {actions.map((action) => (
            <Button
              key={action.id}
              role="menuitem"
              tabIndex={-1}
              disabled={action.disabled}
              className={`row-overflow-item${action.destructive ? " is-destructive" : ""}`}
              onClick={() => {
                setOpen(false);
                action.run();
              }}
            >
              {action.icon}
              {action.label}
            </Button>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export function RowActions({
  label,
  status,
  statusOptions,
  onStatus,
  onOpen,
  actions = [],
  compact = false,
}: {
  /** Used for accessible names, so each row's controls are distinguishable. */
  label: string;
  status?: string;
  statusOptions?: string[];
  onStatus?: (next: string) => void;
  onOpen?: () => void;
  actions?: RowAction[];
  /** Space-constrained cards use an accessible ellipsis, not a clipped label. */
  compact?: boolean;
}) {
  return (
    <div className="table-record-actions">
      {onStatus && statusOptions && statusOptions.length > 1 && (
        <Select
          className="inline-status"
          aria-label={`Status for ${label}`}
          value={status}
          onChange={(e) => onStatus(e.target.value)}
        >
          {statusOptions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </Select>
      )}

      <MoreActions label={label} trigger={compact ? <MoreHorizontal size={15} aria-hidden="true"/> : undefined} triggerClassName={compact ? "row-compact-action" : undefined} actions={onOpen ? [{ id: "open-record", label: "Open record", icon: <ArrowUpRight size={15} />, run: onOpen }, ...actions] : actions} />
    </div>
  );
}

/** Icons shared by the standard record actions, so modules do not pick their own. */
export const rowActionIcons = {
  log: <Phone size={15} aria-hidden="true" />,
  edit: <Pencil size={15} aria-hidden="true" />,
  delete: <Trash2 size={15} aria-hidden="true" />,
};
