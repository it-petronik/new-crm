"use client";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/controls";
import { morningBrief } from "@/lib/attention";
import type { Actor, RecordItem } from "@/lib/domain";

/**
 * The executive briefing.
 *
 * Every line is counted from the records themselves. Nothing is written by a
 * model, estimated, or padded to look substantial — on a quiet day it says so
 * and stops. Each line that maps to a module is clickable, so reading the
 * brief and acting on it are the same gesture.
 */
export default function MorningBrief({
  actor, records, onGo,
}: {
  actor: Actor;
  records: RecordItem[];
  onGo: (module: string) => void;
}) {
  const lines = morningBrief(actor, records);

  // Rendered inside the attention panel: these counts describe that same list,
  // so giving them a panel of their own said everything twice.
  return (
    <div className="morning-brief">
      {lines.length === 0 ? (
        <p className="muted morning-brief-clear">
          Nothing is overdue, delayed or waiting. The company is on top of its work.
        </p>
      ) : (
        <ul className="morning-brief-list">
          {lines.map((line) => (
            <li key={line.text} className={`brief-line tone-${line.tone}`}>
              <span className="brief-dot" aria-hidden="true" />
              {line.to ? (
                <Button className="record-link brief-link" onClick={() => onGo(line.to!)}>
                  {line.text}
                  <ArrowRight size={13} aria-hidden="true" />
                </Button>
              ) : (
                <span>{line.text}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
