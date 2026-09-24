"use client";
import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { CalendarClock } from "lucide-react";
import { Button, Input } from "@/components/ui/controls";
import { followUpPresets } from "@/lib/attention";

/**
 * Setting the next follow-up.
 *
 * Typing a date is the step people skip, and a skipped follow-up is how a
 * lead goes quiet. The common answers are therefore one tap, with a date
 * field kept for the genuine exceptions rather than as the default path.
 */
export default function FollowUpControl({
  onChoose,
  onClear,
  busy,
  compact,
}: {
  onChoose: (date: string, label: string) => void;
  onClear?: () => void;
  busy?: boolean;
  compact?: boolean;
}) {
  const [custom, setCustom] = useState("");
  return (
    <div className={`follow-up-control${compact ? " is-compact" : ""}`}>
      <span className="follow-up-label">
        <CalendarClock size={14} aria-hidden="true" /> Follow up
      </span>
      <div className="follow-up-presets">
        {followUpPresets().map((preset) => (
          <Button
            key={preset.label}
            className="secondary"
            disabled={busy}
            onClick={() => onChoose(preset.date, preset.label)}
          >
            {preset.label}
          </Button>
        ))}
        <Input
          type="date"
          aria-label="Follow-up date"
          value={custom}
          disabled={busy}
          onChange={(e) => {
            const value = e.target.value;
            setCustom(value);
            if (value) onChoose(value, value);
          }}
        />
        {onClear && (
          <Button className="secondary" disabled={busy} onClick={onClear}>
            No follow-up
          </Button>
        )}
      </div>
    </div>
  );
}


/**
 * The same choices, behind one button.
 *
 * A list row is not the place for five permanent buttons: repeated down a
 * table they triple its height and say the same thing on every line. The
 * presets live in a popover so the row stays scannable and the choice is still
 * one click away.
 */
export function FollowUpMenu({
  onChoose,
  busy,
  label = "Follow up",
}: {
  onChoose: (date: string) => void;
  busy?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const pick = (date: string) => {
    setOpen(false);
    onChoose(date);
  };
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button className="secondary follow-up-menu-trigger" disabled={busy}>
          <CalendarClock size={14} aria-hidden="true" />
          {label}
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="follow-up-menu"
          align="end"
          sideOffset={6}
          aria-label="Choose a follow-up date"
        >
          {followUpPresets().map((preset) => (
            <Button key={preset.label} className="follow-up-menu-item" onClick={() => pick(preset.date)}>
              <span>{preset.label}</span>
              <small>{preset.date.slice(5)}</small>
            </Button>
          ))}
          <label className="follow-up-menu-date">
            Choose date
            <Input
              type="date"
              aria-label="Follow-up date"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                if (e.target.value) pick(e.target.value);
              }}
            />
          </label>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
