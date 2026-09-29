"use client";
import Prospecting from "./prospecting";
import { canProspect } from "@/lib/execution/model";
import { useCallback, useEffect, useId, useState } from "react";
import type { Actor, RecordItem } from "@/lib/domain";
import { canWrite, money } from "@/lib/domain";
import { recordProfiles } from "@/lib/record-profiles";
import { StatusBadge } from "../ui/status-badge";
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
import { openReference } from "@/lib/ai/client";
import { EmptyState, Section } from "../ui/layout";

/* ---------------------------------------------------------------------------
   Customer, Supplier, Product and Lead relationships — data and sections.

   `useCommercial` loads the record's commercial view once and owns the
   relationship editors (contact, capability, links), which open as drawers
   beside the record rather than as a dialog over it. The sections are
   placed into the record workspace's tabs by commercial-workspace.tsx.
   ------------------------------------------------------------------------ */

export const openRecord = (r: { id: string; kind: string; title: string }) =>
  openReference({
    id: "",
    label: r.title,
    target: { type: "record", kind: r.kind, id: r.id },
  });
const noun = (kind: string) =>
  recordProfiles[kind as keyof typeof recordProfiles]?.noun ?? kind;

export type Commercial = ReturnType<typeof useCommercial>;

export function useCommercial(record: RecordItem, actor: Actor, onChanged: () => void) {
  const [view, setView] = useState<CommercialView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<"contact" | "capability" | "links" | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [cap, setCap] = useState<Capability | null>(null);
  const [prospecting, setProspecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const writable = canWrite(actor, record);
  const refresh = useCallback(() => {
    setRevision((n) => n + 1);
    onChanged();
  }, [onChanged]);
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
      .then(setView)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [record.id, record.updatedAt, revision]);
  async function openDeal() {
    setBusy(true);
    setError("");
    try {
      await commercialCall({ action: "deal", leadId: record.id });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const makePrimary = (c: Contact) =>
    void commercialCall({
      action: "links",
      id: record.id,
      expectedUpdatedAt: record.updatedAt,
      primaryContactId: c.id,
    })
      .then(refresh)
      .catch((e) => setError(e.message));
  const linkToCustomer = (r: RecordItem) =>
    void commercialCall({
      action: "links",
      id: r.id,
      expectedUpdatedAt: r.updatedAt,
      customerId: record.id,
    })
      .then(refresh)
      .catch((e) => setError(e.message));
  const editContact = (c: Contact | null) => {
    setContact(c);
    setEditor("contact");
  };
  const editCapability = (c: Capability | null) => {
    setCap(c);
    setEditor("capability");
  };
  const done = () => {
    setEditor(null);
    refresh();
  };
  const editorsNode = (
    <>
      {prospecting && (
        <Dialog variant="drawer" title="Product prospecting" className="execution-editor prospecting-drawer" onClose={() => setProspecting(false)}>
          <Prospecting
            actor={actor}
            initialCompany={record.company}
            initialBranch={record.branch}
            productId={record.kind === "products" ? record.id : record.productId || undefined}
            keywords={record.kind === "products" ? record.title : record.product}
          />
        </Dialog>
      )}
      {editor === "links" && <LinkEditor record={record} onClose={() => setEditor(null)} onSaved={done} />}
      {editor === "contact" && (
        <ContactEditor record={record} contact={contact} people={view?.contacts || []} onClose={() => setEditor(null)} onSaved={done} />
      )}
      {editor === "capability" && <CapabilityEditor record={record} capability={cap} onClose={() => setEditor(null)} onSaved={done} />}
    </>
  );
  return {
    record,
    actor,
    view,
    error,
    loading,
    busy,
    writable,
    refresh,
    openDeal,
    makePrimary,
    linkToCustomer,
    editContact,
    editCapability,
    reviewLinks: () => setEditor("links"),
    canFindProspects: ["products", "leads"].includes(record.kind) && canProspect(actor),
    findProspects: () => setProspecting(true),
    editorsNode,
  };
}

const companyKinds = ["customers", "suppliers"];

/** Everyone the company works with, with the primary and the Lead's contact marked. */
export function ContactsSection({ c, title = "Contacts", limit }: { c: Commercial; title?: string; limit?: number }) {
  const { view, record, writable } = c;
  if (!view) return null;
  const company = companyKinds.includes(record.kind);
  const contacts = [...view.contacts].sort(
    (a, b) => Number(b.id === record.primaryContactId) - Number(a.id === record.primaryContactId),
  );
  const shown = limit ? contacts.slice(0, limit) : contacts;
  return (
    <Section
      title={title}
      actions={
        writable && company ? (
          <Button className="secondary compact" onClick={() => c.editContact(null)}>
            Add contact
          </Button>
        ) : undefined
      }
    >
      {!contacts.length ? (
        <EmptyState
          title="No contacts yet."
          detail={
            record.kind === "leads"
              ? "Review relationships to select a customer and contact."
              : "Add the people you work with at this company."
          }
        />
      ) : (
        <ul className="exec-rows contact-rows">
          {shown.map((p) => (
            <li className="exec-row" key={p.id}>
              <div className="exec-row-main">
                <h4>
                  {p.name}
                  {record.primaryContactId === p.id && <span className="exec-tag is-accent">Primary</span>}
                  {record.contactId === p.id && <span className="exec-tag is-accent">Selected for this lead</span>}
                  {!p.active && <span className="exec-tag">Inactive</span>}
                </h4>
                <p className="exec-meta">{[p.jobTitle, p.role || "Contact"].filter(Boolean).join(" · ")}</p>
                {(p.email || p.phone) && (
                  <p className="exec-meta exec-contact-lines">
                    {p.email && <a href={`mailto:${p.email}`}>{p.email}</a>}
                    {p.phone && <a href={`tel:${p.phone.replace(/\s+/g, "")}`}>{p.phone}</a>}
                  </p>
                )}
              </div>
              {writable && company && (
                <div className="exec-row-actions">
                  <Button className="ghost compact" onClick={() => c.editContact(p)}>
                    Edit contact
                  </Button>
                  {p.active && record.primaryContactId !== p.id && (
                    <Button className="ghost compact" onClick={() => c.makePrimary(p)}>
                      Make primary
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {contacts.length > 0 && company && !limit && (
        <a className="commercial-link" href={`/api/commercial?view=export-contacts&id=${encodeURIComponent(record.id)}`}>
          Export contacts
        </a>
      )}
    </Section>
  );
}

/** The one person to call, for a company summary. */
export function PrimaryContact({ c }: { c: Commercial }) {
  const { view, record } = c;
  if (!view) return null;
  const p =
    view.contacts.find((x) => x.id === record.primaryContactId) ||
    view.contacts.find((x) => x.id === record.contactId) ||
    view.contacts.find((x) => x.active);
  if (!p) return <p className="exec-empty">No contact yet.</p>;
  return (
    <div className="primary-contact">
      <p className="primary-contact-name">
        {p.name}
        {record.primaryContactId === p.id ? <span className="exec-tag is-accent">Primary</span> : null}
      </p>
      <p className="exec-meta">{[p.jobTitle, p.role].filter(Boolean).join(" · ")}</p>
      <p className="exec-meta exec-contact-lines">
        {p.email && <a href={`mailto:${p.email}`}>{p.email}</a>}
        {p.phone && <a href={`tel:${p.phone.replace(/\s+/g, "")}`}>{p.phone}</a>}
      </p>
    </div>
  );
}

/** What a supplier can potentially supply — never an offer. */
export function CapabilitiesSection({ c, collapsed = false }: { c: Commercial; collapsed?: boolean }) {
  const { view, record, writable } = c;
  if (!view) return null;
  const rows = (
    <ul className="exec-rows">
      {view.capabilities.map((x) => (
        <li className="exec-row" key={x.id}>
          <div className="exec-row-main">
            <h4>
              {record.kind === "suppliers" ? x.product : record.kind === "products" ? x.supplier : `${x.supplier} · ${x.product}`}
              {!x.active && <span className="exec-tag">Inactive</span>}
            </h4>
            <p className="exec-meta">
              {[x.grade, x.originCountry, x.packaging, x.leadTime, x.moq !== null ? `MOQ ${x.moq} ${x.moqUnit}`.trim() : ""]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {x.notes && <p className="exec-note">{x.notes}</p>}
          </div>
          {writable && record.kind === "suppliers" && (
            <div className="exec-row-actions">
              <Button className="ghost compact" onClick={() => c.editCapability(x)}>
                Edit capability
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
  if (collapsed)
    return view.capabilities.length ? (
      <details className="exec-disclosure">
        <summary>Recorded supplier capabilities ({view.capabilities.length})</summary>
        <p className="exec-caption">Recorded capability does not establish current stock, availability, price or an offer.</p>
        {rows}
      </details>
    ) : null;
  return (
    <Section
      title="Capabilities"
      description="What a supplier can potentially supply. A capability is not stock, availability, a price or an offer."
      actions={
        writable && record.kind === "suppliers" ? (
          <Button className="secondary compact" onClick={() => c.editCapability(null)}>
            Add capability
          </Button>
        ) : undefined
      }
    >
      {!view.capabilities.length ? (
        <EmptyState
          title={record.kind === "suppliers" ? "No capabilities recorded." : "No supplier has recorded this product yet."}
          detail={record.kind === "suppliers" ? "Add the products this supplier can supply." : "Add the product to a supplier's capabilities on the Supplier record."}
        />
      ) : (
        rows
      )}
    </Section>
  );
}

const CLOSED = ["Won", "Lost", "Accepted", "Rejected", "Expired", "Cancelled", "Completed", "Delivered", "Paid"];

/** Linked leads, quotations and orders — open ones first, then history. */
export function LinkedRecordsSection({
  c,
  title,
  only,
  open: openOnly = false,
  limit,
  empty,
}: {
  c: Commercial;
  title: string;
  only?: string[];
  open?: boolean;
  limit?: number;
  empty?: string;
}) {
  const { view } = c;
  const [all, setAll] = useState(false);
  if (!view) return null;
  const rows = view.linked
    .filter((r) => !only || only.includes(r.kind))
    .filter((r) => !openOnly || !CLOSED.includes(r.status))
    .sort((a, b) => Number(CLOSED.includes(a.status)) - Number(CLOSED.includes(b.status)) || b.updatedAt.localeCompare(a.updatedAt));
  const shown = limit && !all ? rows.slice(0, limit) : rows;
  return (
    <Section title={title}>
      {!rows.length ? (
        <EmptyState title={empty || "Nothing linked yet."} />
      ) : (
        <ul className="exec-rows linked-rows">
          {shown.map((r) => (
            <li className="exec-row is-link" key={r.id}>
              <div className="exec-row-main">
                <Button className="record-link" onClick={() => openRecord(r)}>
                  {r.title}
                </Button>
                <p className="exec-meta">{[noun(r.kind), r.product].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="exec-row-end">
                <StatusBadge status={r.status} size="sm" />
                {!!r.amount && <span className="e-numeric exec-strong">{money(r.amount, r.currency)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {limit && rows.length > limit && (
        <Button className="ghost compact show-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `View all ${rows.length}`}
        </Button>
      )}
    </Section>
  );
}

export function DealsSection({ c }: { c: Commercial }) {
  const { view } = c;
  if (!view || !view.deals.length) return null;
  return (
    <Section title="Deals">
      <ul className="exec-rows">
        {view.deals.map((d) => (
          <li className="exec-row is-link" key={d.id}>
            <div className="exec-row-main">
              <Button
                className="record-link"
                onClick={() =>
                  openReference({ id: "", label: "Deal", target: { type: "record", kind: "leads", id: d.leadId } })
                }
              >
                Open Deal Room · {view.linked.find((r) => r.id === d.leadId)?.title || d.id.slice(-8)}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Meetings reached through related records; the record's own list is separate. */
export function RelatedMeetingsSection({ c }: { c: Commercial }) {
  const { view } = c;
  if (!view || !view.meetings.length) return null;
  return (
    <Section title="Related meetings">
      <ul className="exec-rows">
        {view.meetings.map((m) => (
          <li className="exec-row is-link" key={m.id}>
            <div className="exec-row-main">
              <Button
                className="record-link"
                onClick={() => openReference({ id: "", label: m.title, target: { type: "meeting", id: m.id } })}
              >
                {m.title}
              </Button>
            </div>
            <div className="exec-row-end">
              <StatusBadge status={m.status} size="sm" />
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function NameMatchesSection({ c }: { c: Commercial }) {
  const { view, actor, record } = c;
  if (!view || record.kind !== "customers") return null;
  return (
    <details className="exec-disclosure">
      <summary>Possible name matches · review separately</summary>
      <p className="exec-caption">Name matches are suggestions, not confirmed history.</p>
      {view.legacy.length ? (
        <ul className="exec-rows">
          {view.legacy.map((r) => (
            <li className="exec-row is-link" key={r.id}>
              <div className="exec-row-main">
                <Button className="record-link" onClick={() => openRecord(r)}>
                  {r.title}
                </Button>
                <p className="exec-meta">{noun(r.kind)}</p>
              </div>
              {canWrite(actor, r) && ["leads", "quotations"].includes(r.kind) && (
                <div className="exec-row-actions">
                  <Button className="ghost compact" onClick={() => c.linkToCustomer(r)}>
                    Link to this customer
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="exec-empty">No unlinked records with a matching name.</p>
      )}
    </details>
  );
}

export function CommercialFootnote() {
  return (
    <p className="exec-caption commercial-footnote">
      Showing up to 200 records you can access. Possible name matches are shown separately from confirmed links.
    </p>
  );
}

export function LinkEditor({
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
    <Dialog variant="drawer" className="commercial-editor" title="Review relationships" description={record.title} onClose={onClose}>
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
export function ContactEditor({
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
    <Dialog variant="drawer" className="commercial-editor" title={contact ? "Edit contact" : "Add contact"} description={record.title} onClose={onClose}>
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
export function CapabilityEditor({
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
    <Dialog variant="drawer" className="commercial-editor" title="Supplier capability" description={record.title} onClose={onClose}>
      <p className="exec-editor-intro">
        Record reviewed knowledge of what this supplier can supply. This is not
        an offer or availability confirmation.
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
