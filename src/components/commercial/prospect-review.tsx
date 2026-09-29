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
    [customerId, setCustomer] = useState(""),
    [contactId, setContact] = useState(""),
    [productId, setProduct] = useState(initialProduct || ""),
    [createContact, setCreateContact] = useState(true),
    [createLead, setCreateLead] = useState(false),
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
  return (
    <Dialog
      className="execution-editor"
      title="Review Apollo prospect"
      onClose={onClose}
    >
      <h3>Review {p.name}</h3>
      <p className="muted">
        Apollo · {p.domain} · {p.country}. {review.coverage}
      </p>
      {p.description && (
        <p>
          <strong>Apollo-supplied description</strong>
          <br />
          {p.description}
        </p>
      )}
      <h3>Possible existing relationships</h3>
      {!review.customers.length && (
        <p>
          No likely match in the checked records. Confirm identity before
          creating a customer.
        </p>
      )}
      {review.customers.map((c) => (
        <article className="execution-card" key={c.id}>
          <h4>{c.title}</h4>
          <p>{c.reasons.join(" · ")}</p>
          <Button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setCustomer(c.id);
              setContact("");
              setEnrichment(null);
            }}
          >
            Use {c.title}
          </Button>
        </article>
      ))}
      <RecordPicker
        kind="customers"
        company={company}
        branch={branch}
        label="Find another existing customer"
        onSelect={(id) => {
          setCustomer(id);
          setContact("");
          setEnrichment(null);
        }}
      />
      {customerId && (
        <p>
          Existing customer selected {customer?.title || customerId}.{" "}
          <Button
            className="secondary compact"
            onClick={() => {
              setCustomer("");
              setContact("");
              setEnrichment(null);
            }}
          >
            Choose a new customer
          </Button>
        </p>
      )}
      {p.kind === "person" && customerId && (
        <Field label="Existing Contact">
          <Select
            value={contactId || "new"}
            onChange={(e) => {
              setContact(e.target.value === "new" ? "" : e.target.value);
              setEnrichment(null);
            }}
          >
            <option value="new">Create a new Contact after review</option>
            {selectedContacts
              .filter((c) => c.active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.email}
                </option>
              ))}
          </Select>
        </Field>
      )}
      <details>
        <summary>Optional enrichment</summary>
        <p>
          Enrichment is an explicit paid action with a separate credit
          confirmation. Existing CRM fields remain unchanged until you select
          fields below.
        </p>
        <Button
          className="secondary compact"
          disabled={busy}
          onClick={() =>
            onEnrich({ stageId: review.stageId, providerId: p.id })
          }
        >
          Review enrichment cost
        </Button>
        {(p.kind === "company" ? customerId : contactId) && (
          <Button
            className="secondary"
            disabled={busy}
            onClick={() => void reviewFields()}
          >
            Review enriched fields for existing record
          </Button>
        )}
      </details>
      {enrichment && (
        <section>
          <h3>Choose fields to apply</h3>
          {Object.entries(enrichment.suggested).map(([key, value]) => (
            <label className="execution-check" key={key}>
              <input
                type="checkbox"
                disabled={!value || busy}
                checked={fields.includes(key)}
                onChange={(e) =>
                  setFields((f) =>
                    e.target.checked ? [...f, key] : f.filter((k) => k !== key),
                  )
                }
              />
              <span>
                {key}:{" "}
                {String(
                  (enrichment.current as Record<string, unknown>)[key] ||
                    "Empty",
                )}{" "}
                → {value || "Not available"}
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
            Apply selected fields
          </Button>
        </section>
      )}
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
              companyName: f.get("companyName"),
              contactName: f.get("contactName") || undefined,
              email: f.get("email") || "",
              phone: f.get("phone") || "",
              createAnyway: f.get("createAnyway") === "on",
              createLead: f.get("createLead") === "on",
              createDeal: f.get("createDeal") === "on",
              createContact: f.get("createContact") !== null,
              productId: productId || undefined,
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
          <TextField
            label="Reviewed company name"
            name="companyName"
            value={
              customer?.title ||
              p.companyName ||
              (p.kind === "company" ? p.name : "")
            }
            required
          />
          {p.kind === "person" && (
            <>
              <TextField
                label="Verified full contact name"
                name="contactName"
                value={p.nameComplete ? p.name : ""}
                required={createContact}
              />
              <TextField
                label="Reviewed business email"
                name="email"
                value={p.email}
              />
              <TextField
                label="Reviewed business phone"
                name="phone"
                value={p.phone}
              />
            </>
          )}
        </div>
        <label className="execution-check">
          <input type="checkbox" name="createAnyway" />
          <span>
            I reviewed possible matches; create a separate record where I have
            not selected an existing one.
          </span>
        </label>
        <label className="execution-check">
          <input
            type="checkbox"
            name="createLead"
            checked={createLead}
            onChange={(e) => setCreateLead(e.target.checked)}
          />
          <span>Also create a Lead</span>
        </label>
        <label className="execution-check">
          <input type="checkbox" name="createDeal" disabled={!createLead} />
          <span>Open a Deal Room for the new Lead (requires Create Lead)</span>
        </label>
        {p.kind === "person" && (
          <label className="execution-check">
            <input
              type="checkbox"
              name="createContact"
              checked={createContact}
              onChange={(e) => setCreateContact(e.target.checked)}
            />
            <span>Create or link this Contact</span>
          </label>
        )}
        <RecordPicker
          kind="products"
          company={company}
          branch={branch}
          label="Optional Lead product"
          onSelect={(id) => setProduct(id)}
        />
        {productId && <p>Product selected for the new Lead.</p>}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <DialogActions
          primary={{
            label: "Import prospect",
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
