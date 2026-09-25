"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CornerUpLeft, Mic, Paperclip, SendHorizontal, Smile, X } from "lucide-react";
import {
  EMOJI_SET as EMOJI,
  MESSAGE_MAX,
  type AttachmentView,
  type ConversationMemberView,
  type ReplyPreview,
} from "@/lib/collab";
import { ACCEPT_ATTRIBUTE, ATTACHMENTS_PER_MESSAGE, ATTACHMENT_LIMITS, formatBytes } from "@/lib/collab-files";
import { collabFetch, uploadAttachment, useFilesEnabled } from "@/lib/collab-client";
import { Button } from "../ui/controls";
import { Avatar } from "../avatar";
import { AttachmentTray, imageExtras, type PendingUpload } from "./attachments";
import { VoiceRecorder, voiceSupported, type VoiceNote } from "./voice-recorder";

/** Typing "start" is re-sent at most this often while someone keeps typing. */
const TYPING_EVERY_MS = 3000;
const LARGEST_FILE = Math.max(...Object.values(ATTACHMENT_LIMITS));

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
  onSubmit: (body: string, mentionIds: string[], attachments: AttachmentView[]) => Promise<boolean> | boolean;
  /** Send mode: enables attachments, voice notes and typing signals. */
  conversationId?: string;
  onTyping?: (state: "start" | "stop") => void;
  onCancel?: () => void;
  mode?: "send" | "edit";
  autoFocus?: boolean;
  /** Changes whenever the conversation does, to restore that draft. */
  draftKey?: string;
};

const drafts = new Map<string, string>();

/** Lets the thread hand dropped files to the composer. */
export type ComposerHandle = { addFiles: (files: File[]) => void };

/**
 * Message input: multiline (Enter sends, Shift+Enter breaks the line),
 * @mentions limited to the conversation's members, and an emoji picker. The
 * text stays plain; mentions are sent as ids and the server re-validates them.
 */
