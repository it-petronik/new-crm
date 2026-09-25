"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CornerUpLeft, SendHorizontal, Smile, X } from "lucide-react";
import { MESSAGE_MAX, type ConversationMemberView, type ReplyPreview } from "@/lib/collab";
import { Button } from "../ui/controls";
import { Avatar } from "../avatar";

const EMOJI = [
  "👍", "👏", "🙏", "🙌", "👌", "✅", "✔️", "❌",
  "😀", "😄", "😂", "🙂", "😉", "😊", "😍", "🤔",
  "😅", "😮", "😢", "😬", "🤝", "💪", "🎉", "🔥",
  "⭐", "💡", "📌", "📎", "📞", "📦", "🚚", "⏰",
  "❤️", "👀", "🚀", "💯", "⚠️", "ℹ️", "➡️", "🙋",
];

/**
 * An "@query" being typed at the caret, if any. Names contain spaces, so the
 * query may too ("@Petra G"); it ends at a newline, another "@", or 30
 * characters. A query that no longer matches anyone simply shows no menu.
 */
function activeMention(text: string, caret: number) {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\n@]{0,30})$/.exec(before);
  if (!match) return null;
  return { start: caret - match[2].length - 1, query: match[2].toLowerCase() };
}

export type ComposerProps = {
  members: ConversationMemberView[];
  meId: string;
  initialText?: string;
  initialMentions?: { id: string; name: string }[];
  placeholder: string;
  disabled?: boolean;
  disabledReason?: string;
  replyTo?: ReplyPreview | null;
  onCancelReply?: () => void;
  /** Resolve true when accepted, so the composer clears. */
  onSubmit: (body: string, mentionIds: string[]) => Promise<boolean> | boolean;
  onCancel?: () => void;
  mode?: "send" | "edit";
  autoFocus?: boolean;
  /** Changes whenever the conversation does, to restore that draft. */
  draftKey?: string;
};

const drafts = new Map<string, string>();

/**
 * Message input: multiline (Enter sends, Shift+Enter breaks the line),
 * @mentions limited to the conversation's members, and an emoji picker. The
 * text stays plain; mentions are sent as ids and the server re-validates them.
 */
