"use client";
import { bulkState } from "@/lib/prospecting/review-state";
import { describeCriteria } from "@/lib/prospecting/filters";
import { useState } from "react";
import { Button, Dialog, DialogActions, Input, Select } from "../ui/controls";
import { Field, phase7Call } from "./execution-panel";
import type {
  bulkImportReview,
  bulkImport,
  BulkImportItem,
} from "@/lib/prospecting/imports";
import type { OperationView } from "@/lib/prospecting/operations-model";
import type { Report } from "@/lib/prospecting/export";
export function CreditDialog({
  op,
  busy,
  onClose,
  onRun,
  onRetry,
  onPhones,
  error,
}: {
  op: OperationView;
  error?: string;
  busy: boolean;
  onClose: () => void;
  onRun: () => void;
  onRetry: () => void;
  onPhones: () => void;
}) {
  const d = op.data,
    completed = d.items.filter(
      (i) => !["pending", "running"].includes(i.status),
    ).length;
  return (
    <Dialog
      title="Find contact details"
      className="execution-editor apollo-dialog apollo-enrichment-dialog"
      onClose={onClose}
    >
      {busy && (
        <p role="status">
          {d.type === "search"
            ? "Searching Apollo..."
            : "Enriching selected prospects..."}
        </p>
      )}
      <h3>
        {d.type === "search"
          ? `${d.kind === "company" ? "Company" : "People"} search · page ${d.criteria.page}`
          : `Enrich ${d.items.length} ${d.kind === "company" ? "companies" : "people"}`}
      </h3>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="apollo-credit-total">
        <span>Estimated {d.type === "enrich" ? "maximum" : "page cost"}</span>
        <strong>
          {d.estimate.toLocaleString()}{" "}
          {d.estimate === 1 ? "credit" : "credits"}
        </strong>
      </div>
      <p>
        {d.phones
          ? "Native phone lookup selected: up to 9 credits per person. Only explicitly classified work phone numbers are displayed. Other numbers may still be billed by Apollo."
          : d.kind === "person" && d.type === "enrich"
            ? "Business email and profile enrichment: up to 1 credit per person. Personal emails and waterfall are off."
            : d.type === "search" && d.kind === "person"
              ? "People search does not reveal emails or phones and uses no Apollo search credits."
              : "Apollo may charge for the requested page or organization even when useful new data is limited."}
      </p>
      <p>
        Available:{" "}
        <strong>
          {d.available === null
            ? "Balance unavailable from Apollo API"
            : `${d.available.toLocaleString()} credits (cached)`}
        </strong>
      </p>
      {d.available !== null && d.estimate > d.available && (
        <p className="form-error" role="alert">
          This selection could exceed the known balance. No items have been
          removed. Cancel to review your selection or explicitly confirm the
          full request.
        </p>
      )}
      {d.items.length > 10 && (
        <p className="muted small">
          Processed in batches of 10. Closing pauses after the current batch.
        </p>
      )}
      {d.retryAt && d.retryAt > Date.now() && (
        <p role="status">
          Retry after {new Date(d.retryAt).toLocaleTimeString()}. No automatic
          retry is scheduled.
        </p>
      )}
      {op.status !== "prepared" && (
        <section aria-live="polite">
          <h3>
            {op.status === "running"
              ? "Request in progress"
              : op.status === "unknown"
                ? "Charge needs reconciliation"
                : op.status === "completed"
                  ? "Operation complete"
                  : "Operation paused"}
          </h3>
          {d.type === "enrich" && (
            <>
              <progress
                aria-label="Enrichment progress"
                value={completed}
                max={d.items.length}
              />
              <p>
                {completed} / {d.items.length} completed · Succeeded{" "}
                {d.items.filter((i) => i.status === "succeeded").length} · No
                data {d.items.filter((i) => i.status === "no_data").length} ·
                Failed {d.items.filter((i) => i.status === "failed").length} ·
                Unknown{" "}
                {
                  d.items.filter(
                    (i) => i.status === "unknown" || i.status === "running",
                  ).length
                }
              </p>
            </>
          )}
          <p>
            Observed credits: {d.actualCredits ?? "Not reported"}
            {d.actualComplete === false
              ? " (partial observation; total unknown)"
              : ""}
          </p>
          {d.message && <p role="alert">{d.message}</p>}
          {(op.status === "unknown" ||
            d.items.some((i) => i.status === "unknown")) && (
            <p role="alert">
              Do not submit the same prospects again until Apollo usage has been
              reconciled. This request identity will not run again.
            </p>
          )}
          <ul className="apollo-progress-list">
            {d.items.map((i) => (
              <li key={i.prospect.id}>
                <strong>{i.prospect.name}</strong>
                <span>
                  {i.status.replaceAll("_", " ")}
                  {i.message ? ` · ${i.message}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {d.phoneJobs?.some((j) => !j.done) && (
        <Button className="secondary compact" disabled={busy} onClick={onPhones}>
          Check pending phone results · no credits
        </Button>
      )}
      {d.phoneJobs
        ?.filter((j) => j.done)
        .map((j) => (
          <p key={j.requestId}>
            Phone lookup completed. Apollo phone-result credit observation (not
            combined with initial response): {j.actualCredits ?? "Not reported"}
            . No number is shown unless Apollo identifies it as a work number.
          </p>
        ))}
      {(op.status === "failed" ||
        (op.status === "completed" &&
          d.items.some((i) => i.status === "failed"))) && (
        <Button className="secondary compact" disabled={busy} onClick={onRetry}>
          Review retry of failed items only
        </Button>
      )}
      <DialogActions
        onCancel={onClose}
        cancel={busy ? "Pause after this batch" : "Close"}
        primary={
          ["prepared", "paused"].includes(op.status)
            ? {
                label:
                  d.type === "search"
                    ? `Search — ${d.estimate} ${d.estimate === 1 ? "credit" : "credits"}`
                    : `Confirm enrichment — up to ${d.estimate} credits`,
                onClick: onRun,
                disabled: busy || (d.available === 0 && d.estimate > 0),
                pending: busy,
              }
            : undefined
        }
      />
    </Dialog>
  );
}
export function BulkImportDialog({
  review,
  productId,
  onClose,
  onDone,
}: {
  review: Awaited<ReturnType<typeof bulkImportReview>>;
  productId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [items, setItems] = useState<BulkImportItem[]>(() =>
    review.items.map((r) => ({
      ...r.ref,
      requestId: crypto.randomUUID(),
      companyName: r.companyName.slice(0, 160),
      contactName: r.contactName.slice(0, 160),
      email: r.prospect.email,
      phone: r.prospect.phone,
      customerId: r.customerId,
      contactId:
        r.contactId ||
        (r.contactMatches.length === 1 ? r.contactMatches[0].id : undefined),
      skip: r.needsReview,
      groupCompany: true,
      createContact: r.prospect.kind === "person",
      createLead: false,
      createDeal: false,
      productId,
    })),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Awaited<
      ReturnType<typeof bulkImport>
    > | null>(null);
  const patch = (i: number, v: Partial<BulkImportItem>) =>
    setItems((items) => items.map((x, n) => (n === i ? { ...x, ...v } : x)));
  async function submit(retry = false) {
    setBusy(true);
    setError("");
    try {
      const retryIds = new Set(
        result?.results
          .filter((r) => r.status === "Failed")
          .map((r) => r.providerId),
      );
      const next = await phase7Call<Awaited<ReturnType<typeof bulkImport>>>(
        "prospecting",
        {
          action: "bulk-import",
          confirmed: true,
          items: retry
            ? items.filter((i) => retryIds.has(i.providerId))
            : items,
        },
      );
      setResult(next);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // Each prospect is ready, already in Enercore, or needs a decision. Only
  // the last group asks anything of the person.
  const [decided, setDecided] = useState<Record<string, "existing" | "separate" | "skip">>({});
  const decide = (i: number, choice: "existing" | "separate" | "skip", customerId?: string) => {
    setDecided((d) => ({ ...d, [review.items[i].prospect.id]: choice }));
    patch(i, {
      skip: choice === "skip",
      customerId: choice === "existing" ? customerId : undefined,
      contactId: undefined,
      createAnyway: choice === "separate",
    });
  };
  const groupOf = (i: number) => bulkState(review.items[i], !!decided[review.items[i].prospect.id], items[i].customerId);
  const indexes = review.items.map((_, i) => i);
  const reviewIdx = indexes.filter((i) => groupOf(i) === "review");
  const readyIdx = indexes.filter((i) => groupOf(i) === "ready");
  const existingIdx = indexes.filter((i) => groupOf(i) === "existing");
  const included = indexes.filter((i) => groupOf(i) !== "review" && !items[i].skip);
  const effect = {
    customers: new Set(included.filter((i) => !items[i].customerId).map((i) => (items[i].groupCompany ? review.items[i].prospect.companyId || review.items[i].prospect.id : review.items[i].prospect.id))).size,
    contacts: included.filter((i) => review.items[i].prospect.kind === "person" && items[i].createContact && !items[i].contactId).length,
    leads: included.filter((i) => items[i].createLead).length,
    existingCustomers: new Set(included.filter((i) => items[i].customerId).map((i) => items[i].customerId)).size,
    existingContacts: included.filter((i) => items[i].contactId).length,
  };
  const allLeads = included.length > 0 && included.every((i) => items[i].createLead);
  const goTo = (page: string) => {
    const company = window.location.pathname.split("/")[2] || "all-companies";
    window.history.pushState(null, "", `/workspace/${company}/${page}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    onClose();
  };
  const row = (i: number, toggle = true) => {
    const r = review.items[i];
    return (
      <li key={r.prospect.id} className="bulk-row">
        {toggle && (
          <input
            type="checkbox"
            aria-label={`Include ${r.prospect.name}`}
            checked={!items[i].skip}
            disabled={busy || !!result}
            onChange={(e) => patch(i, { skip: !e.target.checked })}
          />
        )}
        <span>
          <b>{r.prospect.name}</b>
          <small>
            {[
              r.prospect.kind === "person" ? r.companyName : r.prospect.country,
              items[i].customerId && `Uses ${r.customers.find((c) => c.id === items[i].customerId)?.title || "existing customer"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </span>
      </li>
    );
  };
  return (
    <Dialog title="Add to Enercore" className="execution-editor apollo-dialog bulk-review" onClose={onClose}>
      {!result ? (
        <>
          <p className="bulk-summary" aria-live="polite">
            <b>{items.length} selected</b>
            <span>{readyIdx.length} ready to add</span>
            <span>{existingIdx.length} already in Enercore</span>
            <span className={reviewIdx.length ? "is-attention" : ""}>{reviewIdx.length} need review</span>
          </p>
          {reviewIdx.length > 0 && (
            <section className="bulk-group" aria-labelledby="bulk-review-title">
              <h3 id="bulk-review-title">Needs review</h3>
              <ul className="bulk-issues">
                {reviewIdx.map((i) => {
                  const r = review.items[i];
                  const incomplete = r.prospect.kind === "person" && !r.prospect.nameComplete;
                  return (
                    <li key={r.prospect.id}>
                      <p className="bulk-issue-name">
                        <b>{r.prospect.name}</b> <small>{r.companyName}</small>
                      </p>
                      {r.customers.length > 0 && (
                        <p className="bulk-issue-why">
                          May already be in Enercore:{" "}
                          {r.customers.map((c) => `${c.title} (${c.reasons.map((x) => BULK_REASONS[x] || x).join(", ")})`).join("; ")}
                        </p>
                      )}
                      {incomplete && (
                        <Field label="Full contact name">
                          <Input value={items[i].contactName} maxLength={160} onChange={(e) => patch(i, { contactName: e.target.value })} />
                        </Field>
                      )}
                      <div className="prospect-status-actions">
                        {r.customers.map((c) => (
                          <Button key={c.id} className="secondary compact" disabled={busy} onClick={() => decide(i, "existing", c.id)}>
                            Use {c.title}
                          </Button>
                        ))}
                        <Button
                          className="secondary compact"
                          disabled={busy || (incomplete && !(items[i].contactName || "").trim())}
                          onClick={() => decide(i, "separate")}
                        >
                          {r.customers.length ? "Create separate" : "Add"}
                        </Button>
                        <Button className="ghost compact" disabled={busy} onClick={() => decide(i, "skip")}>
                          Skip
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {readyIdx.length > 0 && (
            <details className="bulk-group">
              <summary>Ready to add ({readyIdx.filter((i) => !items[i].skip).length})</summary>
              <ul className="bulk-rows">{readyIdx.map((i) => row(i))}</ul>
            </details>
          )}
          {existingIdx.length > 0 && (
            <details className="bulk-group">
              <summary>Already in Enercore ({existingIdx.filter((i) => !items[i].skip).length})</summary>
              <p className="exec-caption">New contacts and leads are added to the existing customer; its details are not overwritten.</p>
              <ul className="bulk-rows">{existingIdx.map((i) => row(i))}</ul>
            </details>
          )}
          <label className="execution-check">
            <input
              type="checkbox"
              checked={allLeads}
              disabled={busy || !included.length}
              onChange={(e) => setItems((all) => all.map((x) => ({ ...x, createLead: e.target.checked, createDeal: e.target.checked })))}
            />
            <span>Also create a lead for each</span>
          </label>
          <div className="bulk-effect">
            <p>
              <b>Will create:</b> {effect.customers} {effect.customers === 1 ? "customer" : "customers"}, {effect.contacts}{" "}
              {effect.contacts === 1 ? "contact" : "contacts"}, {effect.leads} {effect.leads === 1 ? "lead" : "leads"}
            </p>
            <p>
              <b>Will use existing:</b> {effect.existingCustomers} {effect.existingCustomers === 1 ? "customer" : "customers"},{" "}
              {effect.existingContacts} {effect.existingContacts === 1 ? "contact" : "contacts"}
            </p>
            {reviewIdx.length > 0 && <p className="is-attention">Resolve or skip {reviewIdx.length} {reviewIdx.length === 1 ? "item" : "items"} above to continue.</p>}
          </div>
        </>
      ) : (
        <section className="bulk-result" aria-live="polite">
          <p className="bulk-summary">
            <b>Added {result.counts.created}</b>
            <span>Already existed {result.counts.matched}</span>
            <span>Skipped {result.counts.skipped + result.counts.needsReview}</span>
            <span className={result.counts.failed ? "is-attention" : ""}>Failed {result.counts.failed}</span>
          </p>
          {result.results.some((r) => r.status === "Failed") && (
            <ul className="bulk-rows">
              {result.results
                .filter((r) => r.status === "Failed")
                .map((r) => (
                  <li key={r.providerId}>
                    <span>
                      <b>{review.items.find((i) => i.prospect.id === r.providerId)?.prospect.name}</b>
                      <small>{r.message}</small>
                    </span>
                  </li>
                ))}
            </ul>
          )}
          <div className="prospect-status-actions">
            <Button className="secondary compact" onClick={() => goTo("customers")}>
              View customers
            </Button>
            {result.counts.leads > 0 && (
              <Button className="secondary compact" onClick={() => goTo("sales-pipeline")}>
                View leads
              </Button>
            )}
            {result.counts.failed > 0 && (
              <Button className="ghost compact" disabled={busy} onClick={() => void submit(true)}>
                Retry failed
              </Button>
            )}
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <DialogActions
        onCancel={onClose}
        primary={
          !result
            ? {
                label: "Add to Enercore",
                onClick: () => void submit(),
                pending: busy,
                disabled: busy || reviewIdx.length > 0 || !included.length,
              }
            : undefined
        }
        pending={busy}
      />
    </Dialog>
  );
}
const BULK_REASONS: Record<string, string> = {
  "Same normalized name": "same company name",
  "Same business domain": "same business domain",
  "Same business email domain": "same email domain",
  "Same Apollo company reference": "already added from Apollo",
  "Matching existing Contact evidence": "same contact email or phone",
  "Same email": "same email",
  "Same phone": "same phone",
};
export function ReportDialog({
  report: r,
  onClose,
}: {
  report: Report;
  onClose: () => void;
}) {
  return (
    <Dialog
      title="Prospecting report"
      className="execution-editor apollo-report"
      onClose={onClose}
    >
      <div id="apollo-print-report">
        <p className="eyebrow">Enercore · Apollo prospecting</p>
        <h2>Prospecting report</h2>
        <p>Generated {new Date(r.generatedAt).toLocaleString()}</p>
        <div className="apollo-stat-grid">
          <p>
            Selected <strong>{r.count}</strong>
          </p>
          <p>
            Company results <strong>{r.companies}</strong>
          </p>
          <p>
            People results <strong>{r.people}</strong>
          </p>
          <p>
            Represented companies <strong>{r.representedCompanies}</strong>
          </p>
          <p>
            Existing CRM matches <strong>{r.existing}</strong>
          </p>
          <p>
            Possible matches <strong>{r.possible}</strong>
          </p>
          <p>
            No checked match <strong>{r.noCheckedMatch}</strong>
          </p>
          <p>
            Enrichment attempted <strong>{r.enriched}</strong>
          </p>
        </div>
        <h3>Search criteria</h3>
        {r.criteria.map((c, i) => (
          <p key={i}>{describeCriteria(c)}</p>
        ))}
        {(
          [
            ["Countries", r.countries],
            ["Roles represented", r.roles],
            ["Industries supplied", r.industries],
          ] as const
        ).map(([label, list]) => (
          <section key={label}>
            <h3>{label}</h3>
            <dl className="apollo-report-tally">
              {list.map(([name, n]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{n}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <h3>Apollo credit usage</h3>
        <p>
          Related operation estimates: {r.estimatedCredits} credits. Observed
          charges: {r.observedCredits} credits. Actual charge unavailable for{" "}
          {r.unknownCreditOperations} operations. These are whole-operation
          costs and are not allocated to individual selected prospects.
        </p>
        {r.phoneObservations.length > 0 && (
          <p>
            Phone-result credit observations:{" "}
            {r.phoneObservations.map((n) => n ?? "unknown").join(", ")}. These
            may overlap initial enrichment responses and are not added to the
            total above.
          </p>
        )}
        <p className="muted small">{r.note}</p>
      </div>
      <DialogActions
        onCancel={onClose}
        primary={{ label: "Print / Save PDF", onClick: () => window.print() }}
      />
    </Dialog>
  );
}
