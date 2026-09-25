"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { SmilePlus } from "lucide-react";
import { EMOJI_SET, QUICK_REACTIONS, type ReactionView } from "@/lib/collab";
import { Button } from "../ui/controls";

/**
 * Reactions: subtle chips under a message ("👍 3"), mine highlighted; click
 * to toggle mine. The picker offers five quick reactions and the full set.
 */

export function ReactionChips({
  reactions,
  meId,
  nameOf,
  disabled,
  onToggle,
}: {
  reactions: ReactionView[];
  meId: string;
  nameOf: (id: string) => string;
  disabled?: boolean;
  onToggle: (emoji: string, on: boolean) => void;
}) {
  if (!reactions.length) return null;
  return (
    <div className="collab-reactions">
      {reactions.map((r) => {
        const mine = r.userIds.includes(meId);
        const who = r.userIds.map((id) => (id === meId ? "You" : nameOf(id))).join(", ");
        return (
          <button
            key={r.emoji}
            type="button"
            className={`collab-reaction${mine ? " is-mine" : ""}`}
            aria-pressed={mine}
            aria-label={`${r.emoji} ${r.userIds.length}: ${who}. ${mine ? "Remove your reaction" : "React"}`}
            title={who}
            disabled={disabled}
            onClick={() => onToggle(r.emoji, !mine)}
          >
            <span aria-hidden="true">{r.emoji}</span>
            <b aria-hidden="true">{r.userIds.length}</b>
          </button>
        );
      })}
    </div>
  );
}

export function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setMore(false);
      }}
    >
      <Popover.Trigger asChild>
        <Button className="icon-button" aria-label="Add reaction" title="React">
          <SmilePlus size={15} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="collab-reaction-picker" side="top" align="end" sideOffset={6} aria-label="Reactions">
          <div className="collab-reaction-quick">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`React ${emoji}`}
                onClick={() => {
                  onPick(emoji);
                  setOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
            <button type="button" className="collab-reaction-more" aria-expanded={more} onClick={() => setMore(!more)}>
              More
            </button>
          </div>
          {more && (
            <div className="collab-emoji collab-reaction-all">
              {EMOJI_SET.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`React ${emoji}`}
                  onClick={() => {
                    onPick(emoji);
                    setOpen(false);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
