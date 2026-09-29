"use client";
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
      title="Review enrichment"
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
  return (
    <Dialog
      title="Review bulk CRM import"
      className="execution-editor apollo-dialog"
      onClose={onClose}
    >
      <h2>Review {items.length} prospects</h2>
      <p>{review.note}</p>
      <div className="apollo-stat-grid">
        <p>
          New Customers <strong>{review.counts.newCustomers}</strong>
        </p>
        <p>
          Existing Customers <strong>{review.counts.existingCustomers}</strong>
        </p>
        <p>
          New Contacts <strong>{review.counts.newContacts}</strong>
        </p>
        <p>
          Existing Contacts <strong>{review.counts.existingContacts}</strong>
        </p>
        <p>
          Needs review <strong>{review.counts.needsReview}</strong>
        </p>
      </div>
      <p>
        No existing CRM fields are overwritten. New Customers with the same
        exact Apollo company identity share a Customer when the grouping option
        is checked. Review names before confirming.
      </p>
      <div className="execution-actions">
        <Button
          className="secondary compact"
          disabled={busy || !!result}
          onClick={() =>
            setItems((items) => items.map((i) => ({ ...i, createLead: true })))
          }
        >
          Add Leads to included prospects
        </Button>
        <Button
          className="secondary compact"
          disabled={busy || !!result}
          onClick={() =>
            setItems((items) =>
              items.map((i) => ({
                ...i,
                createLead: false,
                createDeal: false,
              })),
            )
          }
        >
          Customers / Contacts only
        </Button>
      </div>
      {review.items.map((r, i) => (
        <details key={r.prospect.id} className="apollo-import-row">
          <summary>
            {r.prospect.name} ·{" "}
            {items[i].skip
              ? "Skipped"
              : items[i].customerId
                ? "Match existing"
                : "Create after review"}
          </summary>
          <p>{r.match}</p>
          <label className="execution-check">
            <input
              type="checkbox"
              checked={!items[i].skip}
              disabled={busy || !!result}
              onChange={(e) => patch(i, { skip: !e.target.checked })}
            />
            Include this prospect
          </label>
          <Field label="Customer decision">
            <Select
              value={items[i].customerId || "new"}
              disabled={busy || !!result}
              onChange={(e) =>
                patch(i, {
                  customerId:
                    e.target.value === "new" ? undefined : e.target.value,
                  contactId: undefined,
                })
              }
            >
              <option value="new">Create reviewed Customer</option>
              {r.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} — {c.reasons.join(", ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reviewed company name">
            <Input
              value={items[i].companyName}
              maxLength={160}
              disabled={busy || !!result}
              onChange={(e) => patch(i, { companyName: e.target.value })}
            />
          </Field>
          {r.prospect.kind === "person" && (
            <>
              <Field label="Complete Contact name">
                <Input
                  value={items[i].contactName}
                  maxLength={160}
                  disabled={busy || !!result}
                  onChange={(e) => patch(i, { contactName: e.target.value })}
                />
              </Field>
              <Field label="Reviewed business email">
                <Input
                  value={items[i].email}
                  disabled={busy || !!result}
                  onChange={(e) => patch(i, { email: e.target.value })}
                />
              </Field>
              <Field label="Contact decision">
                <Select
                  value={items[i].contactId || "new"}
                  disabled={busy || !!result}
                  onChange={(e) =>
                    patch(i, {
                      contactId:
                        e.target.value === "new" ? undefined : e.target.value,
                    })
                  }
                >
                  <option value="new">Create reviewed Contact</option>
                  {r.customers
                    .find((c) => c.id === items[i].customerId)
                    ?.contacts.filter((c) => c.active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.email}
                      </option>
                    ))}
                </Select>
              </Field>
              <label className="execution-check">
                <input
                  type="checkbox"
                  checked={items[i].createContact}
                  disabled={busy || !!result}
                  onChange={(e) =>
                    patch(i, { createContact: e.target.checked })
                  }
                />
                Create / link Contact
              </label>
            </>
          )}
          <label className="execution-check">
            <input
              type="checkbox"
              checked={!!items[i].groupCompany}
              disabled={busy || !!result}
              onChange={(e) => patch(i, { groupCompany: e.target.checked })}
            />
            Share Customer with this exact Apollo company identity in this
            import
          </label>
          <label className="execution-check">
            <input
              type="checkbox"
              checked={!!items[i].createAnyway}
              disabled={busy || !!result}
              onChange={(e) => patch(i, { createAnyway: e.target.checked })}
            />
            I checked possible matches; create a separate record where none is
            selected
          </label>
          <label className="execution-check">
            <input
              type="checkbox"
              checked={!!items[i].createLead}
              disabled={busy || !!result}
              onChange={(e) =>
                patch(i, {
                  createLead: e.target.checked,
                  createDeal: e.target.checked && items[i].createDeal,
                })
              }
            />
            Create Lead
          </label>
          <label className="execution-check">
            <input
              type="checkbox"
              checked={!!items[i].createDeal}
              disabled={busy || !!result || !items[i].createLead}
              onChange={(e) => patch(i, { createDeal: e.target.checked })}
            />
            Open Deal Room for new Lead
          </label>
        </details>
      ))}
      <p>
        {items.filter((i) => !i.skip).length} included · Up to{" "}
        {items.filter((i) => !i.skip && i.createLead).length} Leads /{" "}
        {items.filter((i) => !i.skip && i.createDeal && i.createLead).length}{" "}
        Deal Rooms
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {result && (
        <section aria-live="polite">
          <h3>Import results</h3>
          <p>
            Created {result.counts.created} · Matched existing{" "}
            {result.counts.matched} · Skipped {result.counts.skipped} · Needs
            review {result.counts.needsReview} · Failed {result.counts.failed}
          </p>
          <p>
            New records: {result.counts.customers} Customers,{" "}
            {result.counts.contacts} Contacts, {result.counts.leads} Leads
          </p>
          <ul>
            {result.results.map((r) => (
              <li key={r.providerId}>
                {
                  review.items.find((i) => i.prospect.id === r.providerId)
                    ?.prospect.name
                }
                : {r.status} — {r.message}
              </li>
            ))}
          </ul>
          {result.counts.failed > 0 && (
            <Button className="secondary compact" disabled={busy} onClick={() => void submit(true)}>
              Retry failed imports only
            </Button>
          )}
        </section>
      )}
      <DialogActions
        onCancel={onClose}
        primary={
          !result
            ? {
                label: "Confirm reviewed import",
                onClick: () => void submit(),
                pending: busy,
                disabled: busy || !items.some((i) => !i.skip),
              }
            : undefined
        }
        pending={busy}
      />
    </Dialog>
  );
}
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
