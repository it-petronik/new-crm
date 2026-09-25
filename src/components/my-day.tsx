"use client";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/controls";
import { FollowUpMenu } from "./follow-up-control";
import { myDay, type AttentionItem } from "@/lib/attention";
import { companyName } from "@/lib/company-name";
import { allowedModules, money, type Actor, type Kind, type RecordItem } from "@/lib/domain";

/**
 * The employee home.
 *
 * An executive dashboard answers "how is the company doing"; that is the wrong
 * first question for someone whose job is to contact people today. This answers
 * "what do I need to do today", and puts the action next to the answer so the
 * work can be done without navigating anywhere.
 */
export default function MyDay({
  actor, records, company, onOpen, onFollowUp, onQuickAdd, onGo, busy, meetings,
}: {
  /** Today's meetings (live workspace only), shown above the day's follow-ups. */
  meetings?: React.ReactNode;
  actor: Actor;
  records: RecordItem[];
  company: string;
  onOpen: (r: RecordItem) => void;
  onFollowUp: (r: RecordItem, date: string) => Promise<void> | void;
  onQuickAdd: (kind?: Kind) => void;
  onGo: (module: string) => void;
  busy?: boolean;
}) {
  const day = myDay(actor, records);
  const permitted = allowedModules(actor);
  const first = actor.name.split(" ")[0];

  const recent = records
    .filter((r) => r.ownerId === actor.id && !r.deletedAt)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .slice(0, 4);

  const quickActions = (
    [
      { kind: "leads" as const, label: "Add lead" },
      { kind: "customers" as const, label: "Add customer" },
      { kind: "suppliers" as const, label: "Add supplier" },
      { kind: "products" as const, label: "Add product" },
    ] as const
  ).filter((a) => permitted.includes(a.kind));

  return (
    <div className="my-day">
      <header className="my-day-head">
        <div>
          <span className="eyebrow">MY DAY</span>
          <h1>
            {day.clear ? `You're caught up, ${first}.` : `Good to see you, ${first}.`}
          </h1>
          <p className="muted">
            {day.clear
              ? "Nothing is overdue or due today. Anything you add now will come back to you when it's due."
              : `${day.overdue.length + day.today.length + day.approvals.length} things need you today · ${companyName(company)}`}
          </p>
        </div>
        {quickActions.length > 0 && (
          <div className="my-day-actions">
            {quickActions.map((a) => (
              <Button key={a.kind} className="secondary" onClick={() => onQuickAdd(a.kind)}>
                <Plus size={15} /> {a.label}
              </Button>
            ))}
          </div>
        )}
      </header>

      {day.approvals.length > 0 && (
        <Section
          tone="urgent"
          icon={<AlertTriangle size={16} />}
          title="Waiting for your approval"
          count={day.approvals.length}
          items={day.approvals}
          onOpen={onOpen}
          onFollowUp={onFollowUp}
          busy={busy}
        />
      )}

      {day.overdue.length > 0 && (
        <Section
          tone="urgent"
          icon={<Clock size={16} />}
          title="Overdue follow-ups"
          count={day.overdue.length}
          items={day.overdue}
          onOpen={onOpen}
          onFollowUp={onFollowUp}
          busy={busy}
        />
      )}

      {day.today.length > 0 && (
        <Section
          tone="warning"
          icon={<CalendarClock size={16} />}
          title="Due today"
          count={day.today.length}
          items={day.today}
          onOpen={onOpen}
          onFollowUp={onFollowUp}
          busy={busy}
        />
      )}

      {meetings}

      {day.clear && (
        <section className="panel my-day-clear">
          <CheckCircle2 size={22} aria-hidden="true" />
          <div>
            <b>Nothing needs you right now.</b>
            <p className="muted">
              {day.soon.length
                ? `${day.soon.length} follow-up${day.soon.length === 1 ? "" : "s"} coming up this week.`
                : "No follow-ups scheduled this week either — a good moment to add one."}
            </p>
          </div>
          {quickActions[0] && (
            <Button className="primary" onClick={() => onQuickAdd(quickActions[0].kind)}>
              <Plus size={16} /> {quickActions[0].label}
            </Button>
          )}
        </section>
      )}

      <div className="my-day-grid">
        {day.soon.length > 0 && (
          <section className="panel">
            <div className="panel-heading"><h2>Coming up this week</h2></div>
            <ul className="my-day-list">
              {day.soon.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <Button className="record-link" onClick={() => onOpen(r)}>
                    <span className="my-day-title">{r.title}</span>
                    <small>{r.due} · {r.status}</small>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {recent.length > 0 && (
          <section className="panel">
            <div className="panel-heading"><h2>Continue where you left off</h2></div>
            <ul className="my-day-list">
              {recent.map((r) => (
                <li key={r.id}>
                  <Button className="record-link" onClick={() => onOpen(r)}>
                    <span className="my-day-title">{r.title}</span>
                    <small>{r.status}{r.amount ? ` · ${money(r.amount, r.currency)}` : ""}</small>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {permitted.includes("leads") && (
        <Button className="secondary my-day-more" onClick={() => onGo("leads")}>
          Open the full pipeline <ArrowRight size={15} />
        </Button>
      )}
    </div>
  );
}

/** One group of actionable items, each resolvable without leaving the page. */
function Section({
  tone, icon, title, count, items, onOpen, onFollowUp, busy,
}: {
  tone: "urgent" | "warning";
  icon: React.ReactNode;
  title: string;
  count: number;
  items: AttentionItem[];
  onOpen: (r: RecordItem) => void;
  onFollowUp: (r: RecordItem, date: string) => Promise<void> | void;
  busy?: boolean;
}) {
  return (
    <section className={`panel attention-section tone-${tone}`}>
      <div className="panel-heading">
        <h2>{icon} {title}</h2>
        <span className="attention-count">{count}</span>
      </div>
      <ul className="attention-list">
        {items.slice(0, 6).map((item) => (
          <li key={item.id} className="attention-row">
            <Button className="record-link attention-open" onClick={() => onOpen(item.record)}>
              <span className="my-day-title">{item.record.title}</span>
              <small>{item.reason}{item.record.amount ? ` · ${money(item.record.amount, item.record.currency)}` : ""}</small>
            </Button>
            {item.action === "follow-up" && (
              <FollowUpMenu busy={busy} onChoose={(date) => void onFollowUp(item.record, date)} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
