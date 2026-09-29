"use client";
import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { MoreHorizontal, Pencil, Trash2, Phone, ArrowUpRight } from "lucide-react";
import { Button, Select } from "@/components/ui/controls";

/**
 * The actions on a business row, in every module.
 *
 * Five controls on every row made lists wide and noisy, and put a delete
 * button beside routine work. Only the two things people do constantly stay on
 * the row — advancing the status and opening the record. Everything else,
 * including anything destructive, sits behind one overflow control where it
 * cannot be hit by accident and costs no horizontal space.
 */
export type RowAction = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  destructive?: boolean;
  run: () => void;
};

/**
 * One "More" control holding secondary actions, for any row or card. The
 * popover is the same one the business tables use, so every overflow menu in
 * the CRM looks and behaves alike.
 */
export function MoreActions({ label, actions }: { label: string; actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  if (!actions.length) return null;
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button className="icon-button" aria-label={`More actions for ${label}`} title="More">
          <MoreHorizontal size={16} />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className="row-overflow-menu" align="end" sideOffset={6}>
          {actions.map((action) => (
            <Button
              key={action.id}
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
}: {
  /** Used for accessible names, so each row's controls are distinguishable. */
  label: string;
  status?: string;
  statusOptions?: string[];
  onStatus?: (next: string) => void;
  onOpen?: () => void;
  actions?: RowAction[];
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

      {onOpen && (
        <Button className="icon-button" aria-label={`Open ${label}`} title="Open" onClick={onOpen}>
          <ArrowUpRight size={15} />
        </Button>
      )}

      <MoreActions label={label} actions={actions} />
    </div>
  );
}

/** Icons shared by the standard record actions, so modules do not pick their own. */
export const rowActionIcons = {
  log: <Phone size={15} aria-hidden="true" />,
  edit: <Pencil size={15} aria-hidden="true" />,
  delete: <Trash2 size={15} aria-hidden="true" />,
};
