"use client";
import { useEffect, useState, useId, useRef } from "react";
import type { Actor } from "@/lib/domain";
import { canProspect } from "@/lib/execution/model";
import {
  searchInput,
  type SearchInput,
  type ProspectPage,
  type Prospect,
} from "@/lib/prospecting/model";
import type { importReview, enrichmentReview } from "@/lib/prospecting/store";
import { Button, Dialog, DialogActions, Input, Select } from "../ui/controls";
import { PageTitle } from "../workspace-pages";
import { phase7Call, TextField, Choice, Field } from "./execution-panel";
import { RecordPicker } from "./relationship-picker";
import { openReference } from "@/lib/ai/client";
import { alreadyAdded, prospectState } from "@/lib/prospecting/review-state";
type Page = ProspectPage & { stageId: string; cached: boolean };
type Review = Awaited<ReturnType<typeof importReview>>;
export function ProspectReview({
  review: initial,
  company,
  branch,
  productId: initialProduct,
  onClose,
  onImported,
  onEnrich,
}: {
  review: Review & { stageId: string };
  company: string;
  branch: string;
  productId?: string;
  onClose: () => void;
  onEnrich: (ref: { stageId: string; providerId: string }) => void;
  onImported: (ids: { customerId: string; leadId?: string }) => void;
}) {
  const formId = useId();
  const [review, setReview] = useState(initial),
    // A prospect already added from Apollo starts on its customer.
    [customerId, setCustomer] = useState(
      () => alreadyAdded(initial.customers),
    ),
    [contactId, setContact] = useState(""),
    [productId, setProduct] = useState(initialProduct || ""),
    [createContact, setCreateContact] = useState(true),
    [createLead, setCreateLead] = useState(false),
    // "Create separate company" chosen over the possible matches.
    [separate, setSeparate] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestId] = useState(() => crypto.randomUUID());
  const [enrichment, setEnrichment] = useState<Awaited<
      ReturnType<typeof enrichmentReview>
    > | null>(null),
    [fields, setFields] = useState<string[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<
    Review["customers"][number]["contacts"]
  >([]);
  useEffect(() => {
    setSelectedContacts([]);
    if (!customerId) return;
    const controller = new AbortController();
    fetch(
      `/api/commercial?view=contacts&id=${encodeURIComponent(customerId)}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        return d.contacts;
      })
      .then(setSelectedContacts)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [customerId]);
  const p = review.prospect;
  async function reviewFields() {
    setBusy(true);
    setError("");
    try {
      const r = await phase7Call<Awaited<ReturnType<typeof enrichmentReview>>>(
        "prospecting",
        {
          action: "enrichment-review",
          stageId: review.stageId,
          providerId: p.id,
          targetId: p.kind === "company" ? customerId : contactId,
          kind: p.kind === "company" ? "customer" : "contact",
        },
      );
      setEnrichment(r);
      setFields([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const customer = review.customers.find((c) => c.id === customerId);
  // What this prospect is, in the words a salesperson uses. Matching itself
  // is the server's (authorized, deterministic); this only presents it.
  const exact = review.customers.find((c) => c.id === alreadyAdded(review.customers));
  const state = prospectState(review.customers, customerId, separate);
  const companyName = p.companyName || (p.kind === "company" ? p.name : "");
  const place = [p.country, p.domain].filter(Boolean).join(" · ");
  const choose = (id: string) => {
    setCustomer(id);
    setContact("");
    setEnrichment(null);
    setSeparate(false);
  };
  // Only fields where Apollo offers something different from Enercore.
  const changes = enrichment
    ? Object.entries(enrichment.suggested).filter(([key, value]) => {
        const current = String((enrichment.current as Record<string, unknown>)[key] ?? "").trim();
        return value && String(value).trim() !== current;
      })
    : [];
  return (
    <Dialog className="execution-editor prospect-review" title="Add to Enercore" description={place ? `${p.name} · ${place}` : p.name} onClose={onClose}>
      <section className={`prospect-status is-${state}`} aria-live="polite">
        {state === "ready" && (
          <>
            <p className="prospect-status-title">Ready to add</p>
            <p>New company in Enercore.{separate && " Created separately from the possible matches."}</p>
            {separate && (
              <Button className="ghost compact" onClick={() => setSeparate(false)}>
                Show possible matches again
              </Button>
            )}
          </>
        )}
        {state === "existing" && (
          <>
            <p className="prospect-status-title">{exact?.id === customerId ? "Already in Enercore" : "Adding to an existing customer"}</p>
            <p>
              <b>{customer?.title || "Selected customer"}</b>
            </p>
            <div className="prospect-status-actions">
              <Button
                className="secondary compact"
                onClick={() => {
                  onClose();
                  window.dispatchEvent(new CustomEvent("enercore:open-record", { detail: { kind: "customers", id: customerId } }));
                }}
              >
                Open existing
              </Button>
              <Button className="ghost compact" onClick={() => choose("")}>
                Change
              </Button>
            </div>
          </>
        )}
        {state === "review" && (
          <>
            <p className="prospect-status-title">Needs review</p>
            <p>This company may already be in Enercore.</p>
            <ul className="prospect-matches">
              {review.customers.map((c) => (
                <li key={c.id}>
                  <span>
                    <b>{c.title}</b>
                    <small>{c.reasons.map((r) => REASONS[r] || r).join(" · ")}</small>
                  </span>
                  <Button className="secondary compact" disabled={busy} onClick={() => choose(c.id)}>
                    Use existing
                  </Button>
                </li>
              ))}
            </ul>
            <Button className="ghost compact" disabled={busy} onClick={() => setSeparate(true)}>
              Create separate company
            </Button>
          </>
        )}
      </section>
      <form
        id={formId}
        key={review.stageId}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            const ids = await phase7Call<{
              customerId: string;
              leadId?: string;
            }>("prospecting", {
              action: "import",
              stageId: review.stageId,
              providerId: p.id,
              requestId,
              customerId: customerId || undefined,
              contactId: contactId || undefined,
              companyName: f.get("companyName") || customer?.title || companyName,
              contactName: f.get("contactName") || undefined,
              email: f.get("email") || "",
              phone: f.get("phone") || "",
              createAnyway: separate,
              createLead,
              // One Deal per lead: set up with the lead, as the server
              // does by default; no separate step for the salesperson.
              createDeal: createLead,
              createContact: p.kind === "person" ? createContact : undefined,
              productId: createLead ? productId || undefined : undefined,
            });
            onImported(ids);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="execution-fields">
          {!customerId && <TextField label="Company name" name="companyName" value={companyName} required />}
          {p.kind === "person" && (
            <>
              {customerId && (
                <Field label="Contact">
                  <Select
                    value={contactId || "new"}
                    onChange={(e) => {
                      setContact(e.target.value === "new" ? "" : e.target.value);
                      setEnrichment(null);
                    }}
                  >
                    <option value="new">Add {p.name} as a new contact</option>
                    {selectedContacts
                      .filter((c) => c.active)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {[c.name, c.email].filter(Boolean).join(" · ")}
                        </option>
                      ))}
                  </Select>
                </Field>
              )}
              {!contactId && (
                <>
                  <TextField label="Contact name" name="contactName" value={p.nameComplete ? p.name : ""} required={createContact} />
                  {p.email && <TextField label="Email" name="email" value={p.email} />}
                  {p.phone && <TextField label="Phone" name="phone" value={p.phone} />}
                </>
              )}
            </>
          )}
        </div>
        {p.kind === "person" && !contactId && (
          <label className="execution-check">
            <input type="checkbox" checked={createContact} onChange={(e) => setCreateContact(e.target.checked)} />
            <span>Add {p.name} as a contact</span>
          </label>
        )}
        <label className="execution-check">
          <input type="checkbox" checked={createLead} onChange={(e) => setCreateLead(e.target.checked)} />
          <span>Also create a lead</span>
        </label>
        {createLead && (
          <RecordPicker kind="products" company={company} branch={branch} label="Product needed (optional)" onSelect={(id) => setProduct(id)} />
        )}
        <details className="form-more">
          <summary>
            Contact details from Apollo <span className="muted">(uses Apollo credits)</span>
          </summary>
          <p className="exec-caption">Nothing changes in Enercore until you choose which details to use.</p>
          <div className="prospect-status-actions">
            <Button className="secondary compact" disabled={busy} onClick={() => onEnrich({ stageId: review.stageId, providerId: p.id })}>
              Find contact details
            </Button>
            {(p.kind === "company" ? customerId : contactId) && (
              <Button className="ghost compact" disabled={busy} onClick={() => void reviewFields()}>
                Compare with Enercore
              </Button>
            )}
          </div>
          {state === "ready" && !separate && (
            <RecordPicker kind="customers" company={company} branch={branch} label="Or add to another existing customer" onSelect={(id) => choose(id)} />
          )}
          {p.description && <p className="exec-caption">{p.description}</p>}
        </details>
        {enrichment && (
          <section className="prospect-changes" aria-label="Details that differ">
            {!changes.length ? (
              <p className="exec-caption">Apollo has nothing different from what Enercore already holds.</p>
            ) : (
              <>
                <p className="prospect-status-title">Different in Apollo</p>
                {changes.map(([key, value]) => (
                  <label className="execution-check prospect-change" key={key}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={fields.includes(key)}
                      onChange={(e) => setFields((f) => (e.target.checked ? [...f, key] : f.filter((k) => k !== key)))}
                    />
                    <span>
                      <b>{FIELD_LABELS[key] || key}</b>
                      <small>
                        Enercore: {String((enrichment.current as Record<string, unknown>)[key] || "empty")} · Apollo: {String(value)}
                      </small>
                    </span>
                  </label>
                ))}
                <Button
                  className="secondary compact"
                  disabled={busy || !fields.length}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await phase7Call("prospecting", {
                        action: "apply-enrichment",
                        stageId: review.stageId,
                        providerId: p.id,
                        targetId: enrichment.targetId,
                        kind: enrichment.kind,
                        version: enrichment.version,
                        fields,
                      });
                      setEnrichment(null);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Use Apollo for selected
                </Button>
              </>
            )}
          </section>
        )}
        <p className="prospect-source">Source: Apollo</p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <DialogActions
          primary={{
            label: customerId ? "Add to existing customer" : "Add to Enercore",
            type: "submit",
            form: formId,
            pending: busy,
            disabled: state === "review",
          }}
          pending={busy}
          onCancel={onClose}
        />
      </form>
    </Dialog>
  );
}

const REASONS: Record<string, string> = {
  "Same normalized name": "Same company name",
  "Same business domain": "Same business domain",
  "Same business email domain": "Same email domain",
  "Same Apollo company reference": "Already added from Apollo",
  "Matching existing Contact evidence": "Same contact email or phone",
  "Same email": "Same email",
  "Same phone": "Same phone",
};
const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  phone: "Phone",
  jobTitle: "Job title",
  website: "Website",
  country: "Country",
  city: "City",
  industry: "Industry",
  linkedin: "LinkedIn",
};
