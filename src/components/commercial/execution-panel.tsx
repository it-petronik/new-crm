"use client";
import { useCallback, useEffect, useState, useId } from "react";
import { ChevronRight } from "lucide-react";
import { useUnsavedChanges } from "../use-unsaved";
import type { ExecutionView } from "@/lib/execution/store";
import {
  calculateScenario,
  costKinds,
  currencies,
  units,
  type ScenarioInput,
  type OfferDetails,
} from "@/lib/execution/model";
import {
  Button,
  Dialog,
  DialogActions,
  Field as BaseField,
  Input,
  Select,
  Textarea,
} from "../ui/controls";
import { openReference } from "@/lib/ai/client";
import { statusTone } from "@/lib/status";
import { MoreActions } from "../ui/row-actions";
import { EmptyState, Section } from "../ui/layout";

/* ---------------------------------------------------------------------------
   Deal sourcing and commercial review — the building blocks.

   The Deal workspace composes these per tab (Overview, Sourcing, Commercial).
   `useExecution` owns the one execution view, every action and the single
   editor drawer, so each tab renders from the same data and every action
   calls the same endpoint with the same body as before.
   ------------------------------------------------------------------------ */

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <BaseField>
      {label}
      {children}
    </BaseField>
  );
}
/** Groups the whole part of an exact decimal string; the value itself is untouched. */
export function grouped(value: string) {
  const [whole, fraction] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
}
export function commercialMoney(value: string, currency: string) {
  return `${grouped(value)} ${currency}`;
}
export const quantity = (value: string, unit: string) => `${grouped(value)} ${unit}`;
/**
 * A compact status inside a heading. The hidden separator keeps the heading's
 * accessible name as "Name · Status".
 */
export function StatusTag({ status }: { status: string }) {
  return (
    <span className={`e-badge is-sm tone-${statusTone(status)}`}>
      <span className="e-badge-dot" aria-hidden="true" />
      <span className="sr-only">· </span>
      {status}
    </span>
  );
}
export async function phase7Call<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Could not complete the request.");
  return d;
}
export function OpenRecord({
  id,
  kind = "quotations",
  children,
  className = "ghost compact",
}: {
  id: string;
  kind?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Button
      className={className}
      onClick={() =>
        openReference({
          id: "",
          label: String(children),
          target: { type: "record", kind, id },
        })
      }
    >
      {children}
    </Button>
  );
}
const costLabels: Record<(typeof costKinds)[number], string> = {
  freight: "Freight",
  insurance: "Insurance",
  handling: "Handling",
  bank: "Bank charges",
  commission: "Commission",
  other: "Other costs",
};

export function TextField({
  label,
  name,
  value = "",
  required = false,
  type = "text",
}: {
  label: string;
  name: string;
  value?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <Field label={label}>
      <Input
        name={name}
        defaultValue={value}
        required={required}
        type={type}
        maxLength={300}
      />
    </Field>
  );
}
export function Choice({
  label,
  name,
  value,
  values,
  onChange,
}: {
  label: string;
  name: string;
  value?: string;
  values: readonly string[];
  onChange?: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <Select
        name={name}
        defaultValue={value || values[0]}
        onChange={(event) => onChange?.(event.target.value)}
      >
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </Select>
    </Field>
  );
}

type Offer = ExecutionView["offers"][number];
type Rfq = ExecutionView["rfqs"][number];
type Scenario = ExecutionView["scenarios"][number];
export type EditorTarget = {
  type: "rfq" | "offer" | "scenario";
  supplierId: string;
  productId: string;
  rfq?: Rfq;
  offer?: Offer;
  scenario?: Scenario;
};

/* ------------------------------------------------------------------ state */

export type Execution = ReturnType<typeof useExecution>;

