"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ExternalLink, Info, Link2, Lock, X } from "lucide-react";
import { Button } from "../ui/controls";
import { getMeeting, internalMeetingUrl } from "@/lib/meeting-client";
import { businessStamp } from "@/lib/gst";
import type { MeetingDetails, RoomSession } from "@/lib/meetings";
import { useMeetingLink } from "./meeting-link";

/** Closes a popover on Escape or a press anywhere outside it. */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, ref, close]);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The meeting's own "share" and "about" controls at the top of every
 * meeting, like the link card in other meeting apps:
 *
 *   Title · 🔒 Secure meeting · [Copy meeting link] [Meeting info]
 *
 * Employees get the same link rules as everywhere else (the organiser copies
 * — or creates and copies — the guest link; others the internal link) and
 * a way to the meeting's details in a new tab, so the call keeps running.
 * A guest sees only what the guest page already told them — title, time,
 * host — and the link they came in with. Never CRM data.
 */
export function MeetingShare({ session, onNotice }: { session: RoomSession; onNotice: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, wrap, () => setOpen(false));
  const { copy, dialogs } = useMeetingLink((_, message) => onNotice(message));

  const copyLink = async () => {
    if (session.guest) {
      const ok = await copyText(location.origin + location.pathname);
      onNotice(ok ? "Meeting link copied." : "Copying isn't available here.");
    } else await copy(session.meetingId);
  };

  return (
    <div className="meet-share" ref={wrap}>
      <span className="meet-secure">
        <Lock size={12} aria-hidden="true" /> Secure meeting
      </span>
      <Button className="meet-share-button" aria-label="Copy meeting link" onClick={() => void copyLink()}>
        <Link2 size={15} aria-hidden="true" /> <span>Copy meeting link</span>
      </Button>
      <Button className="meet-share-button" aria-label="Meeting info" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <Info size={15} aria-hidden="true" /> <span>Meeting info</span>
      </Button>
      {open && <InfoPanel session={session} onClose={() => setOpen(false)} onCopy={() => void copyLink()} />}
      {dialogs}
    </div>
  );
}

function InfoPanel({ session, onClose, onCopy }: { session: RoomSession; onClose: () => void; onCopy: () => void }) {
  const [details, setDetails] = useState<MeetingDetails | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (session.guest) return;
    getMeeting(session.meetingId)
      .then(setDetails)
      .catch(() => setFailed(true));
  }, [session.guest, session.meetingId]);

  const m = details?.meeting;
  const scheduled = m?.scheduledAt ?? session.scheduledAt ?? null;
  const host = m?.createdBy.name ?? session.organiser ?? null;
  const link = session.guest
    ? location.origin + location.pathname
    : details?.guestLink?.url ?? (m && (!m.canManage || m.scope === "direct") ? internalMeetingUrl(session.meetingId) : null);
  const linkKind = session.guest || details?.guestLink?.url ? "guest" : "internal";
  const guests = m ? (m.guestAccess === "off" ? "No guests" : m.guestAccess === "admit" ? "Guests with the link — you admit each one" : "Guests with the link join directly") : null;

  return (
    <div className="meet-info" role="dialog" aria-label="Meeting information">
      <header>
        <h2>{session.title}</h2>
        <Button className="icon-button" aria-label="Close meeting information" onClick={onClose}>
          <X size={16} />
        </Button>
      </header>
      <dl>
        {scheduled && (
          <div>
            <dt>Scheduled</dt>
            <dd>{businessStamp(scheduled)}</dd>
          </div>
        )}
        {host && (
          <div>
            <dt>Host</dt>
            <dd>{host}</dd>
          </div>
        )}
        {session.guest ? (
          <div>
            <dt>You</dt>
            <dd>Joined as a guest — this meeting only</dd>
          </div>
        ) : (
          guests && (
            <div>
              <dt>Guest access</dt>
              <dd>{guests}</dd>
            </div>
          )
        )}
      </dl>
      <div className="meet-info-link">
        <span className="meet-link-label">{linkKind === "guest" ? "Meeting link" : "Internal link — Enercore sign-in required"}</span>
        {link ? (
          <input readOnly value={link} aria-label={linkKind === "guest" ? "Meeting link" : "Internal link"} onFocus={(e) => e.currentTarget.select()} />
        ) : (
          <p className="small muted">{failed ? "Couldn't load the link." : m ? "No guest link yet — Copy link creates one." : "Loading…"}</p>
        )}
        <Button className="primary compact" onClick={onCopy}>
          <Link2 size={14} aria-hidden="true" /> Copy link
        </Button>
      </div>
      {!session.guest && (
        <Button className="secondary compact meet-info-details" onClick={() => window.open(internalMeetingUrl(session.meetingId), "_blank", "noopener")}>
          <ExternalLink size={14} aria-hidden="true" /> Open meeting details
        </Button>
      )}
    </div>
  );
}
