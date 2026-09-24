"use client";
import { useState } from "react";
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
