"use client";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { Button } from "./ui/controls";
import { MoreActions } from "./ui/row-actions";
import {
  canRead,
  isProforma,
  labels,
  type Actor,
  type Module,
  type RecordItem,
} from "@/lib/domain";
import { dailyRoutine, roleHome } from "@/lib/role-home";
export function RoleHome({
  actor,
  records,
  go,
  onSelect,
  children,
}: {
  actor: Actor;
  records: RecordItem[];
  go: (m: Module) => void;
  onSelect: (r: RecordItem) => void;
  children: React.ReactNode;
}) {
  const home = roleHome(actor);
  const visible = records.filter((r) => !r.deletedAt && canRead(actor, r));
  const queue = visible
    .filter(
      (r) =>
        home.modules.includes(r.kind === "leave" ? "hr" : r.kind) &&
        ![
          "Paid",
          "Cancelled",
          "Resolved",
          "Completed",
          "Accepted",
          "Rejected",
          "Expired",
          "Inactive",
          "Won",
          "Lost",
        ].includes(r.status) &&
        !["customers", "products", "hr"].includes(r.kind) &&
        !(isProforma(r) && r.status === "Issued"),
    )
    .sort(
      (a, b) =>
        (a.due || "9999").localeCompare(b.due || "9999") ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, 5);
  return (
    <section className="role-home" aria-label={`${actor.role} dashboard`}>
      <header className="role-home-heading">
        <div>
          <span className="eyebrow">{actor.role}</span>
          <h1>{home.title}</h1>
        </div>
      <nav className="role-shortcuts" aria-label="Role shortcuts">
        {home.modules[0] && <Button className="primary" onClick={() => go(home.modules[0])}>{labels[home.modules[0]]}<ArrowUpRight size={15} /></Button>}
        <MoreActions label="Workspace shortcuts" triggerLabel="Go to…" actions={home.modules.slice(1).map(m => ({ id:m, label:labels[m], run:()=>go(m) }))} />
      </nav>
      </header>
      {!actor.role.startsWith("Sales") && <section className="role-queue">
        <header>
          <h2>Your next priorities</h2>
        </header>
        {queue.length ? (
          queue.map((r) => (
            <Button
              key={r.id}
              className="role-queue-item"
              onClick={() => onSelect(r)}
            >
              <div>
                <strong>{r.title}</strong>
                <span>
                  {isProforma(r)
                    ? "Customer proforma"
                    : labels[r.kind === "leave" ? "hr" : r.kind]}{" "}
                  · {r.status}
                </span>
              </div>
              <span className="role-queue-date">
                {r.due || "No date"}
                <ArrowUpRight size={15} />
              </span>
            </Button>
          ))
        ) : (
          <p className="role-queue-clear">
            <CheckCircle2 size={18} />
            You’re up to date.
          </p>
        )}
      </section>}
      {children}
      <details className="daily-routine"><summary>Your daily routine</summary><p>{home.description}</p><ol>{dailyRoutine(actor).map(step => <li key={step}>{step}</li>)}</ol></details>
    </section>
  );
}
