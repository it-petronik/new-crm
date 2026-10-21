"use client";
import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { CalendarClock } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui/controls";
import { followUpPresets } from "@/lib/attention";

/**
 * Setting the next follow-up.
 *
 * Typing a date is the step people skip, and a skipped follow-up is how a
 * lead goes quiet. A single labelled choice keeps common answers easy to find,
 * with a date field only when the person chooses a custom date.
 */
export default function FollowUpControl({
  onChoose,
  onClear,
  busy,
  compact,
  value,
}: {
  onChoose: (date: string, label: string) => void;
  onClear?: () => void;
  busy?: boolean;
  compact?: boolean;
  value?: string;
}) {
  const [customDate, setCustomDate] = useState(false);
  const [localDate, setLocalDate] = useState<string | undefined>(value);
  const date = value ?? localDate;
  const presets = followUpPresets();
  const preset = presets.find(item => item.date === date);
  const selection = customDate || (date && !preset) ? "custom" : preset?.date || (onClear ? "none" : "choose");
  return (
    <div className={`follow-up-control${compact ? " is-compact" : ""}`}>
      <span className="follow-up-label">
        <CalendarClock size={14} aria-hidden="true" /> Follow up
      </span>
      <div className="follow-up-choices">
        <Select aria-label="Follow-up timing" value={selection} disabled={busy} onChange={event => {
          const next = event.target.value;
          setCustomDate(next === "custom");
          if (next === "none") { setLocalDate(undefined); onClear?.(); }
          const chosen = presets.find(item => item.date === next);
          if (chosen) { setLocalDate(chosen.date); onChoose(chosen.date, chosen.label); }
        }}>
          {!onClear && <option value="choose" disabled>Choose when to follow up</option>}
          {presets.map(item => <option key={item.label} value={item.date}>{item.label}</option>)}
          <option value="custom">Choose a date</option>
          {onClear && <option value="none">No follow-up</option>}
        </Select>
        {selection === "custom" && <Field>Follow-up date<Input
          type="date"
          aria-label="Follow-up date"
          value={date ?? ""}
          disabled={busy}
          onChange={(e) => {
            const value = e.target.value;
            setLocalDate(value);
            if (value) onChoose(value, value);
          }}
        /></Field>}
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
