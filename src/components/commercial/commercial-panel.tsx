"use client";
import ExecutionPanel, { ExecutionHistory } from "./execution-panel";
import Prospecting from "./prospecting";
import { canProspect } from "@/lib/execution/model";
import { useEffect, useId, useState } from "react";
import type { Actor, RecordItem } from "@/lib/domain";
import { canWrite, money } from "@/lib/domain";
import type { CommercialView } from "@/lib/commercial/store";
import {
  contactRoles,
  duplicateReasons,
  type Contact,
  type Capability,
} from "@/lib/commercial/model";
import {
  Button,
  Field,
  Input,
  Select,
  Textarea,
  Dialog,
  DialogActions,
} from "../ui/controls";
import {
  CustomerSelection,
  RecordPicker,
  commercialCall,
} from "./relationship-picker";
import { AiPanel } from "../ai/ai-answer";
import { openReference } from "@/lib/ai/client";
const open = (r: RecordItem) =>
  openReference({
    id: "",
    label: r.title,
    target: { type: "record", kind: r.kind, id: r.id },
  });
export default function CommercialPanel({
  record,
  actor,
  onChanged,
  onQuote,
  onLog,
}: {
  record: RecordItem;
  actor: Actor;
  onChanged: () => void;
  onQuote: () => void;
  onLog: () => void;
}) {
  const [view, setView] = useState<CommercialView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [room, setRoom] = useState(false);
  const [prospecting, setProspecting] = useState(false);
  const [editor, setEditor] = useState<
    "contact" | "capability" | "links" | null
  >(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [cap, setCap] = useState<Capability | null>(null);
  const [busy, setBusy] = useState(false);
  const writable = canWrite(actor, record);
  const refresh = () => {
    setRevision((n) => n + 1);
    onChanged();
  };
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/commercial?id=${encodeURIComponent(record.id)}`, {
      cache: "no-store",
      signal: c.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        return d;
      })
      .then((d) => {
        setView(d);
        if (d.deal) setRoom(true);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [record.id, record.updatedAt, revision]);
  async function deal() {
    setBusy(true);
    setError("");
    try {
      await commercialCall({ action: "deal", leadId: record.id });
      setRoom(true);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const title =
    record.kind === "leads"
      ? room
        ? "Deal Room"
        : "Commercial relationships"
      : record.kind === "products"
        ? "Product activity within Enercore"
        : record.kind === "suppliers"
          ? "Supplier 360"
          : "Customer 360";
  return (
    <section className="commercial-panel" aria-label={title} aria-busy={loading}>
      <header className="commercial-head">
        <h3>{title}</h3>
        {record.kind === "leads" && !room && (
          <Button
            className="secondary"
            disabled={busy || (!writable && !view?.deal)}
            onClick={() => void deal()}
          >
            Open Deal Room
          </Button>
        )}
        {writable && ["leads", "quotations"].includes(record.kind) && (
          <Button
            className="secondary compact"
            onClick={() => setEditor("links")}
          >
            Review relationships
          </Button>
        )}
      </header>
      {loading && !view && (
        <div
          className="commercial-skeleton"
          role="status"
          aria-label="Loading commercial relationships"
        >
          <span />
          <span />
          <span />
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {view && (
        <>
          {record.kind === "leads" && (
            <>
              <div className="detail-grid">
                <div>
                  <span>Customer</span>
                  <strong>
                    {view.customer?.title || "Not linked to a customer"}
                  </strong>
                </div>
                <div>
                  <span>Requirement</span>
                  <strong>
                    {record.product || "Add a product and quantity using Edit record"}{" "}
                    {record.quantity ? `${record.quantity.toLocaleString()} ${record.unit}` : ""}
                  </strong>
                </div>
                <div>
                  <span>Stage · Owner</span>
                  <strong>
                    {record.status} · {record.owner}
                  </strong>
                </div>
                <div>
                  <span>Next action</span>
                  <strong>{record.due || "Set a follow-up"}</strong>
                </div>
              </div>
              {room && (
                <div className="commercial-actions">
                  <Button className="secondary" onClick={onLog}>
                    Log activity / set follow-up
                  </Button>
                  <Button className="secondary" onClick={onQuote}>
                    Prepare quotation
                  </Button>
                  <p className="muted small">
                    Schedule meetings using this Lead’s Meetings section below.
                  </p>
                </div>
              )}
            </>
          )}
          {record.kind !== "products" && <section>
            <header className="commercial-head">
              <h4>Contacts</h4>
              {writable && ["customers", "suppliers"].includes(record.kind) && (
                <Button
                  className="secondary compact"
                  onClick={() => {
                    setContact(null);
                    setEditor("contact");
                  }}
                >
                  Add contact
                </Button>
              )}
            </header>
            {!view.contacts.length ? (
              <p className="muted">
                {record.kind === "leads" ? "No contacts yet. Review relationships to select a customer and contact." : "No contacts yet. Add the people you work with at this company."}
              </p>
            ) : (
              <ul className="commercial-list">
                {view.contacts.map((c) => (
                  <li key={c.id}>
                    <div>
                      <strong>{c.name}</strong>
                      <p>
                        {c.role || "Contact"}
                        {record.contactId === c.id ? " · Selected for this lead" : ""}
                        {!c.active ? " · Inactive" : ""}
                        {record.primaryContactId === c.id ? " · Primary" : ""}
                      </p>
                      <p className="muted small">
                        {[c.email, c.phone].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {writable &&
                      ["customers", "suppliers"].includes(record.kind) && (
                        <div className="commercial-actions">
                          <Button
                            className="secondary compact"
                            onClick={() => {
                              setContact(c);
                              setEditor("contact");
                            }}
                          >
                            Edit contact
                          </Button>
                          {c.active && record.primaryContactId !== c.id && (
                            <Button
                              className="secondary compact"
                              onClick={() => {
                                void commercialCall({
                                  action: "links",
                                  id: record.id,
                                  expectedUpdatedAt: record.updatedAt,
                                  primaryContactId: c.id,
                                })
                                  .then(refresh)
                                  .catch((e) => setError(e.message));
                              }}
                            >
                              Make primary
                            </Button>
                          )}
                        </div>
                      )}
                  </li>
                ))}
              </ul>
            )}
            {view.contacts.length > 0 &&
              ["customers", "suppliers"].includes(record.kind) && (
                <a
                  href={`/api/commercial?view=export-contacts&id=${encodeURIComponent(record.id)}`}
                >
                  Export contacts
                </a>
              )}
          </section>}
          {(["suppliers", "products"].includes(record.kind) || room) && (
            <section>
              <header className="commercial-head">
                <h4>
                  {record.kind === "leads"
                    ? "Potential suppliers"
                    : "Recorded supplier capabilities"}
                </h4>
                {writable && record.kind === "suppliers" && (
                  <Button
                    className="secondary compact"
                    onClick={() => {
                      setCap(null);
                      setEditor("capability");
                    }}
                  >
                    Add capability
                  </Button>
                )}
              </header>
              <p className="muted small">
                Recorded capability does not establish current stock,
                availability, price or an offer.
              </p>
              {!view.capabilities.length ? (
                <p className="muted">
                  No{" "}
                  {record.kind === "leads"
                    ? "candidate suppliers"
                    : "supplier capabilities"}{" "}
                  yet. Add recorded products to the supplier’s capabilities.
                </p>
              ) : (
                <ul className="commercial-list">
                  {view.capabilities.map((c) => (
                    <li key={c.id}>
                      <div>
                        <strong>
                          {c.supplier} · {c.product}
                        </strong>
                        <p>
                          {[
                            c.grade,
                            c.originCountry,
                            c.packaging,
                            c.leadTime,
                            c.active ? "Active" : "Inactive",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {c.moq !== null && (
                          <p>
                            MOQ {c.moq} {c.moqUnit}
                          </p>
                        )}
                        {c.notes && <p className="muted">{c.notes}</p>}
                      </div>
                      {writable && record.kind === "suppliers" && (
                        <Button
                          className="secondary compact"
                          onClick={() => {
                            setCap(c);
                            setEditor("capability");
                          }}
                        >
                          Edit capability
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          <section>
            <h4>
              {record.kind === "products"
                ? "Enercore commercial activity"
                : "Linked commercial records"}
            </h4>
            {!view.linked.length ? (
              <p className="muted">{record.kind === "leads" ? "No quotation yet. Use Prepare quotation to start one." : "No linked commercial records yet. Link this company or product when recording an enquiry."}</p>
            ) : (
              <ul className="commercial-list">
                {view.linked.map((r) => (
                  <li key={r.id}>
                    <Button className="record-link" onClick={() => open(r)}>
                      {r.title} · {r.kind}
                    </Button>
                    <span>
                      {r.status}
                      {r.amount ? ` · ${money(r.amount, r.currency)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {!!view.deals.length && record.kind !== "leads" && (
            <section>
              <h4>Deals</h4>
              <ul className="commercial-list">
                {view.deals.map((d) => (
                  <li key={d.id}>
                    <Button
                      className="record-link"
                      onClick={() =>
                        openReference({
                          id: "",
                          label: "Deal",
                          target: {
                            type: "record",
                            kind: "leads",
                            id: d.leadId,
                          },
                        })
                      }
                    >
                      Open Deal Room · {d.id.slice(-8)}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h4>Meetings</h4>
            {view.meetings.length ? (
              <ul className="commercial-list">
                {view.meetings.map((m) => (
                  <li key={m.id}>
                    <Button
                      className="record-link"
                      onClick={() =>
                        openReference({
                          id: "",
                          label: m.title,
                          target: { type: "meeting", id: m.id },
                        })
                      }
                    >
                      {m.title}
                    </Button>
                    <span>{m.status}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No linked meetings yet. Use Schedule meeting below to arrange one.</p>
            )}
          </section>
          {record.kind === "customers" && (
            <details>
              <summary>Possible name matches · review separately</summary>
              <p className="muted">
                Name matches are suggestions, not confirmed history.
              </p>
              {view.legacy.map((r) => (
                <div key={r.id}>
                  <Button className="record-link" onClick={() => open(r)}>
                    {r.title} · {r.kind}
                  </Button>
                  {canWrite(actor, r) &&
                    ["leads", "quotations"].includes(r.kind) && (
                      <Button
                        className="secondary compact"
                        onClick={() =>
                          void commercialCall({
                            action: "links",
                            id: r.id,
                            expectedUpdatedAt: r.updatedAt,
                            customerId: record.id,
                          })
                            .then(refresh)
                            .catch((e) => setError(e.message))
                        }
                      >
                        Link to this customer
                      </Button>
                    )}
                </div>
              ))}
              {!view.legacy.length && <p>No unlinked records with a matching name.</p>}
            </details>
          )}
          <p className="muted small">Showing up to 200 records you can access. Possible name matches are shown separately from confirmed links.</p>
          {["products", "leads"].includes(record.kind) && canProspect(actor) && <Button className="secondary" onClick={() => setProspecting(true)}>Find prospects for this product</Button>}
          {["products","suppliers"].includes(record.kind) && <ExecutionHistory recordId={record.id} />}
          {room && view.deal && <ExecutionPanel dealId={view.deal.id} onChanged={onChanged} />}
          {room && view.deal && (
            <AiPanel
              feature="deal"
              id={view.deal.id}
              label="Brief this deal"
              loadingLabel="Preparing deal brief"
            />
          )}
        </>
      )}
      {prospecting && <Dialog title="Product prospecting" className="execution-editor" onClose={() => setProspecting(false)}><Prospecting actor={actor} initialCompany={record.company} initialBranch={record.branch} productId={record.kind === "products" ? record.id : record.productId || undefined} keywords={record.kind === "products" ? record.title : record.product} /></Dialog>}
      {editor === "links" && (
        <LinkEditor
          record={record}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
          }}
        />
      )}
      {editor === "contact" && (
        <ContactEditor
          record={record}
          contact={contact}
          people={view?.contacts || []}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
          }}
        />
      )}
      {editor === "capability" && (
        <CapabilityEditor
          record={record}
          capability={cap}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}
function LinkEditor({
  record,
  onClose,
  onSaved,
}: {
  record: RecordItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [customerId, setCustomerId] = useState(record.customerId || null);
  const [contactId, setContactId] = useState(record.contactId || null);
  const [productId, setProductId] = useState(record.productId || null);
  const [customerName, setCustomerName] = useState(record.customerId ? record.title : "");
  const [productName, setProductName] = useState(record.product || "");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const changed = !!record.customerId && customerId !== record.customerId;
  return (
    <Dialog className="commercial-editor" title="Review relationships" onClose={onClose}>
      <h2>Review relationships</h2>
      {["leads", "quotations"].includes(record.kind) ? (
        <>
          <CustomerSelection
            company={record.company}
            branch={record.branch}
            customerId={customerId}
            customerName={customerName}
            contactId={contactId}
            onChange={(c, p, title) => {
              if (title !== undefined) setCustomerName(title);
              setCustomerId(c);
              setContactId(p);
              setConfirm(false);
            }}
          />
          <RecordPicker
            kind="products"
            company={record.company}
            branch={record.branch}
            label="Link product"
            onSelect={(id, title) => { setProductId(id); setProductName(title); }}
          />
          {productId && <p>Selected product: <strong>{productName}</strong></p>}
        </>
      ) : (
        <p>Manage contacts and choose a primary contact in the workspace.</p>
      )}
      {changed && (
        <label>
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
          />{" "}
          Confirm changing customer and clearing the old contact
        </label>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <DialogActions
        cancel="Leave for later"
        onCancel={onClose}
        pending={busy}
        primary={{
          label: "Save links",
          pending: busy,
          disabled: changed && !confirm,
          onClick: async () => {
            setBusy(true);
            setError("");
            try {
              await commercialCall({
                action: "links", id: record.id,
                expectedUpdatedAt: record.updatedAt,
                customerId, contactId, productId,
                confirmReassignment: confirm,
              });
              onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally { setBusy(false); }
          },
        }}
      />
    </Dialog>
  );
}
function ContactEditor({
  record,
  contact,
  people,
  onClose,
  onSaved,
}: {
  record: RecordItem;
  contact: Contact | null;
  people: Contact[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const formId = useId();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [email, setEmail] = useState(contact?.email || "");
  const [phone, setPhone] = useState(contact?.phone || "");
  const duplicates = people.filter(
    (c) =>
      c.id !== contact?.id &&
      duplicateReasons({ email, phone }, c, false).length,
  );
  return (
    <Dialog className="commercial-editor" title={contact ? "Edit contact" : "Add contact"} onClose={onClose}>
      <h2>{contact ? "Edit contact" : "Add contact"}</h2>
      <form
        id={formId}
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await commercialCall({
              action: "contact",
              parentId: record.id,
              id: contact?.id,
              version: contact?.version,
              requestId,
              details: {
                name: d.get("name"),
                jobTitle: d.get("jobTitle"),
                role: d.get("role"),
                email,
                phone,
                whatsapp: d.get("whatsapp"),
                country: d.get("country"),
                notes: d.get("notes"),
                active: d.get("active") === "on",
              },
            });
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Field>
            Name
            <Input
              name="name"
              defaultValue={contact?.name}
              required
              maxLength={160}
            />
          </Field>
          <Field>
            Job title
            <Input name="jobTitle" defaultValue={contact?.jobTitle} />
          </Field>
          <Field>
            Role
            <Select name="role" defaultValue={contact?.role || "Other"}>
              {contactRoles.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field>
            Email
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field>
            Phone
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field>
            WhatsApp number (reference only)
            <Input name="whatsapp" defaultValue={contact?.whatsapp} />
          </Field>
          <Field>
            Country
            <Input name="country" defaultValue={contact?.country} />
          </Field>
          <Field>
            Notes
            <Textarea name="notes" defaultValue={contact?.notes} />
          </Field>
        </div>
        <label>
          <input
            type="checkbox"
            name="active"
            defaultChecked={contact?.active ?? true}
          />{" "}
          Active
        </label>
        {duplicates.length > 0 && (
          <p role="status">
            Possible duplicate contact:{" "}
            {duplicates.map((c) => c.name).join(", ")}. Saving keeps these as
            separate people.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <DialogActions
          onCancel={onClose}
          pending={busy}
          primary={{
            label: "Save contact",
            type: "submit",
            form: formId,
            pending: busy,
          }}
        />
      </form>
    </Dialog>
  );
}
function CapabilityEditor({
  record,
  capability: c,
  onClose,
  onSaved,
}: {
  record: RecordItem;
  capability: Capability | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const formId = useId();
  const [productId, setProductId] = useState(c?.productId || "");
  const [product, setProduct] = useState(c?.product || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog className="commercial-editor" title="Supplier capability" onClose={onClose}>
      <h2>Supplier capability</h2>
      <p>
        Record reviewed knowledge. This is not an offer or availability
        confirmation.
      </p>
      <form
        id={formId}
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await commercialCall({
              action: "capability",
              supplierId: record.id,
              productId,
              id: c?.id,
              version: c?.version,
              details: {
                ...Object.fromEntries(
                  [
                    "grade",
                    "originCountry",
                    "moqUnit",
                    "packaging",
                    "leadTime",
                    "notes",
                  ].map((k) => [k, String(d.get(k) || "")]),
                ),
                moq: d.get("moq") ? Number(d.get("moq")) : null,
                active: d.get("active") === "on",
              },
            });
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {!c && (
          <RecordPicker
            kind="products"
            company={record.company}
            branch={record.branch}
            label="Search product"
            onSelect={(id, title) => {
              setProductId(id);
              setProduct(title);
            }}
          />
        )}
        <p>{product || "Select a product"}</p>
        <div className="form-grid">
          {(
            [
              ["grade", "Grade / specification"],
              ["originCountry", "Origin country"],
              ["moq", "MOQ"],
              ["moqUnit", "MOQ unit"],
              ["packaging", "Packaging"],
              ["leadTime", "Lead time"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key}>
              {label}
              <Input
                name={key}
                type={key === "moq" ? "number" : "text"}
                min={key === "moq" ? 0 : undefined}
                defaultValue={c?.[key] ?? ""}
              />
            </Field>
          ))}
          <Field>
            Notes
            <Textarea name="notes" defaultValue={c?.notes} />
          </Field>
        </div>
        <label>
          <input
            type="checkbox"
            name="active"
            defaultChecked={c?.active ?? true}
          />{" "}
          Active
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <DialogActions
          onCancel={onClose}
          pending={busy}
          primary={{
            label: "Save capability",
            type: "submit",
            form: formId,
            pending: busy,
            disabled: !productId,
          }}
        />
      </form>
    </Dialog>
  );
}
