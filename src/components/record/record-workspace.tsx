"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Download, FileText, Phone, Pin, Plus, Trash2, UserPlus, Pencil } from "lucide-react";
import type { Actor, RecordItem } from "@/lib/domain";
import { canRead, canWrite, money, stages } from "@/lib/domain";
import { companyName } from "@/lib/company-name";
import { isCashEntry } from "@/lib/cashbook";
import { recordProfiles, detailFields } from "@/lib/record-profiles";
import { statusTone } from "@/lib/status";
import { Button, Select } from "../ui/controls";
import { MoreActions, type RowAction } from "../ui/row-actions";
import { Section, useMediaQuery } from "../ui/layout";
import { StatusBadge } from "../ui/status-badge";
import { RecordActivity } from "../record-tools";
import RecordMeetings from "../meetings/record-meetings";
import { QuotationDocument, QuotationSummary } from "../quotation-document";
import { CustomerCopilot, LeadCopilot } from "../ai/sales-copilot";
import CommercialWorkspace from "./commercial-workspace";
import type { Suggestion } from "@/lib/ai/client";

/* ---------------------------------------------------------------------------
   A record is a page, not a dialog.

   The workspace replaces the list it was opened from (the list keeps its
   state underneath and comes back on Back or Escape). Header: where you came
   from, what the record is, its status and its actions. Body: the record's
   work, with its details as a context column. Editors open as drawers beside
   it, so nothing is ever a dialog on top of a dialog.
   ------------------------------------------------------------------------ */

export type AutoAi = "brief" | "draft" | "customer-brief";
/** The contact a lead starts from, as the customer's page lists it. */
export type LeadContact = { id: string; name: string; email?: string; phone?: string };

/** Kinds where "I contacted them" is a real event. */
const LOGGABLE = ["leads", "customers", "suppliers", "quotations", "orders"];
/** Records a meeting can be about (see meeting-related.ts). */
const MEETING_KINDS = ["leads", "customers", "suppliers", "quotations", "orders"];
const COMMERCIAL = ["leads", "customers", "suppliers", "products"];

const companyColors: Record<string, string> = {
  Petronik: "#169c88",
  Afrilube: "#d0a351",
  Petronex: "#668ee2",
  Istanegry: "#ac84ce",
};

