"use client";

import { useState, type ReactNode } from "react";
import { Link2 } from "lucide-react";
import { Button, Dialog, DialogActions, DialogPresence } from "../ui/controls";
import { CollabRequestError } from "@/lib/collab-client";
import { createGuestLink, guestLinkOf, internalMeetingUrl } from "@/lib/meeting-client";

/**
 * "Copy meeting link", the same everywhere (Meetings, details, a record's
 * meetings, inside the meeting):
 *
 * - The organiser (or a room admin) copies the GUEST link — /meet/<token>,
 *   which people outside Enercore can open. With none yet, one confirmation
 *   creates it ("host must admit" unless the meeting says otherwise) and
 *   copies it; nobody has to leave the meeting to find a setting.
 * - Everyone else, and one-to-one calls, copy the INTERNAL link, labelled as
 *   such: it opens the meeting in Enercore after signing in.
 *
 * The server decides who may see a guest link; this only follows its answer.
 */

type Outcome = { kind: "guest" | "internal"; url: string };
type Ask = { replaces: boolean; admission: "open" | "admit" };

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function useMeetingLink(onCopied?: (outcome: Outcome, message: string) => void) {
  const [ask, setAsk] = useState<(Ask & { id: string }) | null>(null);
  const [manual, setManual] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const deliver = async (outcome: Outcome) => {
    const ok = await writeClipboard(outcome.url);
    if (!ok) return setManual(outcome);
    onCopied?.(
      outcome,
      outcome.kind === "guest" ? "Guest link copied — anyone with it can ask to join." : "Internal link copied — for people in Enercore (sign-in required).",
    );
  };

  /** Copies the right link for this person; may ask to create a guest link first. */
  async function copy(id: string) {
    setError("");
    try {
      const { link, allowed, admission } = await guestLinkOf(id);
      if (link?.url) return deliver({ kind: "guest", url: link.url });
      if (!allowed) return deliver({ kind: "internal", url: internalMeetingUrl(id) });
      setAsk({ id, replaces: !!link, admission });
    } catch (e) {
      // Not the organiser: the internal link is theirs to share.
      if (e instanceof CollabRequestError && e.status === 403) return deliver({ kind: "internal", url: internalMeetingUrl(id) });
      onCopied?.({ kind: "internal", url: "" }, e instanceof Error ? e.message : "The link couldn't be copied.");
    }
  }

  async function create() {
    if (!ask) return;
    setBusy(true);
    setError("");
    try {
      const { url } = await createGuestLink(ask.id);
      setAsk(null);
      await deliver({ kind: "guest", url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The guest link couldn't be created.");
    } finally {
      setBusy(false);
    }
  }

  const dialogs: ReactNode = (
    <DialogPresence>
      {ask && (
        <Dialog title="Create guest link?" onClose={() => !busy && setAsk(null)} dismissOnOutside={!busy} className="dialog-compact meet-dialog">
          <p>
            People outside Enercore can use it to join this meeting — only this meeting.{" "}
            {ask.admission === "admit" ? "You admit each guest before they get in." : "Guests with the link join directly."} It works until the meeting ends, and you
            can revoke it any time.
          </p>
          {ask.replaces && <p className="small muted">This replaces the earlier guest link, which will stop working.</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <DialogActions onCancel={() => setAsk(null)} primary={{ label: "Create & copy", pendingLabel: "Creating…", pending: busy, onClick: () => void create() }} />
        </Dialog>
      )}
      {manual && (
        <Dialog title={manual.kind === "guest" ? "Guest link" : "Internal link"} onClose={() => setManual(null)} className="dialog-compact meet-dialog">
          <p className="small muted">Copying isn&apos;t available here. Select the link and copy it.</p>
          <input className="ui-input meet-link-input" readOnly value={manual.url} aria-label={manual.kind === "guest" ? "Guest link" : "Internal link"} onFocus={(e) => e.currentTarget.select()} autoFocus />
          <DialogActions cancel="Close" onCancel={() => setManual(null)} />
        </Dialog>
      )}
    </DialogPresence>
  );

  return { copy, dialogs };
}

/** The button form, for lists and details. */
export function CopyMeetingLink({
  meetingId,
  label = "Copy meeting link",
  className = "secondary compact",
  onCopied,
}: {
  meetingId: string;
  label?: string;
  className?: string;
  onCopied?: (message: string) => void;
}) {
  const [done, setDone] = useState(false);
  const { copy, dialogs } = useMeetingLink((outcome, message) => {
    if (outcome.url) {
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    }
    onCopied?.(message);
  });
  return (
    <>
      <Button className={className} onClick={() => void copy(meetingId)}>
        <Link2 size={14} aria-hidden="true" /> {done ? "Copied" : label}
      </Button>
      {dialogs}
    </>
  );
}