export function useExecution(dealId: string | undefined, onChanged: () => void, onSaved?: (type: EditorTarget["type"]) => void) {
  const [v, setV] = useState<ExecutionView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rev, setRev] = useState(0);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  useEffect(() => {
    if (!dealId) return;
    const c = new AbortController();
    fetch(`/api/execution?dealId=${encodeURIComponent(dealId)}`, {
      signal: c.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        return d;
      })
      .then(setV)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [dealId, rev]);
  const run = useCallback(
    async (body: unknown) => {
      setBusy(true);
      setError("");
      try {
        const result = await phase7Call<{ id?: string }>("execution", body);
        setRev((n) => n + 1);
        onChanged();
        return result;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );
  const related = (supplierId: string, productId: string) => ({
    dealId,
    supplierId,
    productId,
    requestId: crypto.randomUUID(),
  });
  const editorNode =
    editor && v && dealId ? (
      <ExecutionEditor
        key={`${editor.type}:${editor.rfq?.id || editor.offer?.id || editor.scenario?.id || "new"}`}
        editor={editor}
        view={v}
        onClose={() => setEditor(null)}
        onSave={async (details, requestId) => {
          let body: unknown;
          const common = {
            ...related(editor.supplierId, editor.productId),
            requestId,
          };
          if (editor.type === "rfq")
            body = {
              action: "rfq",
              ...common,
              id: editor.rfq?.id,
              version: editor.rfq?.version,
              status: editor.rfq?.status || "Draft",
              details,
            };
          else if (editor.type === "offer")
            body = {
              action: "offer",
              ...common,
              rfqId: editor.rfq?.id,
              previousId: editor.offer?.id,
              version: editor.offer?.version,
              details,
            };
          else
            body = {
              action: "scenario",
              offerId: editor.offer?.id,
              requestId: common.requestId,
              id: editor.scenario?.id,
              version: editor.scenario?.version,
              details,
            };
          const r = await run(body);
          if (!r) throw Error("Could not save. Review the message on the Deal.");
          setEditor(null);
          onSaved?.(editor.type);
        }}
      />
    ) : null;
  return { v, error, busy, run, related, editor, setEditor, editorNode };
}

/* ------------------------------------------------------- derived state */

export function sourcingState(v: ExecutionView) {
  const liveOffers = v.offers.filter((o) => o.status !== "Superseded");
  const sent = v.rfqs.filter((r) => ["Sent externally", "Responded"].includes(r.status)).length;
  const selectedScenario = v.scenarios.find((s) => s.status === "Selected");
  const quoted = v.scenarios.find((s) => s.quotationId);
  return {
    candidates: v.candidates.filter((c) => c.status !== "Removed").length,
    rfqs: v.rfqs.length,
    sent,
    offers: liveOffers.length,
    selectedOffer: liveOffers.find((o) => o.status === "Selected"),
    scenarios: v.scenarios.length,
    selectedScenario,
    quoted,
    liveOffers,
  };
}

/**
 * Where the Deal stands, left to right. Each step opens the tab that holds
 * its detail. Offer, scenario and quotation steps only exist for people who
 * may see BUY costs.
 */
export function SourcingProgress({
  v,
  onJump,
}: {
  v: ExecutionView;
  onJump?: (tab: "sourcing" | "commercial") => void;
}) {
  const s = sourcingState(v);
  const steps: { label: string; value: string; note?: string; tab: "sourcing" | "commercial"; done: boolean }[] = [
    { label: "Suppliers", value: String(s.candidates), tab: "sourcing", done: s.candidates > 0 },
    { label: "RFQs", value: String(s.rfqs), note: s.sent ? `${s.sent} sent` : undefined, tab: "sourcing", done: s.sent > 0 },
    ...(v.canSeeCosts
      ? [
          { label: "Offers", value: String(s.offers), note: s.selectedOffer ? "1 selected" : undefined, tab: "sourcing" as const, done: s.offers > 0 },
          { label: "Pricing", value: String(s.scenarios), note: s.selectedScenario ? "1 selected" : undefined, tab: "commercial" as const, done: !!s.selectedScenario },
          { label: "Quotation", value: s.quoted ? "Prepared" : "Not yet", tab: "commercial" as const, done: !!s.quoted },
        ]
      : []),
  ];
  return (
    <ol className="deal-progress" aria-label="Sourcing progress">
      {steps.map((step) => {
        const body = (
          <>
            <span className="deal-progress-label">{step.label}</span>
            <span className="deal-progress-value">
              {step.value}
              {step.note && <small> · {step.note}</small>}
            </span>
          </>
        );
        return (
          <li key={step.label} className={step.done ? "is-done" : undefined}>
            {onJump ? (
              <button type="button" onClick={() => onJump(step.tab)} aria-label={`${step.label}: ${step.value}${step.note ? `, ${step.note}` : ""}. Open ${step.tab}`}>
                {body}
              </button>
            ) : (
              <div>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------- sourcing */

export function CandidatesSection({ x, limit = 200 }: { x: Execution; limit?: number }) {
  const { v, busy, run, related, setEditor } = x;
  if (!v) return null;
  const openMatches = v.matches.filter(
    (m) => !v.candidates.some((c) => c.supplierId === m.supplierId && c.productId === m.productId),
  );
  const evidence = (supplierId: string, productId: string) =>
    v.matches.find((m) => m.supplierId === supplierId && m.productId === productId);
  return (
    <Section title="Supplier candidates" description="Suppliers with a recorded capability for this product. A capability is not an offer.">
      {!openMatches.length && !v.candidates.length ? (
        <EmptyState
          title="No matching supplier capabilities."
          detail="Record what a supplier can supply on its Supplier record; matches appear here."
        />
      ) : (
        <ul className="exec-rows">
          {v.candidates.slice(0, limit).map((c) => {
            const m = evidence(c.supplierId, c.productId);
            return (
              <li className="exec-row" key={c.id}>
                <div className="exec-row-main">
                  <h4>
                    {c.supplier} <StatusTag status={c.status} />
                  </h4>
                  <p className="exec-meta">{[c.product, m?.grade, m?.originCountry].filter(Boolean).join(" · ")}</p>
                </div>
                {v.writable && (
                  <div className="exec-row-actions">
                    <Button
                      className="secondary compact"
                      disabled={busy || c.status === "Removed"}
                      onClick={() => setEditor({ type: "rfq", supplierId: c.supplierId, productId: c.productId })}
                    >
                      Prepare RFQ
                    </Button>
                    <Button
                      className="ghost compact"
                      disabled={busy || c.status === "Removed"}
                      onClick={() => setEditor({ type: "offer", supplierId: c.supplierId, productId: c.productId })}
                    >
                      Record offer
                    </Button>
                    <MoreActions
                      label={c.supplier}
                      actions={["No response", "Declined", "Removed"]
                        .filter((s) => s !== c.status)
                        .map((s) => ({
                          id: s,
                          label: `Mark ${s.toLowerCase()}`,
                          destructive: s === "Removed",
                          run: () =>
                            void run({
                              action: "candidate",
                              ...related(c.supplierId, c.productId),
                              status: s,
                              version: c.version,
                            }),
                        }))}
                    />
                  </div>
                )}
              </li>
            );
          })}
          {openMatches.map((m) => (
            <li className="exec-row is-potential" key={m.id}>
              <div className="exec-row-main">
                <h4>
                  {m.supplier} <span className="exec-tag">Potential</span>
                </h4>
                <p className="exec-meta">
                  {[m.product, m.grade || "Grade not recorded", m.originCountry || "Origin not recorded"].join(" · ")}
                </p>
              </div>
              {v.writable && (
                <div className="exec-row-actions">
                  <Button
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => void run({ action: "candidate", ...related(m.supplierId, m.productId) })}
                  >
                    Add candidate
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const NEXT_RFQ: Record<string, string | null> = {
  Draft: "Prepared",
  Prepared: "Sent externally",
  "Sent externally": "Responded",
  Responded: null,
  Closed: null,
};

/** RFQs: the key terms on the row, the request text one click away. */
export function RfqSection({ x, limit = 200 }: { x: Execution; limit?: number }) {
  const { v, busy, run, related, setEditor } = x;
  if (!v) return null;
  return (
    <Section title="Supplier requests">
      {!v.rfqs.length ? (
        <EmptyState title="No RFQs yet." detail="Prepare one from a supplier candidate." />
      ) : (
        <ul className="exec-rows rfq-rows">
          {v.rfqs.slice(0, limit).map((r) => {
            const next = NEXT_RFQ[r.status] ?? null;
            const setStatus = (status: string) =>
              void run({
                action: "rfq",
                ...related(r.supplierId, r.productId),
                id: r.id,
                version: r.version,
                status,
                details: r.details,
              });
            return (
              <li className="exec-row" key={r.id}>
                <div className="exec-row-main">
                  <h4>
                    {r.supplier} <StatusTag status={r.status} />
                  </h4>
                  <dl className="rfq-terms">
                    <div>
                      <dt>Quantity</dt>
                      <dd>{quantity(r.details.quantity, r.details.unit)}</dd>
                    </div>
                    <div>
                      <dt>Incoterm</dt>
                      <dd>
                        {r.details.requestedIncoterm || "Not specified"} <small>({r.details.incotermState})</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Destination</dt>
                      <dd>{r.details.destination || "To confirm"}</dd>
                    </div>
                    <div>
                      <dt>Follow-up</dt>
                      <dd>{r.details.followUpDate || "Not set"}</dd>
                    </div>
                  </dl>
                  <details className="exec-disclosure">
                    <summary>Packaging, delivery and request text</summary>
                    <p className="exec-meta">
                      {[r.product, r.details.grade, r.details.packaging, r.details.deliveryRequirement].filter(Boolean).join(" · ")}
                    </p>
                    <p className="execution-copy">{`Please quote ${r.details.quantity} ${r.details.unit} of ${r.product}${r.details.grade ? ` (${r.details.grade})` : ""}.\nDestination: ${r.details.destination || "To confirm"}. Requested Incoterm: ${r.details.requestedIncoterm || "To confirm"} (${r.details.incotermState}).\nPackaging: ${r.details.packaging || "To confirm"}. Delivery: ${r.details.deliveryRequirement || "To confirm"}.\n${r.details.notes}`}</p>
                  </details>
                </div>
                {v.writable && (
                  <div className="exec-row-actions">
                    {next && (
                      <Button className="secondary compact" disabled={busy} onClick={() => setStatus(next)}>
                        {next === "Sent externally" ? "Record sent externally" : `Mark ${next.toLowerCase()}`}
                      </Button>
                    )}
                    <Button
                      className={next === "Responded" ? "secondary compact" : "ghost compact"}
                      disabled={busy}
                      onClick={() => setEditor({ type: "offer", supplierId: r.supplierId, productId: r.productId, rfq: r })}
                    >
                      Record response
                    </Button>
                    <MoreActions
                      label={`${r.supplier} request`}
                      actions={[
                        ...(["Draft", "Prepared"].includes(r.status)
                          ? [
                              {
                                id: "edit",
                                label: "Edit request",
                                run: () => setEditor({ type: "rfq" as const, supplierId: r.supplierId, productId: r.productId, rfq: r }),
                              },
                            ]
                          : []),
                        ...(r.status !== "Closed" ? [{ id: "close", label: "Mark closed", run: () => setStatus("Closed") }] : []),
                      ]}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/**
 * The comparison surface. One table per comparison basis (currency, price
 * unit, Incoterm): offers are rows, the terms that decide between suppliers
 * are columns. On a phone each offer becomes its own card. Previous revisions
 * stay behind one disclosure.
 */
export function OfferComparison({ x }: { x: Execution }) {
  const { v, busy, run, setEditor } = x;
  if (!v || !v.canSeeCosts) return null;
  const s = sourcingState(v);
  const previous = v.offers.filter((o) => o.status === "Superseded");
  const groups = [...new Set(s.liveOffers.map((o) => o.comparisonGroup))];
  return (
    <Section
      title="Supplier offers"
      description="BUY terms as stated by each supplier. Compare within one currency, price unit and Incoterm; validity, MOQ and terms still need review. No automatic winner."
    >
      {!s.liveOffers.length && (
        <EmptyState title="No supplier offers yet." detail="Record an offer after receiving supplier terms." />
      )}
      {groups.map((group) => {
        const [currency, unit, ...incoterm] = group.split("/");
        const offers = s.liveOffers.filter((o) => o.comparisonGroup === group);
        return (
          <div className="offer-group" key={group}>
            <p className="offer-group-label">
              {currency} per {unit} · {incoterm.join("/")}
              <span> · {offers.length} {offers.length === 1 ? "offer" : "offers"}</span>
            </p>
            <table className="rtable offer-table">
              <caption className="sr-only">
                Offers priced in {currency} per {unit}, {incoterm.join("/")}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Supplier</th>
                  <th scope="col" className="is-num">BUY price</th>
                  <th scope="col">Quantity · MOQ</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Lead time</th>
                  <th scope="col">Validity</th>
                  <th scope="col">Origin</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id} className={o.status === "Selected" ? "is-selected" : undefined}>
                    <th scope="row" className="rtable-title">
                      <span className="offer-supplier">
                        {o.supplier} <span className="exec-revision">· revision {o.revision}</span>
                      </span>
                      <StatusTag status={o.status} />
                      {v.writable && (
                        <div className="exec-row-actions is-desktop">
                          <Button
                            className="secondary compact"
                            onClick={() => setEditor({ type: "scenario", supplierId: o.supplierId, productId: o.productId, offer: o })}
                          >
                            Create scenario
                          </Button>
                          <Button
                            className="ghost compact"
                            onClick={() => setEditor({ type: "offer", supplierId: o.supplierId, productId: o.productId, offer: o })}
                          >
                            New revision
                          </Button>
                          <MoreActions
                            label={`${o.supplier} offer`}
                            actions={["Under review", "Selected", "Declined"]
                              .filter((st) => st !== o.status)
                              .map((status) => ({
                                id: status,
                                label: status === "Selected" ? "Select offer" : status === "Declined" ? "Decline offer" : "Mark under review",
                                destructive: status === "Declined",
                                run: () => void run({ action: "offer-status", id: o.id, version: o.version, status }),
                              }))}
                          />
                        </div>
                      )}
                    </th>
                    <td className="is-num offer-price" data-label="BUY price">
                      <strong className="e-numeric">{commercialMoney(o.details.price, o.details.currency)}</strong>
                      <small> / {o.details.priceUnit}</small>
                    </td>
                    <td data-label="Quantity · MOQ">
                      {quantity(o.details.quantity, o.details.unit)}
                      <small>
                        MOQ {o.details.moq ? quantity(o.details.moq, o.details.moqUnit || o.details.unit) : "unspecified"}
                      </small>
                    </td>
                    <td data-label="Payment">{o.details.paymentTerms || "To confirm"}</td>
                    <td data-label="Lead time">{o.details.leadTime || "To confirm"}</td>
                    <td data-label="Validity">
                      <span className={`exec-validity tone-${statusTone(o.validity)}`}>{o.validity}</span>
                      {o.details.validUntil && <small>until {o.details.validUntil}</small>}
                    </td>
                    <td data-label="Origin">
                      {o.details.origin || "Unspecified"}
                      {o.details.loadingPort && <small>{o.details.loadingPort}</small>}
                    </td>
                    {/* On a phone the same actions close the card, after the terms. */}
                    {v.writable && (
                      <td className="rtable-actions is-phone">
                        <div className="exec-row-actions">
                          <Button
                            className="secondary compact"
                            onClick={() => setEditor({ type: "scenario", supplierId: o.supplierId, productId: o.productId, offer: o })}
                          >
                            Create scenario
                          </Button>
                          <Button
                            className="ghost compact"
                            onClick={() => setEditor({ type: "offer", supplierId: o.supplierId, productId: o.productId, offer: o })}
                          >
                            New revision
                          </Button>
                          <MoreActions
                            label={`${o.supplier} offer`}
                            actions={["Under review", "Selected", "Declined"]
                              .filter((st) => st !== o.status)
                              .map((status) => ({
                                id: status,
                                label: status === "Selected" ? "Select offer" : status === "Declined" ? "Decline offer" : "Mark under review",
                                destructive: status === "Declined",
                                run: () => void run({ action: "offer-status", id: o.id, version: o.version, status }),
                              }))}
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {offers.some((o) => o.details.notes || o.details.packaging || o.details.availability) && (
              <details className="exec-disclosure">
                <summary>Packaging, availability and notes</summary>
                <ul className="offer-notes">
                  {offers.map((o) => (
                    <li key={o.id}>
                      <b>{o.supplier}</b>{" "}
                      {[
                        o.details.packaging && `Packaging: ${o.details.packaging}`,
                        `Supplier-stated availability: ${o.details.availability || "not recorded"}`,
                        o.details.notes,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}
      {busy && <span className="sr-only" role="status">Saving…</span>}
      {previous.length > 0 && (
        <details className="exec-disclosure exec-history">
          <summary>Previous offer revisions ({previous.length})</summary>
          <ul className="exec-rows">
            {previous.map((o) => (
              <li className="exec-row" key={o.id}>
                <div className="exec-row-main">
                  <h4>
                    {o.supplier} <span className="exec-revision">· revision {o.revision}</span>
                  </h4>
                  <p className="exec-meta">
                    <span className="e-numeric">{commercialMoney(o.details.price, o.details.currency)}</span> / {o.details.priceUnit}
                    {" · "}
                    {o.details.incoterm || "Incoterm not specified"}
                    {o.details.validUntil ? ` · valid until ${o.details.validUntil}` : ""}
                  </p>
                  {o.details.notes && <p className="exec-note">{o.details.notes}</p>}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

/* ----------------------------------------------------------- commercial */

/**
 * One scenario's economics, readable in seconds: four figures across (BUY,
 * landed, SELL, margin), the breakdown one click away. Every figure is the
 * server's calculation or the reviewed input it was calculated from.
 */
export function FinancialSummary({
  s,
  offer,
  children,
}: {
  s: Scenario;
  offer?: Offer;
  children?: React.ReactNode;
}) {
  const c = s.calculation;
  const cur = s.details.currency;
  const negative = c.marginAmount.startsWith("-");
  const costs = c.components.filter((x) => x.kind !== "supplier");
  const buy = c.components.find((x) => x.kind === "supplier");
  return (
    <article className={`fin-card${s.status === "Selected" ? " is-selected" : ""}`}>
      <header className="fin-head">
        <h4>
          {s.details.name} <StatusTag status={s.status} />
        </h4>
        <p className="exec-meta">
          {s.supplier} · {quantity(s.details.quantity, s.details.unit)} · {cur}
          {s.details.quotationValidUntil && ` · quote valid until ${s.details.quotationValidUntil}`}
        </p>
      </header>
      <dl className="fin-figures">
        <div>
          <dt>Supplier BUY</dt>
          <dd>
            {offer ? (
              <>
                <span className="fin-value">{commercialMoney(offer.details.price, offer.details.currency)}</span>
                <span className="fin-unit">per {offer.details.priceUnit}</span>
              </>
            ) : (
              <span className="fin-value">—</span>
            )}
            {buy && <span className="fin-total">{commercialMoney(buy.amount, cur)} total</span>}
          </dd>
        </div>
        <div>
          <dt>Landed</dt>
          <dd>
            <span className="fin-value">{commercialMoney(c.landedUnitCost, cur)}</span>
            <span className="fin-unit">per {s.details.unit}</span>
            <span className="fin-total">{commercialMoney(c.landedCost, cur)} total</span>
          </dd>
        </div>
        <div>
          <dt>Customer SELL</dt>
          <dd>
            <span className="fin-value">{commercialMoney(s.details.sellPrice, cur)}</span>
            <span className="fin-unit">per {s.details.sellUnit}</span>
            <span className="fin-total">{commercialMoney(c.sellingTotal, cur)} total</span>
          </dd>
        </div>
        <div className={`fin-margin${negative ? " is-negative" : ""}`}>
          <dt>{negative ? "Negative margin" : "Margin"}</dt>
          <dd>
            <span className="fin-value">{commercialMoney(c.marginAmount, cur)}</span>
            <span className="fin-percent">{c.marginPercent}% of sales</span>
          </dd>
        </div>
      </dl>
      {s.details.fx.length > 0 && (
        <p className="exec-fx">
          <span>Manual FX</span>
          {s.details.fx.map((f) => (
            <span key={f.fromCurrency} className="e-numeric">
              {f.fromCurrency} → {f.toCurrency} {f.rate}
            </span>
          ))}
          <span className="exec-fx-note">entered manually</span>
        </p>
      )}
      <details className="exec-disclosure">
        <summary>Cost breakdown{costs.length ? ` · ${costs.length} additional ${costs.length === 1 ? "cost" : "costs"}` : ""}</summary>
        <dl className="exec-money">
          {buy && (
            <div>
              <dt>Supplier BUY</dt>
              <dd>{commercialMoney(buy.amount, cur)}</dd>
            </div>
          )}
          {costs.map((x, i) => (
            <div className="is-cost" key={i}>
              <dt>+ {x.kind}</dt>
              <dd>{commercialMoney(x.amount, cur)}</dd>
            </div>
          ))}
          <div className="is-total">
            <dt>Landed total</dt>
            <dd>{commercialMoney(c.landedCost, cur)}</dd>
          </div>
          <div className="is-total">
            <dt>Customer SELL total</dt>
            <dd>{commercialMoney(c.sellingTotal, cur)}</dd>
          </div>
        </dl>
        {s.details.notes && <p>{s.details.notes}</p>}
        <p className="exec-note">{c.rounding}</p>
      </details>
      {children && <div className="exec-row-actions fin-actions">{children}</div>}
    </article>
  );
}

const SCENARIO_ORDER: Record<string, number> = { Selected: 0, Reviewed: 1, Draft: 2 };

export function ScenarioSection({ x, limit = 100 }: { x: Execution; limit?: number }) {
  const { v, busy, run, setEditor } = x;
  if (!v || !v.canSeeCosts) return null;
  const scenarios = [...v.scenarios].sort((a, b) => (SCENARIO_ORDER[a.status] ?? 3) - (SCENARIO_ORDER[b.status] ?? 3));
  return (
    <Section
      title="Pricing"
      description={`${v.approvalPolicy} Reviewed scenarios keep their inputs; there is no automatic selection.`}
    >
      {!scenarios.length ? (
        <EmptyState
          title="No scenarios yet."
          detail="Create one from a supplier offer on the Sourcing tab to work out landed cost, selling price and margin."
        />
      ) : (
        <div className="fin-list">
          {scenarios.slice(0, limit).map((s) => (
            <FinancialSummary key={s.id} s={s} offer={v.offers.find((o) => o.id === s.offerId)}>
              {v.writable && (
                <>
                  {s.status === "Draft" && (
                    <Button
                      className="secondary compact"
                      disabled={busy}
                      onClick={() => void run({ action: "scenario-status", id: s.id, version: s.version, status: "Reviewed" })}
                    >
                      Mark reviewed
                    </Button>
                  )}
                  {s.status === "Reviewed" && (
                    <Button
                      className="secondary compact"
                      disabled={busy}
                      onClick={() => void run({ action: "scenario-status", id: s.id, version: s.version, status: "Selected" })}
                    >
                      Select scenario
                    </Button>
                  )}
                  {s.status === "Draft" && (
                    <Button
                      className="ghost compact"
                      onClick={() =>
                        setEditor({
                          type: "scenario",
                          supplierId: s.supplierId,
                          productId: s.productId,
                          scenario: s,
                          offer: v.offers.find((o) => o.id === s.offerId),
                        })
                      }
                    >
                      Edit scenario
                    </Button>
                  )}
                  {s.status === "Selected" && !s.quotationId && (
                    <Button
                      className="primary compact"
                      disabled={busy}
                      onClick={() => void run({ action: "quotation", id: s.id, version: s.version })}
                    >
                      Prepare quotation draft
                    </Button>
                  )}
                </>
              )}
              {s.quotationId && (
                <OpenRecord id={s.quotationId} className="secondary compact">
                  Open quotation
                </OpenRecord>
              )}
            </FinancialSummary>
          ))}
        </div>
      )}
    </Section>
  );
}

/** The selected supplier offer, as one line, above the scenarios built on it. */
export function SelectedOffer({ x, onSourcing }: { x: Execution; onSourcing?: () => void }) {
  const { v } = x;
  if (!v || !v.canSeeCosts) return null;
  const o = sourcingState(v).selectedOffer;
  return (
    <Section title="Selected offer">
      {o ? (
        <div className="selected-offer">
          <div>
            <p className="selected-offer-name">
              {o.supplier} <span className="exec-revision">· revision {o.revision}</span>
            </p>
            <p className="exec-meta">
              {[o.details.incoterm, o.details.paymentTerms, o.details.leadTime && `Lead time ${o.details.leadTime}`, o.validity].filter(Boolean).join(" · ")}
            </p>
          </div>
          <p className="selected-offer-price">
            <span className="e-numeric">{commercialMoney(o.details.price, o.details.currency)}</span>
            <small> / {o.details.priceUnit}</small>
          </p>
        </div>
      ) : (
        <EmptyState
          title="No offer selected yet."
          detail="Scenarios can still be built from any offer; selecting one records the decision."
          action={
            onSourcing && (
              <Button className="ghost compact" onClick={onSourcing}>
                Compare offers <ChevronRight size={14} aria-hidden="true" />
              </Button>
            )
          }
        />
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- editor */

/**
 * RFQ, offer and scenario editing in one drawer. Fields are grouped by the
 * decision they belong to; the form's field names — and so the saved payload
 * — are exactly as before.
 */
function ExecutionEditor({
  editor: e,
  view: v,
  onClose,
  onSave,
}: {
  editor: EditorTarget;
  view: ExecutionView;
  onClose: () => void;
  onSave: (details: unknown, requestId: string) => Promise<void>;
}) {
  const formId = useId();
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<ReturnType<typeof calculateScenario> | null>(null);
  const initial = (
    e.type === "rfq" ? e.rfq?.details : e.type === "offer" ? e.offer?.details : e.scenario?.details
  ) as Record<string, unknown> | undefined;
  const val = (k: string, fallback = "") => String(initial?.[k] ?? fallback);
  const [scenarioCurrency, setScenarioCurrency] = useState(val("currency", e.offer?.details.currency || "USD"));
  // Pricing shows the costs in use plus the two most common; the rest are
  // one tap away. Costs not shown are sent exactly as before: zero.
  const existingCosts = e.scenario?.details.costs || [];
  const [shownCosts, setShownCosts] = useState<(typeof costKinds)[number][]>(() => {
    const used = costKinds.filter((k) => existingCosts.some((c) => c.kind === k && Number(c.amount) !== 0));
    return used.length ? used : ["freight", "insurance"];
  });
  const [costCurrency, setCostCurrency] = useState<Record<string, string>>(() =>
    Object.fromEntries(costKinds.map((k) => [k, existingCosts.find((c) => c.kind === k)?.currency || val("currency", e.offer?.details.currency || "USD")])),
  );
  // Rates are asked for only when an amount is in another currency.
  const fxNeeded = currencies.filter(
    (c) => c !== scenarioCurrency && (c === e.offer?.details.currency || shownCosts.some((k) => costCurrency[k] === c)),
  );
  const qty = val("quantity", e.offer?.details.quantity || String(v.lead.quantity || ""));
  const unit = val("unit", units.includes(v.lead.unit as (typeof units)[number]) ? v.lead.unit : "MT");
  const supplier =
    v.candidates.find((c) => c.supplierId === e.supplierId)?.supplier ||
    v.matches.find((m) => m.supplierId === e.supplierId)?.supplier ||
    e.offer?.supplier ||
    e.rfq?.supplier ||
    "";
  function data(form: HTMLFormElement) {
    const raw = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    if (e.type !== "scenario") {
      if (e.type === "offer" && !raw.moq) {
        delete raw.moq;
        delete raw.moqUnit;
      }
      return raw;
    }
    const costs = costKinds.map((kind) => ({
      kind,
      amount: raw[`${kind}-amount`] || "0",
      currency: (raw[`${kind}-currency`] || raw.currency) as ScenarioInput["currency"],
      basis: (raw[`${kind}-basis`] || "total") as "total" | "per-unit",
      unit: raw.unit as ScenarioInput["unit"],
    }));
    const fx = currencies
      .filter((c) => c !== raw.currency && raw[`fx-${c}`])
      .map((c) => ({
        fromCurrency: c,
        toCurrency: raw.currency as ScenarioInput["currency"],
        rate: raw[`fx-${c}`],
      }));
    return {
      quotationValidUntil: raw.quotationValidUntil,
      name: raw.name,
      quantity: raw.quantity,
      unit: raw.unit,
      currency: raw.currency,
      sellPrice: raw.sellPrice,
      sellUnit: raw.sellUnit,
      costs,
      fx,
      incoterm: raw.incoterm,
      packaging: raw.packaging,
      paymentTerms: raw.paymentTerms,
      deliveryRequirement: raw.deliveryRequirement,
      notes: raw.notes,
    } as ScenarioInput;
  }
  // Closing with real edits asks first; an untouched editor just closes.
  const unsaved = useUnsavedChanges(busy);
  const close = unsaved.guard(onClose);
  const group = (title: string, children: React.ReactNode, hint?: string) => (
    <fieldset className="editor-group">
      <legend>{title}</legend>
      {hint && <p className="exec-caption">{hint}</p>}
      <div className="execution-fields">{children}</div>
    </fieldset>
  );
  return (
    <Dialog
      variant="drawer"
      className="execution-editor"
      title={e.type === "rfq" ? "Supplier request" : e.type === "offer" ? "Record supplier offer" : "Pricing"}
      description={[supplier, v.lead.product].filter(Boolean).join(" · ")}
      onClose={close}
      dismissOnOutside={!busy}
    >
      <p className="exec-editor-intro">
        {e.type === "scenario"
          ? "The supplier's price comes from the offer. Add your costs and your selling price to see the margin."
          : e.type === "offer"
            ? "Supplier-stated terms. Offer prices are BUY prices, not customer selling prices."
            : "Built from the Lead requirement. Review before saving."}
      </p>
      <form
        id={formId}
        onChange={(event) => {
          setPreview(null);
          unsaved.markDirty(event);
        }}
        onInput={unsaved.markDirty}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSave(data(event.currentTarget), requestId);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {e.type === "rfq" && (
          <>
            {group(
              "Key terms",
              <>
                <TextField label="Quantity" name="quantity" value={qty} required />
                <Choice label="Quantity unit" name="unit" value={unit} values={units} />
                <TextField label="Destination" name="destination" value={val("destination", v.lead.destination)} />
                <TextField label="Requested Incoterm" name="requestedIncoterm" value={val("requestedIncoterm", v.lead.attributes?.incoterm)} />
                <Choice
                  label="Incoterm meaning"
                  name="incotermState"
                  value={val("incotermState", "requested")}
                  values={["requested", "preferred", "proposed", "confirmed", "agreed", "unknown"]}
                />
                <TextField label="Supplier follow-up" name="followUpDate" type="date" value={val("followUpDate")} />
              </>,
            )}
            {group(
              "Product and delivery",
              <>
                <TextField label="Grade" name="grade" value={val("grade", v.lead.attributes?.grade)} />
                <TextField label="Packaging" name="packaging" value={val("packaging", v.lead.attributes?.packaging)} />
                <TextField label="Delivery requirement" name="deliveryRequirement" value={val("deliveryRequirement", v.lead.attributes?.deliveryTimeline)} />
              </>,
            )}
          </>
        )}
        {e.type === "offer" && (
          <>
            {group(
              "Price",
              <>
                <TextField label="Supplier unit price" name="price" value={val("price")} required />
                <Choice label="Currency" name="currency" value={val("currency", e.offer?.details.currency || "USD")} values={currencies} />
                <Choice label="Price unit" name="priceUnit" value={val("priceUnit", unit)} values={units} />
                <TextField label="Incoterm" name="incoterm" value={val("incoterm", e.offer?.details.incoterm)} />
              </>,
            )}
            {group(
              "Quantity",
              <>
                <TextField label="Quantity" name="quantity" value={qty} required />
                <Choice label="Quantity unit" name="unit" value={unit} values={units} />
                <TextField label="Minimum quantity (optional)" name="moq" value={val("moq")} />
                <Choice label="MOQ unit" name="moqUnit" value={val("moqUnit", unit)} values={units} />
              </>,
            )}
            {group(
              "Terms and validity",
              <>
                <TextField label="Payment terms" name="paymentTerms" value={val("paymentTerms", e.offer?.details.paymentTerms)} />
                <TextField label="Lead time" name="leadTime" value={val("leadTime")} />
                <TextField label="Valid until" name="validUntil" type="date" value={val("validUntil")} />
                <TextField label="Received on" name="receivedAt" type="date" value={val("receivedAt", new Date().toISOString().slice(0, 10))} />
              </>,
            )}
            {group(
              "Product and origin",
              <>
                <TextField label="Grade" name="grade" value={val("grade", v.lead.attributes?.grade)} />
                <TextField label="Packaging" name="packaging" value={val("packaging", v.lead.attributes?.packaging)} />
                <TextField label="Origin" name="origin" value={val("origin")} />
                <TextField label="Loading port" name="loadingPort" value={val("loadingPort")} />
                <TextField label="Supplier-stated availability" name="availability" value={val("availability")} />
              </>,
            )}
          </>
        )}
        {e.type === "scenario" && (
          <>
            {e.offer && (
              <div className="editor-source" aria-label="Source offer">
                <span className="editor-source-label">Source offer</span>
                <strong>
                  {e.offer.supplier} · revision {e.offer.revision}
                </strong>
                <span className="e-numeric">
                  {commercialMoney(e.offer.details.price, e.offer.details.currency)} / {e.offer.details.priceUnit}
                </span>
                <span className="exec-meta">
                  {[e.offer.details.incoterm, quantity(e.offer.details.quantity, e.offer.details.unit), e.offer.details.moq && `MOQ ${quantity(e.offer.details.moq, e.offer.details.moqUnit || e.offer.details.unit)}`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            )}
            {group(
              "Quantity",
              <>
                <TextField label="Name this pricing" name="name" value={val("name", e.offer ? `${e.offer.supplier} ${e.offer.details.incoterm || ""}`.trim().slice(0, 100) : "")} required />
                <TextField label="Customer quotation valid until" name="quotationValidUntil" type="date" value={val("quotationValidUntil")} />
                <TextField label="Quantity" name="quantity" value={qty} required />
                <Choice label="Quantity unit" name="unit" value={unit} values={units} />
              </>,
            )}
            <fieldset className="editor-group">
              <legend>Your costs</legend>
              <p className="exec-caption">Per-unit costs use the selected quantity unit.</p>
              <div className="exec-cost-table">
                <div className="exec-cost-head" aria-hidden="true">
                  <span>Cost</span>
                  <span>Amount</span>
                  <span>Currency</span>
                  <span>Basis</span>
                </div>
                {shownCosts.map((kind) => {
                  const c = existingCosts.find((c) => c.kind === kind);
                  return (
                    <fieldset className="execution-cost" key={kind}>
                      <legend>{costLabels[kind]}</legend>
                      <TextField label={`${costLabels[kind]} amount`} name={`${kind}-amount`} value={c?.amount || "0"} />
                      <Choice
                        label={`${costLabels[kind]} currency`}
                        name={`${kind}-currency`}
                        value={costCurrency[kind]}
                        values={currencies}
                        onChange={(cur) => setCostCurrency((prev) => ({ ...prev, [kind]: cur }))}
                      />
                      <Choice label={`${costLabels[kind]} basis`} name={`${kind}-basis`} value={c?.basis || "total"} values={["total", "per-unit"]} />
                    </fieldset>
                  );
                })}
              </div>
              {shownCosts.length < costKinds.length && (
                <div className="exec-add-costs" role="group" aria-label="Add a cost">
                  <span className="exec-caption">Add a cost:</span>
                  {costKinds
                    .filter((k) => !shownCosts.includes(k))
                    .map((k) => (
                      <Button key={k} type="button" className="ghost compact" onClick={() => setShownCosts((prev) => costKinds.filter((x) => prev.includes(x) || x === k))}>
                        + {costLabels[k]}
                      </Button>
                    ))}
                </div>
              )}
            </fieldset>
            {fxNeeded.length > 0 && (
              <fieldset className="editor-group">
                <legend>Exchange rates</legend>
                <p className="exec-caption">Enter today&apos;s rate yourself; no live rate is used.</p>
                <div className="execution-fields">
                  {fxNeeded.map((c) => (
                    <TextField
                      key={c}
                      label={`Convert ${c} to ${scenarioCurrency} (1 ${c} =)`}
                      name={`fx-${c}`}
                      value={e.scenario?.details.fx.find((f) => f.fromCurrency === c)?.rate || ""}
                    />
                  ))}
                </div>
              </fieldset>
            )}
            {group(
              "Our selling price to the customer",
              <>
                <TextField label="Selling price per unit" name="sellPrice" value={val("sellPrice")} required />
                <Choice
                  label="Currency"
                  name="currency"
                  value={val("currency", e.offer?.details.currency || "USD")}
                  values={currencies}
                  onChange={setScenarioCurrency}
                />
                <Choice label="Price unit" name="sellUnit" value={val("sellUnit", unit)} values={units} />
              </>,
            )}
            {group(
              "Customer terms",
              <>
                <TextField label="Incoterm" name="incoterm" value={val("incoterm", e.offer?.details.incoterm)} />
                <TextField label="Payment terms" name="paymentTerms" value={val("paymentTerms", e.offer?.details.paymentTerms)} />
                <TextField label="Packaging" name="packaging" value={val("packaging", v.lead.attributes?.packaging)} />
                <TextField label="Delivery requirement" name="deliveryRequirement" value={val("deliveryRequirement", v.lead.attributes?.deliveryTimeline)} />
              </>,
            )}
          </>
        )}
        <Field label={e.type === "scenario" ? "Internal notes (not shown to the customer)" : "Notes"}>
          <Textarea name="notes" defaultValue={val("notes")} maxLength={2000} />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {e.type === "scenario" && (
          <section className="editor-result" aria-label="Result">
            <p className="editor-result-title">Result</p>
            {preview ? (
              <dl className="exec-money exec-preview" role="status" aria-label="Scenario preview">
                <div className="is-total">
                  <dt>Landed BUY</dt>
                  <dd>{commercialMoney(preview.landedCost, preview.currency)}</dd>
                </div>
                <div>
                  <dt>Landed per unit</dt>
                  <dd>{commercialMoney(preview.landedUnitCost, preview.currency)}</dd>
                </div>
                <div className="is-total">
                  <dt>Customer SELL</dt>
                  <dd>{commercialMoney(preview.sellingTotal, preview.currency)}</dd>
                </div>
                <div className={`is-margin${preview.marginAmount.startsWith("-") ? " is-negative" : ""}`}>
                  <dt>{preview.marginAmount.startsWith("-") ? "Negative margin" : "Margin"}</dt>
                  <dd>
                    {commercialMoney(preview.marginAmount, preview.currency)}
                    <span className="exec-margin-percent">{preview.marginPercent}% of sales</span>
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="exec-caption">Calculate a preview to check landed cost, SELL and margin before saving.</p>
            )}
          </section>
        )}
        <DialogActions
          secondary={
            e.type === "scenario" && (
              <Button
                type="button"
                form={formId}
                className="secondary"
                onClick={(event) => {
                  try {
                    setPreview(calculateScenario(data(event.currentTarget.form!) as ScenarioInput, e.offer!.details));
                    setError("");
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                Calculate preview
              </Button>
            )
          }
          primary={{
            label: `Save ${e.type === "rfq" ? "request" : e.type === "scenario" ? "pricing" : e.type}`,
            type: "submit",
            form: formId,
            pending: busy,
          }}
          pending={busy}
          onCancel={close}
        />
      </form>
      {unsaved.confirm}
    </Dialog>
  );
}

/* ------------------------------------------- supplier / product history */

export type ExecutionHistoryData = {
  label: string;
  rfqs: Array<{
    id: string;
    supplier: string;
    product: string;
    status: string;
    leadId: string;
    details: { quantity: string; unit: string; followUpDate: string };
  }>;
  offers: Array<{
    id: string;
    supplier: string;
    product: string;
    leadId: string;
    revision: number;
    validity: string;
    details: OfferDetails;
  }>;
};

export function useExecutionHistory(recordId: string, enabled: boolean) {
  const [data, setData] = useState<ExecutionHistoryData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    fetch(`/api/execution?recordId=${encodeURIComponent(recordId)}`, { signal: c.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        return d;
      })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [recordId, enabled]);
  return { data, error };
}

/** Offers a supplier made (or were made for a product), newest first. */
export function OfferHistorySection({ data, error }: { data: ExecutionHistoryData | null; error: string }) {
  return (
    <Section title="Offers received" description={data?.label}>
      {error && <p role="alert" className="form-error">{error}</p>}
      {!data ? (
        <div className="exec-skeleton" role="status" aria-label="Loading offers"><span /><span /></div>
      ) : !data.offers.length ? (
        <EmptyState title="No supplier offers you can access yet." />
      ) : (
        <div className="rtable-frame">
        <table className="rtable offer-history">
          <thead>
            <tr>
              <th scope="col">Offer</th>
              <th scope="col" className="is-num">BUY price</th>
              <th scope="col">Incoterm</th>
              <th scope="col">Validity</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {data.offers.map((o) => (
              <tr key={o.id}>
                <th scope="row" className="rtable-title">
                  <span className="offer-supplier">
                    {o.supplier} · {o.product} <span className="exec-revision">· revision {o.revision}</span>
                  </span>
                </th>
                <td className="is-num" data-label="BUY price">
                  <strong className="e-numeric">{commercialMoney(o.details.price, o.details.currency)}</strong>
                  <small> / {o.details.priceUnit}</small>
                </td>
                <td data-label="Incoterm">{o.details.incoterm || "—"}</td>
                <td data-label="Validity">
                  <span className={`exec-validity tone-${statusTone(o.validity)}`}>{o.validity}</span>
                </td>
                <td className="rtable-actions">
                  <OpenRecord kind="leads" id={o.leadId}>
                    Open related Deal
                  </OpenRecord>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </Section>
  );
}

/** Requests sent to a supplier (or for a product), with their status. */
export function RfqHistorySection({ data }: { data: ExecutionHistoryData | null }) {
  if (!data) return null;
  return (
    <Section title="Supplier requests">
      {!data.rfqs.length ? (
        <EmptyState title="No supplier requests yet." detail="RFQs prepared from a Deal appear here." />
      ) : (
        <ul className="exec-rows">
          {data.rfqs.map((r) => (
            <li className="exec-row" key={r.id}>
              <div className="exec-row-main">
                <h4>
                  {r.supplier} · {r.product} <StatusTag status={r.status} />
                </h4>
                <p className="exec-meta">
                  {quantity(r.details.quantity, r.details.unit)}
                  {r.details.followUpDate ? ` · Follow up ${r.details.followUpDate}` : ""}
                </p>
              </div>
              <div className="exec-row-actions">
                <OpenRecord kind="leads" id={r.leadId}>
                  Open related Deal
                </OpenRecord>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