export default function Composer({
  members,
  meId,
  initialText = "",
  initialMentions = [],
  placeholder,
  disabled,
  disabledReason,
  replyTo,
  onCancelReply,
  onSubmit,
  onCancel,
  mode = "send",
  autoFocus,
  draftKey,
}: ComposerProps) {
  const [text, setText] = useState(() => (draftKey ? (drafts.get(draftKey) ?? initialText) : initialText));
  const [picked, setPicked] = useState(initialMentions);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (draftKey && mode === "send") {
      if (text) drafts.set(draftKey, text);
      else drafts.delete(draftKey);
    }
  }, [text, draftKey, mode]);

  // Grow with the text, up to a cap, then scroll.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  useEffect(() => {
    if (autoFocus || replyTo) input.current?.focus();
  }, [autoFocus, replyTo]);

  const candidates = useMemo(() => {
    if (!mention) return [];
    return members
      .filter((m) => m.id !== meId && m.active)
      .filter((m) => !mention.query || m.name.toLowerCase().includes(mention.query))
      .slice(0, 6);
  }, [mention, members, meId]);

  const refreshMention = (value: string, caret: number) => {
    const next = activeMention(value, caret);
    setMention(next);
    setHighlight(0);
  };

  // Where the caret should land after an insertion. Applied in a layout
  // effect — synchronously after React commits the new text, before the
  // browser handles another keystroke — so fast typing straight after picking
  // a mention or emoji is never inserted in the wrong place.
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = input.current;
    const at = pendingCaret.current;
    if (!el || at === null) return;
    pendingCaret.current = null;
    el.focus();
    el.setSelectionRange(at, at);
  }, [text]);

  const insertAtCaret = (insert: string, replaceFrom?: number) => {
    const caret = input.current?.selectionStart ?? text.length;
    const start = replaceFrom ?? caret;
    pendingCaret.current = start + insert.length;
    setText(text.slice(0, start) + insert + text.slice(caret));
  };

  const chooseMention = (member: ConversationMemberView) => {
    if (!mention) return;
    insertAtCaret(`@${member.name} `, mention.start);
    setPicked((p) => (p.some((m) => m.id === member.id) ? p : [...p, { id: member.id, name: member.name }]));
    setMention(null);
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || busy || disabled || body.length > MESSAGE_MAX) return;
    // Only mentions whose "@Name" is still in the text are sent.
    const mentionIds = picked.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id);
    const snapshot = { text, picked };
    if (mode === "send") {
      // Cleared at once: the thread shows the message as "Sending…" (with
      // Retry if it fails), so the next message can be typed immediately and
      // is never wiped by the previous send finishing.
      setText("");
      setPicked([]);
      setMention(null);
      if (draftKey) drafts.delete(draftKey);
    } else setBusy(true);
    try {
      const accepted = await onSubmit(body, mentionIds);
      if (!accepted && mode === "send") {
        // Put the words back only if nothing new has been typed since.
        setText((current) => current || snapshot.text);
        setPicked((current) => (current.length ? current : snapshot.picked));
      }
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (mention && candidates.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((h) => (h + 1) % candidates.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((h) => (h - 1 + candidates.length) % candidates.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        chooseMention(candidates[highlight]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    if (event.key === "Escape") {
      if (mode === "edit") onCancel?.();
      else if (replyTo) onCancelReply?.();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  if (disabled && mode === "send")
    return (
      <div className="collab-composer is-disabled" role="status">
        {disabledReason || "You can't send messages here."}
      </div>
    );

  const over = text.length > MESSAGE_MAX;
  const near = text.length > MESSAGE_MAX - 400;

  return (
    <div className={`collab-composer${mode === "edit" ? " is-editing" : ""}`}>
      {replyTo && mode === "send" && (
        <div className="collab-composer-reply">
          <CornerUpLeft size={14} aria-hidden="true" />
          <span>
            Replying to <b>{replyTo.authorName}</b>
            <small>{replyTo.excerpt}</small>
          </span>
          <Button className="icon-button" aria-label="Cancel reply" onClick={onCancelReply}>
            <X size={14} />
          </Button>
        </div>
      )}
      <div className="collab-composer-box">
        {mention && candidates.length > 0 && (
          <ul className="collab-mention-menu" role="listbox" aria-label="Mention someone">
            {candidates.map((m, i) => (
              <li key={m.id} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  className={i === highlight ? "is-active" : ""}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => chooseMention(m)}
                >
                  <Avatar name={m.name} size={22} />
                  <span>{m.name}</span>
                  <small>{m.role}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={input}
          className="collab-composer-input"
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={mode === "edit" ? "Edit message" : "Message"}
          maxLength={MESSAGE_MAX + 500}
          onChange={(e) => {
            setText(e.target.value);
            refreshMention(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) => refreshMention(text, e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setMention(null), 120)}
        />
        <div className="collab-composer-tools">
          <Popover.Root open={emojiOpen} onOpenChange={setEmojiOpen}>
            <Popover.Trigger asChild>
              <Button className="icon-button" aria-label="Insert emoji" type="button">
                <Smile size={17} />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="collab-emoji" side="top" align="end" sideOffset={8}>
                {EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`Insert ${emoji}`}
                    onClick={() => {
                      insertAtCaret(emoji);
                      setEmojiOpen(false);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          {mode === "edit" ? (
            <>
              <Button type="button" className="secondary compact" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                type="button"
                className="primary compact"
                loading={busy}
                disabled={!text.trim() || over}
                onClick={() => void submit()}
              >
                Save
              </Button>
            </>
          ) : (
            <Button
              type="button"
              className="primary collab-send"
              aria-label="Send message"
              loading={busy}
              disabled={!text.trim() || over}
              onClick={() => void submit()}
            >
              <SendHorizontal size={16} />
            </Button>
          )}
        </div>
      </div>
      <div className="collab-composer-hint" aria-live="polite">
        {near ? (
          <span className={over ? "is-over" : ""}>
            {text.length.toLocaleString()} / {MESSAGE_MAX.toLocaleString()}
          </span>
        ) : (
          <span>
            <kbd>Enter</kbd> to {mode === "edit" ? "save" : "send"} · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
            {mode === "send" ? " · @ to mention" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
