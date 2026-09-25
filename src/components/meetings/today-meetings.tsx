"use client";

import { Video } from "lucide-react";
import { Button } from "../ui/controls";
import { openMeetingPage, openPrejoin, useAllMeetings } from "@/lib/meeting-client";
import { RELATED_NOUN, joinable } from "@/lib/meetings";
import { businessTime, businessToday } from "@/lib/gst";

/**
 * Today's meetings on My Day, beside the day's follow-ups — including
 * meetings about the person's leads. Only meetings they may already reach;
 * nothing new to manage, and nothing shown when there are none.
 */
export default function TodayMeetings() {
  const { meetings } = useAllMeetings();
  const today = businessToday();
  const list = meetings
    .filter((m) => m.status === "live" || (m.status === "scheduled" && m.scheduledAt && businessToday(new Date(m.scheduledAt)) === today))
    .sort((a, b) => (a.status === "live" ? -1 : b.status === "live" ? 1 : (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? "")));
  if (!list.length) return null;
  return (
    <section className="panel my-day-meetings" aria-labelledby="my-day-meetings">
      <h2 id="my-day-meetings">
        <Video size={16} aria-hidden="true" /> Meetings today
      </h2>
      <ul className="my-day-list">
        {list.map((m) => (
          <li key={m.id}>
            <span className="my-day-meeting-main">
              <span className="my-day-title">{m.title}</span>
              <small>
                {m.status === "live" ? "In progress" : `${businessTime(new Date(m.scheduledAt!))} GST`}
                {m.related ? ` · ${RELATED_NOUN[m.related.kind]}: ${m.related.title}` : m.conversationTitle ? ` · ${m.conversationTitle}` : ""}
              </small>
            </span>
            {m.status === "live" || joinable(m) ? (
              <Button className="primary compact" onClick={() => openPrejoin(m.id)}>
                Join
              </Button>
            ) : (
              <Button className="secondary compact" onClick={() => openMeetingPage(m.id)}>
                Details
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
