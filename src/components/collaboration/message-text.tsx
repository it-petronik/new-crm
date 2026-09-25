"use client";

import { Fragment, type ReactNode } from "react";
import { businessDate, businessTime, businessToday } from "@/lib/gst";

/**
 * Renders a message body as text.
 *
 * The body is plain text and is only ever turned into React text nodes and a
 * few elements built here — never `dangerouslySetInnerHTML` — so anything a
 * person types, including markup, displays literally. Two things are
 * decorated: mentions that the server resolved for this message, and
 * http(s) links, which open in a new tab without referrer or opener access.
 */

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

function linkify(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <a
        key={`${keyPrefix}-${start}`}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="collab-link"
      >
        {match[0]}
      </a>,
    );
    last = start + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MessageText({
  body,
  mentions,
  meId,
}: {
  body: string;
  mentions: { id: string; name: string }[];
  meId: string;
}) {
  if (!mentions.length) return <>{linkify(body, "t")}</>;
  // Longest names first, so "@Ann Lee" wins over "@Ann".
  const names = [...mentions].sort((a, b) => b.name.length - a.name.length);
  const parts: ReactNode[] = [];
  let rest = body;
  let key = 0;
  while (rest) {
    let hit: { index: number; mention: { id: string; name: string } } | null = null;
    for (const mention of names) {
      const index = rest.indexOf(`@${mention.name}`);
      if (index >= 0 && (!hit || index < hit.index)) hit = { index, mention };
    }
    if (!hit) {
      parts.push(<Fragment key={key++}>{linkify(rest, `r${key}`)}</Fragment>);
      break;
    }
    if (hit.index) parts.push(<Fragment key={key++}>{linkify(rest.slice(0, hit.index), `r${key}`)}</Fragment>);
    parts.push(
      <span
        key={key++}
        className={`collab-mention${hit.mention.id === meId ? " is-me" : ""}`}
      >
        @{hit.mention.name}
      </span>,
    );
    rest = rest.slice(hit.index + hit.mention.name.length + 1);
  }
  return <>{parts}</>;
}

/* ------------------------------------------------------------ time labels */

const DAY_MS = 86_400_000;

/** "Today", "Yesterday", or `Thu 25 Sep`, all in Dubai time. */
export function dayLabel(at: string) {
  const date = new Date(at);
  const day = businessToday(date);
  if (day === businessToday()) return "Today";
  if (day === businessToday(new Date(Date.now() - DAY_MS))) return "Yesterday";
  return businessDate(date);
}

export const dayKey = (at: string) => businessToday(new Date(at));

/** For the conversation list: a time today, otherwise a short date. */
export function listStamp(at: string | null) {
  if (!at) return "";
  const date = new Date(at);
  return businessToday(date) === businessToday() ? businessTime(date) : businessDate(date);
}

export const timeOf = (at: string) => businessTime(new Date(at));
