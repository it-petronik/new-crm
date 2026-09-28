"use client";
import { useEffect, useState, useId } from "react";
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
function commercialMoney(value: string, currency: string) {
  const [whole, fraction] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""} ${currency}`;
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
function OpenRecord({
  id,
  kind = "quotations",
  children,
}: {
  id: string;
  kind?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      className="secondary compact"
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
export default function ExecutionPanel({
  dealId,
  onChanged,
}: {
  dealId: string;
  onChanged: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [v, setV] = useState<ExecutionView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [rev, setRev] = useState(0);
  const [editor, setEditor] = useState<{
    type: "rfq" | "offer" | "scenario";
    supplierId: string;
    productId: string;
    rfq?: ExecutionView["rfqs"][number];
    offer?: ExecutionView["offers"][number];
    scenario?: ExecutionView["scenarios"][number];
  } | null>(null);
  useEffect(() => {
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
  async function run(body: unknown) {
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
  }
  const related = (supplierId: string, productId: string) => ({
    dealId,
    supplierId,
    productId,
    requestId: crypto.randomUUID(),
  });
  return (
    <section
      className="execution-panel"
      aria-label="Sourcing and commercial execution"
      aria-busy={busy}
    >
      <header>
        <span className="eyebrow">DEAL EXECUTION</span>
        <h3>Sourcing & commercial review</h3>
        <p>
          Keep supplier requests, offer revisions and reviewed selling scenarios
          together.
        </p>
      </header>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!v ? (
        <p role="status">Loading commercial activity…</p>
      ) : (
        <>
          <p className="muted small">{v.coverage}</p>
          <Button
            className="secondary compact"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll
              ? "Show fewer sourcing records"
              : "View all loaded sourcing records"}
          </Button>
          <h4>Supplier candidates</h4>
          {!v.matches.length && !v.candidates.length && (
            <p>
              No accessible matching capabilities. Review the Lead product and
              recorded supplier capabilities.
            </p>
          )}
          <div className="execution-grid">
            {v.matches
              .filter(
                (m) =>
                  !v.candidates.some(
                    (c) =>
                      c.supplierId === m.supplierId &&
                      c.productId === m.productId,
                  ),
              )
              .map((m) => (
                <article className="execution-card" key={m.id}>
                  <h4>{m.supplier}</h4>
                  <p>
                    {m.product} · {m.grade || "Grade not recorded"} ·{" "}
                    {m.originCountry || "Origin not recorded"}
                  </p>
                  <p className="muted small">
                    Potential supplier; availability and terms unconfirmed.
                  </p>
                  {v.writable && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run({
                          action: "candidate",
                          ...related(m.supplierId, m.productId),
                        })
                      }
                    >
                      Add candidate
                    </Button>
                  )}
                </article>
              ))}
          </div>
          <div className="execution-grid">
            {v.candidates.slice(0, showAll ? 200 : 6).map((c) => (
              <article className="execution-card" key={c.id}>
                <h4>{c.supplier}</h4>
                <p>
                  {c.product} · {c.status}
                </p>
                {v.writable && (
                  <div className="execution-actions">
                    <Button
                      disabled={busy || c.status === "Removed"}
                      onClick={() =>
                        setEditor({
                          type: "rfq",
                          supplierId: c.supplierId,
                          productId: c.productId,
                        })
                      }
                    >
                      Prepare RFQ
                    </Button>
                    <Button
                      className="secondary"
                      disabled={busy || c.status === "Removed"}
                      onClick={() =>
                        setEditor({
                          type: "offer",
                          supplierId: c.supplierId,
                          productId: c.productId,
                        })
                      }
                    >
                      Record offer
                    </Button>
                    <Choice
                      label={`Sourcing status for ${c.supplier}`}
                      name={`status-${c.id}`}
                      values={[c.status]}
                    />
                    {["No response", "Declined", "Removed"]
                      .filter((s) => s !== c.status)
                      .map((s) => (
                        <Button
                          className="secondary compact"
                          key={s}
                          disabled={busy}
                          onClick={() =>
                            void run({
                              action: "candidate",
                              ...related(c.supplierId, c.productId),
                              status: s,
                              version: c.version,
                            })
                          }
                        >
                          {s}
                        </Button>
                      ))}
                  </div>
                )}
              </article>
            ))}
          </div>
          <h4>Supplier requests</h4>
          {!v.rfqs.length && (
            <p>
              No RFQs yet. Prepare a structured request from the Lead
              requirement.
            </p>
          )}
          <div className="execution-grid">
            {v.rfqs.slice(0, showAll ? 200 : 6).map((r) => (
              <article className="execution-card" key={r.id}>
                <h4>
                  {r.supplier} · {r.status}
                </h4>
                <p>
                  {r.details.quantity} {r.details.unit} ·{" "}
                  {r.details.requestedIncoterm || "Incoterm not specified"} (
                  {r.details.incotermState})
                </p>
                <p>
                  {r.details.destination} · {r.details.packaging} ·{" "}
                  {r.details.deliveryRequirement}
                </p>
                {r.details.followUpDate && (
                  <p>Supplier follow-up: {r.details.followUpDate}</p>
                )}
                <details>
                  <summary>Request text to copy</summary>
                  <p className="execution-copy">{`Please quote ${r.details.quantity} ${r.details.unit} of ${r.product}${r.details.grade ? ` (${r.details.grade})` : ""}.\nDestination: ${r.details.destination || "To confirm"}. Requested Incoterm: ${r.details.requestedIncoterm || "To confirm"} (${r.details.incotermState}).\nPackaging: ${r.details.packaging || "To confirm"}. Delivery: ${r.details.deliveryRequirement || "To confirm"}.\n${r.details.notes}`}</p>
                </details>
                {v.writable && (
                  <div className="execution-actions">
                    {["Draft", "Prepared"].includes(r.status) && (
                      <Button
                        className="secondary"
                        onClick={() =>
                          setEditor({
                            type: "rfq",
                            supplierId: r.supplierId,
                            productId: r.productId,
                            rfq: r,
                          })
                        }
                      >
                        Edit request
                      </Button>
                    )}
                    {(r.status === "Draft"
                      ? ["Prepared", "Closed"]
                      : r.status === "Prepared"
                        ? ["Sent externally", "Closed"]
                        : r.status === "Sent externally"
                          ? ["Responded", "Closed"]
                          : r.status === "Responded"
                            ? ["Closed"]
                            : []
                    ).map((s) => (
                      <Button
                        className="secondary"
                        key={s}
                        disabled={busy}
                        onClick={() =>
                          void run({
                            action: "rfq",
                            ...related(r.supplierId, r.productId),
                            id: r.id,
                            version: r.version,
                            status: s,
                            details: r.details,
                          })
                        }
                      >
                        {s === "Sent externally"
                          ? "Record sent externally"
                          : `Mark ${s.toLowerCase()}`}
                      </Button>
                    ))}
                    <Button
                      disabled={busy}
                      onClick={() =>
                        setEditor({
                          type: "offer",
                          supplierId: r.supplierId,
                          productId: r.productId,
                          rfq: r,
                        })
                      }
                    >
                      Record response
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
          {v.canSeeCosts && (
            <>
              <h4>Offer comparison</h4>
              <p className="muted small">
                Compare within the same currency, price unit and Incoterm.
                Validity, MOQ, origin, availability and terms still require
                review. No automatic winner.
              </p>
              {[
                ...new Set(
                  v.offers
                    .filter((o) => o.status !== "Superseded")
                    .map((o) => o.comparisonGroup),
                ),
              ].map((group) => (
                <section key={group}>
                  <h5>{group}</h5>
                  <div className="execution-grid">
                    {v.offers
                      .filter(
                        (o) =>
                          o.status !== "Superseded" &&
                          o.comparisonGroup === group,
                      )
                      .map((o) => (
                        <article className="execution-card" key={o.id}>
                          <h4>
                            {o.supplier} · revision {o.revision}
                          </h4>
                          <strong>
                            BUY ·{" "}
                            {commercialMoney(
                              o.details.price,
                              o.details.currency,
                            )}{" "}
                            / {o.details.priceUnit}
                          </strong>
                          <p>
                            {o.status} · {o.validity} {o.details.validUntil}
                          </p>
                          <p>
                            Quantity {o.details.quantity} {o.details.unit} · MOQ{" "}
                            {o.details.moq || "Unspecified"} {o.details.moqUnit}
                          </p>
                          <p>
                            Origin {o.details.origin || "Unspecified"} ·{" "}
                            {o.details.loadingPort} · {o.details.packaging}
                          </p>
                          <p>
                            Payment: {o.details.paymentTerms || "To confirm"} ·
                            Lead time: {o.details.leadTime || "To confirm"}
                          </p>
                          <p>
                            Supplier-stated availability:{" "}
                            {o.details.availability || "Not recorded"}
                          </p>
                          <details>
                            <summary>Offer notes</summary>
                            <p>{o.details.notes || "No notes"}</p>
                          </details>
                          {v.writable && (
                            <div className="execution-actions">
                              <Button
                                onClick={() =>
                                  setEditor({
                                    type: "scenario",
                                    supplierId: o.supplierId,
                                    productId: o.productId,
                                    offer: o,
                                  })
                                }
                              >
                                Create scenario
                              </Button>
                              <Button
                                className="secondary"
                                onClick={() =>
                                  setEditor({
                                    type: "offer",
                                    supplierId: o.supplierId,
                                    productId: o.productId,
                                    offer: o,
                                  })
                                }
                              >
                                New revision
                              </Button>
                              {["Under review", "Selected", "Declined"]
                                .filter((s) => s !== o.status)
                                .map((status) => (
                                  <Button
                                    className="secondary compact"
                                    key={status}
                                    disabled={busy}
                                    onClick={() =>
                                      void run({
                                        action: "offer-status",
                                        id: o.id,
                                        version: o.version,
                                        status,
                                      })
                                    }
                                  >
                                    {status === "Selected"
                                      ? "Select offer"
                                      : status}
                                  </Button>
                                ))}
                            </div>
                          )}
                        </article>
                      ))}
                  </div>
                </section>
              ))}
              {!v.offers.length && <p>No supplier offers recorded.</p>}
              <details>
                <summary>
                  Previous offer revisions (
                  {v.offers.filter((o) => o.status === "Superseded").length})
                </summary>
                {v.offers
                  .filter((o) => o.status === "Superseded")
                  .map((o) => (
                    <article key={o.id}>
                      <h5>
                        {o.supplier} · revision {o.revision}
                      </h5>
                      <p>
                        {o.details.price} {o.details.currency}/
                        {o.details.priceUnit} · {o.details.incoterm} ·{" "}
                        {o.details.validUntil}
                      </p>
                      <p>{o.details.notes}</p>
                    </article>
                  ))}
              </details>
              <h4>Commercial scenarios</h4>
              <p>{v.approvalPolicy}</p>
              <p className="muted small">
                Reviewed scenarios preserve their inputs. Compare matching
                quantities, currencies and units; no automatic selection.
              </p>
              <div className="execution-grid">
                {v.scenarios.slice(0, showAll ? 100 : 6).map((s) => (
                  <article className="execution-card" key={s.id}>
                    <h4>
                      {s.details.name} · {s.status}
                    </h4>
                    <p>
                      {s.supplier} · {s.details.quantity} {s.details.unit} ·{" "}
                      {s.details.currency}
                    </p>
                    <dl className="execution-numbers">
                      <dt>BUY · landed total</dt>
                      <dd>
                        {commercialMoney(
                          s.calculation.landedCost,
                          s.details.currency,
                        )}
                      </dd>
                      <dt>Landed per {s.details.unit}</dt>
                      <dd>
                        {commercialMoney(
                          s.calculation.landedUnitCost,
                          s.details.currency,
                        )}
                      </dd>
                      <dt>SELL · total</dt>
                      <dd>
                        {commercialMoney(
                          s.calculation.sellingTotal,
                          s.details.currency,
                        )}
                      </dd>
                      <dt>Margin · amount / % of sales</dt>
                      <dd>
                        {commercialMoney(
                          s.calculation.marginAmount,
                          s.details.currency,
                        )}{" "}
                        ({s.calculation.marginPercent}%)
                      </dd>
                    </dl>
                    <details>
                      <summary>Cost and FX breakdown</summary>
                      {s.calculation.components.map((c, i) => (
                        <p key={i}>
                          {c.kind === "supplier" ? "Supplier BUY cost" : c.kind}
                          : {commercialMoney(c.amount, s.details.currency)}
                        </p>
                      ))}
                      {s.details.fx.map((f) => (
                        <p key={f.fromCurrency}>
                          1 {f.fromCurrency} = {f.rate} {f.toCurrency} ·
                          manually recorded
                        </p>
                      ))}
                      <p>{s.details.notes}</p>
                      <p className="muted small">{s.calculation.rounding}</p>
                    </details>
                    {v.writable && (
                      <div className="execution-actions">
                        {s.status === "Draft" && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void run({
                                action: "scenario-status",
                                id: s.id,
                                version: s.version,
                                status: "Reviewed",
                              })
                            }
                          >
                            Mark reviewed
                          </Button>
                        )}
                        {s.status === "Reviewed" && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void run({
                                action: "scenario-status",
                                id: s.id,
                                version: s.version,
                                status: "Selected",
                              })
                            }
                          >
                            Select scenario
                          </Button>
                        )}
                        {s.status === "Draft" && (
                          <Button
                            className="secondary"
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
                            disabled={busy}
                            onClick={() =>
                              void run({
                                action: "quotation",
                                id: s.id,
                                version: s.version,
                              })
                            }
                          >
                            Prepare quotation draft
                          </Button>
                        )}
                        {s.quotationId && (
                          <OpenRecord id={s.quotationId}>
                            Open quotation
                          </OpenRecord>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {editor && v && (
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
            if (r) setEditor(null);
            else
              throw Error(
                "Could not save. Review the error in the sourcing panel.",
              );
          }}
        />
      )}
    </section>
  );
}
function ExecutionEditor({
  editor: e,
  view: v,
  onClose,
  onSave,
}: {
  editor: {
    type: "rfq" | "offer" | "scenario";
    supplierId: string;
    productId: string;
    rfq?: ExecutionView["rfqs"][number];
    offer?: ExecutionView["offers"][number];
    scenario?: ExecutionView["scenarios"][number];
  };
  view: ExecutionView;
  onClose: () => void;
  onSave: (details: unknown, requestId: string) => Promise<void>;
}) {
  const formId = useId();
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<ReturnType<
      typeof calculateScenario
    > | null>(null);
  const initial = (
    e.type === "rfq"
      ? e.rfq?.details
      : e.type === "offer"
        ? e.offer?.details
        : e.scenario?.details
  ) as Record<string, unknown> | undefined;
  const val = (k: string, fallback = "") => String(initial?.[k] ?? fallback);
  const [scenarioCurrency, setScenarioCurrency] = useState(
    val("currency", e.offer?.details.currency || "USD"),
  );
  const qty = val(
    "quantity",
    e.offer?.details.quantity || String(v.lead.quantity || ""),
  );
  const unit = val(
    "unit",
    units.includes(v.lead.unit as (typeof units)[number]) ? v.lead.unit : "MT",
  );
  function data(form: HTMLFormElement) {
    const raw = Object.fromEntries(new FormData(form).entries()) as Record<
      string,
      string
    >;
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
      currency: raw[`${kind}-currency`] as ScenarioInput["currency"],
      basis: raw[`${kind}-basis`] as "total" | "per-unit",
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
  return (
    <Dialog
      className="execution-editor"
      title={
        e.type === "rfq"
          ? "Supplier request"
          : e.type === "offer"
            ? "Record supplier offer"
            : "Commercial scenario"
      }
      onClose={onClose}
    >
      <h2>
        {e.type === "rfq"
          ? "Prepare supplier request"
          : e.type === "offer"
            ? "Record supplier offer"
            : "Review commercial scenario"}
      </h2>
      <p className="muted">
        {e.type === "scenario"
          ? "SELL: enter the reviewed customer unit price. Supplier BUY cost comes from the linked offer. FX rates are entered manually; selection remains yours."
          : "Review the Lead requirement and supplier-stated terms before saving. Supplier offer prices are BUY prices, not customer selling prices."}
      </p>
      <form
        id={formId}
        onChange={() => setPreview(null)}
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
        <div className="execution-fields">
          {e.type === "scenario" && (
            <TextField
              label="Customer quotation valid until"
              name="quotationValidUntil"
              type="date"
              value={val("quotationValidUntil")}
            />
          )}
          {e.type === "scenario" && (
            <TextField
              label="Scenario name"
              name="name"
              value={val("name")}
              required
            />
          )}
          {e.type !== "scenario" && (
            <TextField
              label="Grade"
              name="grade"
              value={val("grade", v.lead.attributes?.grade)}
            />
          )}
          <TextField label="Quantity" name="quantity" value={qty} required />
          <Choice
            label="Quantity unit"
            name="unit"
            value={unit}
            values={units}
          />
          {e.type === "rfq" ? (
            <>
              <TextField
                label="Destination"
                name="destination"
                value={val("destination", v.lead.destination)}
              />
              <TextField
                label="Requested Incoterm"
                name="requestedIncoterm"
                value={val("requestedIncoterm", v.lead.attributes?.incoterm)}
              />
              <Choice
                label="Incoterm meaning"
                name="incotermState"
                value={val("incotermState", "requested")}
                values={[
                  "requested",
                  "preferred",
                  "proposed",
                  "confirmed",
                  "agreed",
                  "unknown",
                ]}
              />
              <TextField
                label="Supplier follow-up"
                name="followUpDate"
                type="date"
                value={val("followUpDate")}
              />
            </>
          ) : (
            <>
              <Choice
                label="Currency"
                name="currency"
                value={val("currency", e.offer?.details.currency || "USD")}
                values={currencies}
                onChange={setScenarioCurrency}
              />
              <TextField
                label={
                  e.type === "offer"
                    ? "Supplier unit price"
                    : "Reviewed selling unit price"
                }
                name={e.type === "offer" ? "price" : "sellPrice"}
                value={val(e.type === "offer" ? "price" : "sellPrice")}
                required
              />
              <Choice
                label="Price unit"
                name={e.type === "offer" ? "priceUnit" : "sellUnit"}
                value={val(e.type === "offer" ? "priceUnit" : "sellUnit", unit)}
                values={units}
              />
              <TextField
                label="Incoterm"
                name="incoterm"
                value={val("incoterm", e.offer?.details.incoterm)}
              />
              <TextField
                label="Payment terms"
                name="paymentTerms"
                value={val("paymentTerms", e.offer?.details.paymentTerms)}
              />
            </>
          )}
          {e.type === "offer" && (
            <>
              <TextField
                label="Minimum quantity (optional)"
                name="moq"
                value={val("moq")}
              />
              <Choice
                label="MOQ unit"
                name="moqUnit"
                value={val("moqUnit", unit)}
                values={units}
              />
              {[
                ["origin", "Origin"],
                ["loadingPort", "Loading port"],
                ["leadTime", "Lead time"],
                ["availability", "Supplier-stated availability"],
              ].map(([k, l]) => (
                <TextField key={k} label={l} name={k} value={val(k)} />
              ))}
              <TextField
                label="Valid until"
                name="validUntil"
                type="date"
                value={val("validUntil")}
              />
              <TextField
                label="Received on"
                name="receivedAt"
                type="date"
                value={val("receivedAt", new Date().toISOString().slice(0, 10))}
              />
            </>
          )}
          <TextField
            label="Packaging"
            name="packaging"
            value={val("packaging", v.lead.attributes?.packaging)}
          />
          {e.type !== "offer" && (
            <TextField
              label="Delivery requirement"
              name="deliveryRequirement"
              value={val(
                "deliveryRequirement",
                v.lead.attributes?.deliveryTimeline,
              )}
            />
          )}
        </div>
        {e.type === "scenario" && (
          <>
            <h3>Additional costs</h3>
            <p className="muted small">
              Enter zero when a cost does not apply. Per-unit costs use the
              selected quantity unit.
            </p>
            {costKinds.map((kind) => {
              const c = e.scenario?.details.costs.find((c) => c.kind === kind);
              return (
                <fieldset className="execution-cost" key={kind}>
                  <legend>{kind}</legend>
                  <TextField
                    label={`${kind} amount`}
                    name={`${kind}-amount`}
                    value={c?.amount || "0"}
                  />
                  <Choice
                    label={`${kind} currency`}
                    name={`${kind}-currency`}
                    value={
                      c?.currency ||
                      val("currency", e.offer?.details.currency || "USD")
                    }
                    values={currencies}
                  />
                  <Choice
                    label={`${kind} basis`}
                    name={`${kind}-basis`}
                    value={c?.basis || "total"}
                    values={["total", "per-unit"]}
                  />
                </fieldset>
              );
            })}
            <details>
              <summary>Manual FX rates</summary>
              <p>
                Manual rates only: 1 source currency = entered rate in{" "}
                {scenarioCurrency}. Leave unused rates empty. No live exchange
                rate is applied.
              </p>
              <div className="execution-fields">
                {currencies
                  .filter((c) => c !== scenarioCurrency)
                  .map((c) => (
                    <TextField
                      key={c}
                      label={`From ${c} to ${scenarioCurrency} (manual)`}
                      name={`fx-${c}`}
                      value={
                        e.scenario?.details.fx.find((f) => f.fromCurrency === c)
                          ?.rate || ""
                      }
                    />
                  ))}
              </div>
            </details>
          </>
        )}
        <Field
          label={e.type === "scenario" ? "Internal scenario notes" : "Notes"}
        >
          <Textarea name="notes" defaultValue={val("notes")} maxLength={2000} />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {preview && (
          <p role="status">
            Landed BUY {commercialMoney(preview.landedCost, preview.currency)} ·
            SELL {commercialMoney(preview.sellingTotal, preview.currency)} ·
            Margin {commercialMoney(preview.marginAmount, preview.currency)} (
            {preview.marginPercent}% of sales)
          </p>
        )}
        <div className="execution-actions">
          {e.type === "scenario" && (
            <Button
              type="button"
              className="secondary"
              onClick={(event) => {
                try {
                  setPreview(
                    calculateScenario(
                      data(event.currentTarget.form!) as ScenarioInput,
                      e.offer!.details,
                    ),
                  );
                  setError("");
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              Calculate preview
            </Button>
          )}
        </div>
        <DialogActions
          primary={{
            label: `Save ${e.type === "rfq" ? "request" : e.type}`,
            type: "submit",
            form: formId,
            pending: busy,
          }}
          pending={busy}
          onCancel={onClose}
        />
      </form>
    </Dialog>
  );
}
export function ExecutionHistory({ recordId }: { recordId: string }) {
  const [data, setData] = useState<{
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
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    fetch(`/api/execution?recordId=${encodeURIComponent(recordId)}`, {
      signal: c.signal,
    })
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
  }, [recordId]);
  return (
    <section>
      <h4>Commercial history</h4>
      {error && <p role="alert">{error}</p>}
      <p className="muted">{data?.label}</p>
      {data?.rfqs.length ? (
        <details>
          <summary>Supplier requests ({data.rfqs.length})</summary>
          {data.rfqs.map((r) => (
            <article className="execution-card" key={r.id}>
              <h5>
                {r.supplier} · {r.product}
              </h5>
              <p>
                {r.status} · {r.details.quantity} {r.details.unit}
              </p>
              {r.details.followUpDate && (
                <p>Follow-up {r.details.followUpDate}</p>
              )}
              <OpenRecord kind="leads" id={r.leadId}>
                Open related Deal
              </OpenRecord>
            </article>
          ))}
        </details>
      ) : null}
      {data?.offers.map((o) => (
        <article className="execution-card" key={o.id}>
          <h5>
            {o.supplier} · {o.product} · revision {o.revision}
          </h5>
          <p>
            {o.details.price} {o.details.currency}/{o.details.priceUnit} ·{" "}
            {o.details.incoterm} · {o.validity}
          </p>
          <OpenRecord kind="leads" id={o.leadId}>
            Open related Deal
          </OpenRecord>
        </article>
      ))}
      {data && !data.offers.length && (
        <p>No accessible supplier offer history.</p>
      )}
    </section>
  );
}