const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({
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
  conversationId,
  onTyping,
}: ComposerProps, ref) {
  const [text, setText] = useState(() => (draftKey ? (drafts.get(draftKey) ?? initialText) : initialText));
  const [picked, setPicked] = useState(initialMentions);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [recording, setRecording] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  // Files, paste, drop and voice notes need file storage on this deployment.
  const filesEnabled = useFilesEnabled();
  const canAttach = mode === "send" && !!conversationId && filesEnabled;

  /* ------------------------------------------------------------ typing */
  const typingSentAt = useRef(0);
  const typing = (value: string) => {
    if (!onTyping) return;
    const now = Date.now();
    if (value.trim()) {
      if (now - typingSentAt.current > TYPING_EVERY_MS) {
        typingSentAt.current = now;
        onTyping("start");
      }
    } else stopTyping();
  };
  const stopTyping = () => {
    if (!onTyping || !typingSentAt.current) return;
    typingSentAt.current = 0;
    onTyping("stop");
  };
  // Leaving the conversation (unmount) ends any typing state.
  const stopRef = useRef(stopTyping);
  stopRef.current = stopTyping;
  useEffect(() => () => stopRef.current(), []);

  /* ------------------------------------------------------------- files */
  const patch = (localId: string, change: Partial<PendingUpload>) =>
    setUploads((list) => list.map((u) => (u.localId === localId ? { ...u, ...change } : u)));

  const upload = async (file: File, name = file.name, durationMs?: number) => {
    const localId = crypto.randomUUID();
    const isImage = file.type.startsWith("image/") && !file.type.includes("svg");
    const item: PendingUpload = {
      localId,
      name,
      size: file.size,
      isImage,
      previewUrl: isImage ? URL.createObjectURL(file) : null,
      progress: 0,
      status: "uploading",
    };
    // A quick client-side ceiling so a huge file is refused at once; the
    // server enforces the real per-type limits.
    if (file.size > LARGEST_FILE) {
      setUploads((list) => [...list, { ...item, status: "failed", error: `Larger than ${formatBytes(LARGEST_FILE)}` }]);
      return null;
    }
    setUploads((list) => [...list, item]);
    const extras = isImage ? await imageExtras(file) : { thumbnail: null };
    const task = uploadAttachment(conversationId!, file, { name, ...extras, durationMs }, (p) => patch(localId, { progress: p }));
    patch(localId, { abort: task.abort });
    try {
      const attachment = await task.promise;
      patch(localId, { status: "ready", progress: 1, attachment, abort: undefined });
      return attachment;
    } catch (e) {
      patch(localId, { status: "failed", error: (e as Error).message, abort: undefined });
      return null;
    }
  };

  const addFiles = (files: File[]) => {
    if (!canAttach || !files.length) return;
    const room = ATTACHMENTS_PER_MESSAGE - uploads.length;
    for (const file of files.slice(0, Math.max(0, room))) void upload(file);
    if (files.length > room)
      setUploads((list) => [
        ...list,
        {
          localId: crypto.randomUUID(),
          name: `${files.length - Math.max(0, room)} more not added`,
          size: 0,
          isImage: false,
          previewUrl: null,
          progress: 0,
          status: "failed",
          error: `Up to ${ATTACHMENTS_PER_MESSAGE} files per message`,
        },
      ]);
  };
  useImperativeHandle(ref, () => ({ addFiles }));

  const removeUpload = (localId: string) => {
    const item = uploads.find((u) => u.localId === localId);
    if (!item) return;
    item.abort?.();
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    // Uploaded but never sent: tell the server it can go.
    if (item.attachment)
      void collabFetch(`/attachments/${item.attachment.id}`, { method: "DELETE" }).catch(() => {});
    setUploads((list) => list.filter((u) => u.localId !== localId));
  };

  const sendVoice = async (note: VoiceNote) => {
    setRecording(false);
    const file = new File([note.blob], note.name, { type: note.blob.type });
    const attachment = await upload(file, note.name, note.durationMs);
    if (!attachment) return;
    setUploads((list) => list.filter((u) => u.attachment?.id !== attachment.id));
    await onSubmit("", [], [attachment]);
  };

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
  const pendingCaret = useRef<{ at: number; focus: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = input.current;
    const pending = pendingCaret.current;
    if (!el || pending === null) return;
    pendingCaret.current = null;
    // Keyboard users picking emoji keep focus in the picker; the caret still
    // moves, so the next pick and later typing land in the right place.
    if (pending.focus) el.focus();
    el.setSelectionRange(pending.at, pending.at);
  }, [text]);

  /** Inserts at the caret (or replaces from `replaceFrom`), keeping it after. */
  const insertAtCaret = (insert: string, replaceFrom?: number, focus = true) => {
    // selectionStart survives blur, so a pick from the picker still lands
    // where the caret last was.
    const el = input.current;
    const caret = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? caret;
    const start = replaceFrom ?? caret;
    pendingCaret.current = { at: start + insert.length, focus };
    setText(text.slice(0, start) + insert + text.slice(replaceFrom === undefined ? end : caret));
  };

  const chooseMention = (member: ConversationMemberView) => {
    if (!mention) return;
    insertAtCaret(`@${member.name} `, mention.start);
    setPicked((p) => (p.some((m) => m.id === member.id) ? p : [...p, { id: member.id, name: member.name }]));
    setMention(null);
  };

  const ready = uploads.filter((u) => u.status === "ready" && u.attachment);
  const uploading = uploads.some((u) => u.status === "uploading");

  const submit = async () => {
    const body = text.trim();
    const files = ready.map((u) => u.attachment!);
    if ((!body && !files.length) || busy || disabled || uploading || body.length > MESSAGE_MAX) return;
    stopTyping();
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
      for (const u of uploads) if (u.previewUrl) URL.revokeObjectURL(u.previewUrl);
      setUploads([]);
    } else setBusy(true);
    try {
      const accepted = await onSubmit(body, mentionIds, files);
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
      // With the picker open, Escape closes the picker and nothing else.
      if (emojiOpen) {
        setEmojiOpen(false);
        return;
      }
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
  const empty = !text.trim() && !uploads.length;

  if (recording)
    return (
      <div className="collab-composer">
        <VoiceRecorder onCancel={() => setRecording(false)} onSend={(note) => void sendVoice(note)} />
      </div>
    );

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
      {canAttach && <AttachmentTray items={uploads} onRemove={removeUpload} />}
      {/* One field surface: the border and focus ring belong to this box; the
          textarea inside is bare (see .ui-field-shell / .ui-field-bare). */}
      <div className="ui-field-shell collab-composer-box">
        {canAttach && (
          <>
            <Button
              className="icon-button collab-composer-tool"
              aria-label="Attach files"
              title="Attach files"
              type="button"
              disabled={uploads.length >= ATTACHMENTS_PER_MESSAGE}
              onClick={() => filePicker.current?.click()}
            >
              <Paperclip size={18} />
            </Button>
            <input
              ref={filePicker}
              type="file"
              multiple
              hidden
              accept={ACCEPT_ATTRIBUTE}
              onChange={(e) => {
                addFiles([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          </>
        )}
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
          className="ui-field-bare collab-composer-input"
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={mode === "edit" ? "Edit message" : "Message"}
          maxLength={MESSAGE_MAX + 500}
          onChange={(e) => {
            setText(e.target.value);
            refreshMention(e.target.value, e.target.selectionStart);
            typing(e.target.value);
          }}
          onPaste={(e) => {
            // Pasted images (screenshots) become attachments.
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (canAttach && files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onClick={(e) => refreshMention(text, e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setMention(null), 120)}
        />
        <div className="collab-composer-tools">
          {/* The picker stays open for several picks. It closes on a click
              outside, Escape, the trigger, or a conversation change (the
              composer remounts per conversation). */}
          <Popover.Root open={emojiOpen} onOpenChange={setEmojiOpen}>
            <Popover.Trigger asChild>
              <Button
                className="icon-button collab-composer-tool"
                aria-label="Insert emoji"
                aria-expanded={emojiOpen}
                type="button"
                // Keep the textarea focused so its caret stays live.
                onMouseDown={(e) => e.preventDefault()}
              >
                <Smile size={18} />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="collab-emoji"
                side="top"
                align="end"
                sideOffset={8}
                aria-label="Emoji"
                // Opening must not pull focus out of the textarea…
                onOpenAutoFocus={(e) => e.preventDefault()}
                // …and returning focus to it after a pick must not count as
                // leaving the picker. Clicks outside still close it.
                onFocusOutside={(e) => e.preventDefault()}
                onCloseAutoFocus={(e) => {
                  e.preventDefault();
                  input.current?.focus();
                }}
              >
                {EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`Insert ${emoji}`}
                    // A mouse pick leaves focus (and the caret) in the textarea.
                    onMouseDown={(e) => e.preventDefault()}
                    // Keyboard activation (detail 0) keeps focus in the grid.
                    onClick={(e) => insertAtCaret(emoji, undefined, e.detail !== 0)}
                  >
                    {emoji}
                  </button>
                ))}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          {mode === "edit" ? (
            <>
              <Button type="button" className="secondary collab-composer-action" disabled={busy} onClick={onCancel}>
                Cancel
              </Button>
              <Button
                type="button"
                className="primary collab-composer-action"
                aria-busy={busy || undefined}
                disabled={busy || !text.trim() || over}
                onClick={() => void submit()}
              >
                {busy ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            // Empty composer: the microphone. Anything to send: Send.
            canAttach && empty && voiceSupported() ? (
              <Button
                type="button"
                className="icon-button collab-composer-tool collab-mic"
                aria-label="Record voice message"
                title="Record voice message"
                onClick={() => setRecording(true)}
              >
                <Mic size={18} />
              </Button>
            ) : (
              <Button
                type="button"
                className="primary collab-send"
                aria-label={uploading ? "Waiting for uploads" : "Send message"}
                disabled={empty || over || uploading || (!text.trim() && !ready.length)}
                onClick={() => void submit()}
              >
                <SendHorizontal size={17} />
              </Button>
            )
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
});

export default Composer;