export default function RecordWorkspace({
  record: r,
  actor,
  busy,
  backLabel,
  onClose,
  onUpdate,
  onQuote,
  onNewLead,
  onAction,
  onEdit,
  onDelete,
  pinned,
  onPin,
  onLog,
  onAssign,
  onAiApply,
  onAiChanged,
  autoAi,
  live = false,
}: {
  record: RecordItem;
  actor: Actor;
  busy: boolean;
  /** Where Back returns to, e.g. "Customers". */
  backLabel: string;
  onClose: () => void;
  onUpdate: (s: string) => void;
  onQuote: () => void;
  /**
   * A lead started from here, already filled in: from a customer (and one of
   * its contacts) or from a product.
   */
  onNewLead?: (contact?: LeadContact) => void;
  onEdit: () => void;
  onDelete: () => void;
  pinned: boolean;
  onPin: () => void;
  onLog: () => void;
  onAssign?: () => void;
  onAiApply: (s: Suggestion) => Promise<void>;
  onAiChanged: () => void;
  autoAi?: AutoAi;
  onAction: (
    action:
      | { action: "note"; text: string; due?: string }
      | { action: "payment"; amountCents: number; reference: string },
  ) => Promise<void>;
  /** Live workspace: commercial relationships, meetings and Enercore AI. */
  live?: boolean;
}) {
  const writable = canWrite(actor, r);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const narrow = useMediaQuery("(max-width: 640px)");
  // Arriving on a record moves focus to its title, so a screen reader
  // announces where you are and Tab continues from the top of the page.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [r.id]);

  const noun = isCashEntry(r) ? `${r.attributes?.entryType} entry` : recordProfiles[r.kind].noun;
  const approvedQuote = r.kind === "quotations" && r.status === "Approved";
  const printable = r.kind === "quotations" || (r.kind === "accounts" && !isCashEntry(r));
  const primary = !writable
    ? null
    : r.kind === "leads"
      ? { label: "Create quotation", icon: <ArrowRight size={15} aria-hidden="true" />, run: onQuote }
      : approvedQuote
        ? { label: "Accept & create order", run: () => onUpdate("Accepted") }
        : (r.kind === "customers" || r.kind === "products") && onNewLead
          ? { label: "New lead", icon: <Plus size={15} aria-hidden="true" />, run: () => onNewLead() }
          : { label: "Edit record", run: onEdit };
  const showEdit = writable && (r.kind === "leads" || approvedQuote || ((r.kind === "customers" || r.kind === "products") && !!onNewLead));
  const loggable = LOGGABLE.includes(r.kind) && writable;

  const more: RowAction[] = [
    ...(narrow && loggable ? [{ id: "log", label: "Log activity", icon: <Phone size={15} aria-hidden="true" />, run: onLog }] : []),
    ...(narrow && showEdit ? [{ id: "edit", label: "Edit record", icon: <Pencil size={15} aria-hidden="true" />, run: onEdit }] : []),
    ...(onAssign ? [{ id: "assign", label: "Assign", icon: <UserPlus size={15} aria-hidden="true" />, run: onAssign }] : []),
    { id: "pin", label: pinned ? "Unpin" : "Pin for quick access", icon: <Pin size={15} aria-hidden="true" />, run: onPin },
    ...(printable && narrow ? [{ id: "print", label: "Print / Save PDF", icon: <Download size={15} aria-hidden="true" />, run: () => window.print() }] : []),
    ...(writable ? [{ id: "delete", label: "Delete record", icon: <Trash2 size={15} aria-hidden="true" />, destructive: true, run: onDelete }] : []),
  ];

  const details = <RecordDetails record={r} />;
  const activity = (
    <>
      {live && MEETING_KINDS.includes(r.kind) && !isCashEntry(r) && (
        <RecordMeetings record={{ id: r.id, title: r.title, ownerId: r.ownerId, owner: r.owner }} meId={actor.id} canCreate={canRead(actor, r)} />
      )}
      <RecordActivity record={r} writable={writable} busy={busy} onAction={onAction} />
    </>
  );

  return (
    <article className="record-workspace" aria-labelledby={titleId} data-kind={r.kind}>
      <header className="rw-header">
        <div className="rw-topline">
          <Button className="ghost compact rw-back" onClick={onClose} aria-label={`Back to ${backLabel}`}>
            <ArrowLeft size={15} aria-hidden="true" />
            <span>{backLabel}</span>
          </Button>
          <span className="rw-kind">{noun}</span>
        </div>
        <div className="rw-titlebar">
          <div className="rw-identity">
            <h1 id={titleId} ref={heading} tabIndex={-1}>
              {r.title}
            </h1>
            <div className="rw-meta">
              {writable ? (
                <span className={`rw-status tone-${statusTone(r.status)}`}>
                  <Select aria-label="Update status" value={r.status} disabled={busy} onChange={(e) => onUpdate(e.target.value)}>
                    {(isCashEntry(r) ? ["Recorded", "Cancelled"] : stages[r.kind]).map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </span>
              ) : (
                <StatusBadge status={r.status} />
              )}
              <span className="company-label">
                <i style={{ background: companyColors[r.company] }} />
                {companyName(r.company)}
              </span>
              {r.owner && <span className="rw-owner">Owner · {r.owner}</span>}
              {!!r.amount && r.kind !== "quotations" && <span className="rw-value e-numeric">{money(r.amount, r.currency)}</span>}
              {pinned && <span className="exec-tag is-accent">Pinned</span>}
            </div>
          </div>
          <div className="rw-actions">
            {!narrow && loggable && (
              <Button className="secondary compact" onClick={onLog}>
                <Phone size={15} aria-hidden="true" /> Log activity
              </Button>
            )}
            {!narrow && printable && (
              <Button className="secondary compact print-button" onClick={() => window.print()}>
                <Download size={15} aria-hidden="true" /> Print / Save PDF
              </Button>
            )}
            {!narrow && showEdit && (
              <Button className="secondary compact" disabled={busy} onClick={onEdit}>
                Edit record
              </Button>
            )}
            {primary && (
              <Button className="primary compact rw-primary" disabled={busy} onClick={primary.run}>
                {primary.icon}
                {primary.label}
              </Button>
            )}
            <MoreActions label={r.title} actions={more} />
          </div>
        </div>
      </header>

      {live && COMMERCIAL.includes(r.kind) ? (
        <CommercialWorkspace
          key={`commercial-${r.id}`}
          record={r}
          actor={actor}
          onNewLead={onNewLead}
          onChanged={onAiChanged}
          details={details}
          activity={activity}
          copilot={
            r.kind === "leads" ? (
              <LeadCopilot
                key={r.id}
                recordId={r.id}
                onLog={loggable ? onLog : undefined}
                auto={autoAi === "brief" || autoAi === "draft" ? autoAi : undefined}
                onApply={onAiApply}
                onChanged={onAiChanged}
              />
            ) : r.kind === "customers" ? (
              <CustomerCopilot key={r.id} recordId={r.id} title={r.title} canNote={writable} auto={autoAi === "customer-brief" ? "brief" : undefined} />
            ) : undefined
          }
        />
      ) : r.kind === "quotations" ? (
        <QuotationBody record={r} activity={activity} />
      ) : (
        <div className="rw-body has-aside">
          <div className="rw-main">
            <RecordNotes record={r} />
            <RecordLines record={r} />
            {activity}
          </div>
          <aside className="rw-context" aria-label="Details">
            {details}
          </aside>
        </div>
      )}
    </article>
  );
}

/** The record's own fields as a quiet definition list. */
function RecordDetails({ record: r }: { record: RecordItem }) {
  const fields = detailFields(r);
  const filled = fields.filter(([, v]) => v.trim() && v !== "—");
  const missing = fields.filter(([, v]) => !v.trim() || v === "—");
  const extras = [r.email, r.phone, r.destination].filter((v) => v && !filled.some(([, shown]) => shown.includes(v)));
  return (
    <div className="rw-details">
      <dl className="rw-fields">
        {filled.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        {extras.length > 0 && (
          <div>
            <dt>Contact details</dt>
            <dd>{extras.join(" · ")}</dd>
          </div>
        )}
      </dl>
      {!!missing.length && (
        <details className="missing-record-fields">
          <summary>
            {missing.length} {missing.length === 1 ? "field" : "fields"} not provided
          </summary>
          <p>{missing.map(([label]) => label).join(" · ")}</p>
        </details>
      )}
      {r.parentId && <p className="rw-footnote">Connected record: {r.parentId}</p>}
      <p className="rw-footnote record-timestamps">
        Created {new Date(r.createdAt).toLocaleDateString()} · Updated {new Date(r.updatedAt).toLocaleDateString()}
        <br />
        Reference <span className="record-reference">{r.id}</span>
      </p>
    </div>
  );
}

function RecordNotes({ record: r }: { record: RecordItem }) {
  if (!r.detail?.trim()) return null;
  return (
    <Section title={recordProfiles[r.kind].notes} className="rw-notes">
      <p className="rw-notes-text">{r.detail}</p>
    </Section>
  );
}

function RecordLines({ record: r }: { record: RecordItem }) {
  if (!r.lines?.length) return null;
  return (
    <Section title="Lines">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.description}</td>
                <td>{l.quantity}</td>
                <td>{money(l.unitPriceCents / 100, r.currency)}</td>
                <td>{money(Math.round(l.quantity * l.unitPriceCents) / 100, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/**
 * A quotation: its summary first — customer, products, total, validity — then
 * the document. On a phone the A4 preview is one tap away rather than being
 * the page; print always renders the document unchanged.
 */
function QuotationBody({ record, activity }: { record: RecordItem; activity: ReactNode }) {
  const [showDoc, setShowDoc] = useState(false);
  return (
    <div className="rw-body">
      <div className="rw-main">
        <QuotationSummary record={record} />
        <Section
          title="Document"
          className="rw-document"
          actions={
            <Button className="ghost compact rw-doc-toggle" aria-expanded={showDoc} onClick={() => setShowDoc(!showDoc)}>
              <FileText size={14} aria-hidden="true" /> {showDoc ? "Hide document" : "View document"}
            </Button>
          }
        >
          <div className={`rw-document-frame${showDoc ? " is-open" : ""}`}>
            <QuotationDocument record={record} />
          </div>
        </Section>
        {activity}
      </div>
    </div>
  );
}
