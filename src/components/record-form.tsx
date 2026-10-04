"use client";
import { CustomerSelection } from "./commercial/relationship-picker";
import { companyName } from "@/lib/company-name";
import { specError } from "@/lib/validation";
import { optionCatalog } from "@/lib/shared-options";
import { SharedSelect } from "./ui/shared-select";
import { useUnsavedChanges } from "./use-unsaved";
import { CustomerMatches, LeadMatches, activeLeadMatches, isStrongMatch, openExisting, useCustomerMatches } from "./form-guidance";
import { commercialLocked, correctionFields } from "@/lib/record-mutations";
import { Fragment, useEffect, useState, useId } from "react";
import { ShieldCheck, X } from "lucide-react";
import {
  Button,
  Dialog,
  DialogActions,
  Field,
  Input,
  Select,
  Textarea,
} from "./ui/controls";
import { LineEditor } from "./record-tools";
import {
  totalCents,
  type Actor,
  type Kind,
  type LineItem,
  type RecordItem,
  money,
} from "@/lib/domain";
import { quotationSources } from "@/lib/sales-prefill";
import { recordProfiles, recordFieldValue, type FieldSpec } from "@/lib/record-profiles";
import { amountInWords, quotationError } from "@/lib/quotation";
import { fieldWidth } from "@/lib/form-layout";
import { entryFields } from "@/lib/entry-layout";
import { cashEntryProfile } from "@/lib/record-profiles";
import { salaryAttributes } from "@/lib/salary";
import { isCashEntry } from "@/lib/cashbook";

/** The primary action of each create form, named for what it creates. */
const CREATE_LABELS: Record<Kind, string> = {
  leads: "Create lead",
  quotations: "Create quotation",
  orders: "Create order",
  logistics: "Create shipment",
  accounts: "Create invoice",
  customers: "Create customer",
  suppliers: "Create supplier",
  products: "Create product",
  hr: "Create employee",
  marketing: "Create campaign",
  it: "Create ticket",
  leave: "Submit request",
};

export default function RecordForm({
  initial,
  live = false,
  kind,
  actor,
  company,
  busy,
  records,
  onClose,
  onSave,
  editing = false,
  saveError,
  serverFieldErrors,
  context,
}: {
  initial: RecordItem | null;
  live?: boolean;
  editing?: boolean;
  saveError?: string;
  /** The server's own per-field messages, shown beside each field. */
  serverFieldErrors?: Record<string, string>;
  /** What this form was started from ("Al Noor · Samira"), shown so the
   *  pre-filled context is never a surprise. */
  context?: string;
  kind: Kind;
  actor: Actor;
  company: string;
  busy: boolean;
  records: RecordItem[];
  onClose: () => void;
  onSave: (
    value: Omit<
      RecordItem,
      "id" | "status" | "ownerId" | "owner" | "createdAt" | "updatedAt"
    >,
  ) => Promise<void>;
}) {
  const profile = kind === "accounts" && (!initial || isCashEntry(initial)) ? cashEntryProfile : recordProfiles[kind];
  // A create form's primary action names what it makes; edits save changes.
  const createLabel = profile === cashEntryProfile ? "Record entry" : CREATE_LABELS[kind];
  const locked = Boolean(editing && initial && commercialLocked(initial));
  const quoteEditor = kind === "quotations" && !locked;
  const [formError, setFormError] = useState("");
  // Per-field messages. They appear on submit and clear the moment the person
  // edits the field, so a corrected value never needs a second submit.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [customChoices, setCustomChoices] = useState<Record<string, string[]>>({});
  // Open when editing a record that already uses those fields.
  const [moreOpen, setMoreOpen] = useState(() =>
    Boolean(editing && kind !== "quotations" && initial && recordProfiles[kind]?.fields.some((f) => f.advanced && recordFieldValue(initial, f.name))),
  );
  const clearFieldError = (name: string) =>
    setFieldErrors((prev) => (prev[name] ? { ...prev, [name]: "" } : prev));
  const [entity, setEntity] = useState(
    initial?.company ||
      (company === "All companies" ? actor.companies[0] : company),
  );
  const [branch] = useState(initial?.branch || actor.branches[0] || "Main");
  const [quoteCurrency, setQuoteCurrency] = useState(
    initial?.currency || "USD",
  );
  const [quoteUnit, setQuoteUnit] = useState(initial?.unit || "MT");
  const [customerId, setCustomerId] = useState(initial?.customerId || "manual");
  // What has been typed so far, for guidance while the form is filled in.
  const [watch, setWatch] = useState({ title: initial?.title || "", email: initial?.email || "", phone: initial?.phone || "", product: initial?.product || "" });
  const [separate, setSeparate] = useState(false);
  const customerMatches = useCustomerMatches(live && !editing && kind === "customers", {
    company: entity,
    branch,
    title: watch.title,
    email: watch.email,
    phone: watch.phone,
  });
  const strongMatch = customerMatches.some(isStrongMatch);
  const leadMatches = () =>
    !editing && kind === "leads"
      ? activeLeadMatches(records, {
          customerId: customerId === "manual" ? null : customerId,
          contactId: linkedContactId,
          productId: initial?.productId || null,
          title: contactDraft.title,
          product: watch.product,
        })
      : [];
  const [leadNoticeDismissed, setLeadNoticeDismissed] = useState(false);
  // Closing with real edits asks first; an untouched form just closes.
  const unsaved = useUnsavedChanges(busy);
  const close = unsaved.guard(onClose);
  const useExisting = (record: { id: string; kind: string }) => {
    onClose();
    openExisting(record);
  };
  // Same wording as on submit, as soon as the person leaves a field.
  const fieldMessage = (spec: FieldSpec | { name: string; label: string; required?: boolean }, value: string) =>
    specError(customChoices[`${entity}:${spec.name}`] ? { ...spec, options: customChoices[`${entity}:${spec.name}`] } : spec as FieldSpec, value) ||
    (spec.name === "phone" && value.trim() && !/^[+\d][\d\s().-]{5,}$/.test(value.trim())
      ? "Use digits, spaces and + ( ) - only, e.g. +971 4 555 0142."
      : "");
  // The server's field messages land beside their fields, opening More
  // details first when one is there, and focus the first of them.
  useEffect(() => {
    if (!serverFieldErrors || !Object.keys(serverFieldErrors).length) return;
    setFieldErrors((prev) => ({ ...prev, ...serverFieldErrors }));
    const first = Object.keys(serverFieldErrors)[0];
    setMoreOpen(true);
    setTimeout(() => document.querySelector<HTMLElement>(`#${CSS.escape(formId)} [name="${first}"]`)?.focus(), 0);
  }, [serverFieldErrors]); // eslint-disable-line react-hooks/exhaustive-deps
  const [linkedContactId, setLinkedContactId] = useState(initial?.contactId || null);
  const [contactDraft, setContactDraft] = useState<Record<string, string>>({
    title: initial?.title || "",
    contact: initial?.contact || "",
    email: initial?.email || "",
    phone: initial?.phone || "",
    "attributes.country": initial?.attributes?.country || "",
    "attributes.customerAddress": initial?.attributes?.customerAddress || "",
    "attributes.customerTaxNumber":
      initial?.attributes?.customerTaxNumber || "",
  });
  const sources = quotationSources(
    records,
    actor,
    entity,
    branch,
    quoteCurrency,
    quoteUnit,
  );
  const senderDefaults = records
    .filter(
      (r) =>
        r.kind === "quotations" &&
        r.company === entity &&
        r.attributes?.senderName,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.attributes;
  const [lines, setLines] = useState<LineItem[]>(
    initial?.lines?.length
      ? initial.lines
      : initial
        ? [
            {
              description: initial.product || initial.title,
              quantity: initial.quantity || 1,
              unitPriceCents: Math.round(
                (initial.amount * 100) / (initial.quantity || 1),
              ),
            },
          ]
        : [{ description: "", quantity: 1, unitPriceCents: 0 }],
  );
  const formId = useId();
  // Everyday fields first; the rest wait under "More details" (still part
  // of the form, so nothing is lost when it is closed).
  const shownFields = profile.fields.filter((field) => !locked || correctionFields.includes(field.name));
  const { basic: basicFields, additional: advancedFields } = entryFields(kind, shownFields, editing && kind !== "quotations");
  const renderField = (field: FieldSpec) => {
            const rawInitial = initial ? recordFieldValue(initial, field.name) : "";
            // A new record started from another one (a lead from a customer)
            // does not inherit an empty 0 for numbers it has not been told.
            const initialValue = !editing && field.type === "number" && Number(rawInitial) === 0 ? "" : rawInitial;
            const fallback =
              field.name === "attributes.signatoryName"
                ? "Peiman Hussain"
                : field.name.startsWith("attributes.sender") &&
                    senderDefaults?.[field.name.slice(11)]
                  ? senderDefaults[field.name.slice(11)]
                  : field.name === "attributes.amountWords"
                    ? amountInWords(totalCents(lines), quoteCurrency)
                    : field.name === "attributes.senderName"
                      ? entity === "Petronik"
                        ? "PETRONIK FZCO"
                        : entity
                      : field.name === "contact" &&
                          ["it", "leave"].includes(kind)
                        ? actor.name
                        : field.type === "date"
                          ? new Date().toISOString().slice(0, 10)
                          : field.name === "unit"
                            ? profile.unit
                            : undefined;
            return (
              <Fragment key={entity + field.name}>
                <Field
                  className={fieldWidth(field.name)}
                  error={fieldErrors[field.name]}
                >
                  {field.label}
                  {field.options && optionCatalog(kind, field.name) ? (
                    <SharedSelect data-field-control name={field.name} label={field.label} company={entity} catalog={optionCatalog(kind, field.name)!} live={live} options={field.options} defaultValue={initialValue || fallback} required={field.required} onOptions={options => setCustomChoices(prev => ({ ...prev, [`${entity}:${field.name}`]: options }))} {...(kind === "quotations" && field.name === "unit" ? { value: quoteUnit, disabled: lines.some(l => Boolean(l.description)), onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setQuoteUnit(e.target.value) } : {})} />
                  ) : field.options ? (
                    <Select
                      name={field.name}
                      defaultValue={initialValue || fallback}
                      {...(kind === "quotations" &&
                      ["currency", "unit"].includes(field.name)
                        ? {
                            value:
                              field.name === "currency"
                                ? quoteCurrency
                                : quoteUnit,
                            disabled: lines.some((l) => Boolean(l.description)),
                            onChange: (
                              e: React.ChangeEvent<HTMLSelectElement>,
                            ) =>
                              field.name === "currency"
                                ? setQuoteCurrency(e.target.value)
                                : setQuoteUnit(e.target.value),
                          }
                        : {})}
                      required={field.required}
                    >
                      {field.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      name={field.name}
                      onInput={(e) => e.currentTarget.setCustomValidity("")}
                      type={field.type || "text"}
                      required={field.required}
                      placeholder={field.placeholder}
                      {...(["quotations", "leads"].includes(kind) &&
                      [
                        "contact",
                        "email",
                        "phone",
                        "attributes.country",
                        "attributes.customerAddress",
                        "attributes.customerTaxNumber",
                      ].includes(field.name)
                        ? {
                            value: contactDraft[field.name] || "",
                            onChange: (
                              e: React.ChangeEvent<HTMLInputElement>,
                            ) =>
                              setContactDraft({
                                ...contactDraft,
                                [field.name]: e.target.value,
                              }),
                          }
                        : field.name === "attributes.amountWords"
                          ? {
                              value: amountInWords(
                                totalCents(lines),
                                quoteCurrency,
                              ),
                              readOnly: true,
                            }
                          : { defaultValue: initialValue || fallback })}
                      min={field.min}
                      max={field.type === "number" ? 100000000 : undefined}
                      step={field.type === "number" ? "0.01" : undefined}
                      maxLength={
                        field.name.startsWith("attributes.")
                          ? 300
                          : field.name === "phone"
                            ? 50
                            : 160
                      }
                    />
                  )}
                </Field>
              </Fragment>
            );
  };
  return (
    <Dialog
      title={editing ? `Edit ${profile.noun.toLowerCase()}` : profile.title}
      onClose={close}
      className={`record-form-dialog simple-entry-dialog ${quoteEditor || editing ? "dialog-wide" : "dialog-compact"} ${kind === "quotations" ? "quotation-form-dialog" : ""}`}
    >
      <div className="modal-header">
        <span className="eyebrow">{profile.noun}</span>
        <Button
          className="icon-button"
          aria-label="Close form"
          onClick={close}
        >
          <X size={20} />
        </Button>
      </div>
      <h2>{profile.title}</h2>
      <p className="muted">{locked ? "Commercial values and links are protected. You can correct contact, delivery and notes fields." : profile.description}</p>
      {context && !editing && (
        <p className="form-context">
          <span>Started from</span> <b>{context}</b>
        </p>
      )}
      {!editing && <p className="small muted">Start with the essentials. Add other details only when you need them.</p>}
      <form
        id={formId}
        noValidate
        // Editing any field clears that field's message immediately, so a
        // correction never waits for another submit to be acknowledged.
        onChange={unsaved.markDirty}
        onInput={(e) => {
          unsaved.markDirty(e);
          const target = e.target as HTMLInputElement;
          const name = target.name;
          if (name) clearFieldError(name);
          if (name && name in watch) setWatch((prev) => ({ ...prev, [name]: target.value }));
        }}
        // Leaving a field checks it straight away, in the same words as submit.
        onBlur={(e) => {
          const target = e.target as unknown as HTMLInputElement;
          const spec = profile.fields.find((f) => f.name === target.name);
          if (!spec || !("value" in target) || !target.value) return;
          const message = fieldMessage(spec, target.value);
          if (message) setFieldErrors((prev) => ({ ...prev, [spec.name]: message }));
        }}
        onSubmit={(e) => {
          e.preventDefault();
          // Validate against the same field metadata the CSV importer uses, so
          // the wording is ours and identical in both places. The API still
          // re-checks everything; this only makes the feedback immediate.
          const entered = new FormData(e.currentTarget);
          const read = (name: string) => String(entered.get(name) ?? "");
          const found: Record<string, string> = {};
          const nameError = specError(
            { name: "title", label: profile.nameLabel, required: true },
            read("title"),
          ) || (read("title").trim() && read("title").trim().length < 2
            ? `${profile.nameLabel} needs at least 2 characters.`
            : "");
          if (nameError) found.title = nameError;
          for (const spec of profile.fields) {
            if (locked && !correctionFields.includes(spec.name)) continue;
            const message = fieldMessage(spec, read(spec.name));
            if (message) found[spec.name] = message;
          }
          setFieldErrors(found);
          const firstName = Object.keys(found)[0];
          if (firstName) {
            if (advancedFields.some((f) => f.name === firstName)) setMoreOpen(true);
            const el = e.currentTarget.querySelector<HTMLElement>(`[name="${firstName}"]`);
            setFormError("Check the highlighted fields.");
            setTimeout(() => {
              el?.focus();
              el?.scrollIntoView({ block: "center", behavior: "smooth" });
            }, 0);
            return;
          }
          if (strongMatch && !separate) {
            setFormError("This customer may already exist. Use the existing one, or confirm it is a separate company.");
            e.currentTarget.querySelector<HTMLElement>(".form-guidance button, .form-guidance input")?.focus();
            return;
          }
          setFormError("");
          const data = new FormData(e.currentTarget);
          const str = (name: string) => data.has(name) ? String(data.get(name) || "") : editing && initial ? recordFieldValue(initial, name) : "";
          const attributes = Object.fromEntries(
            profile.fields
              .filter((f) => f.name.startsWith("attributes."))
              .map((f) => [f.name.slice(11), str(f.name)]),
          );
          // Preview shares the server's derivation and validation rather than
          // repeating the arithmetic with no checks.
          if (kind === "hr") Object.assign(attributes, salaryAttributes(attributes));
          const error =
            quoteEditor
              ? quotationError(lines, attributes.issuedDate, str("due"))
              : "";
          setFormError(error);
          if (error) {
            e.currentTarget.querySelector<HTMLElement>(".line-editor input")?.focus();
            return;
          }
          void onSave({
            kind,
            ...(live && ["leads", "quotations"].includes(kind) ? {customerId: customerId === "manual" ? null : customerId, contactId: linkedContactId, productId: initial?.productId || null, dealId: initial?.dealId || null} : {}),
            company: entity,
            branch,
            title: str("title"),
            contact: str("contact"),
            product:
              kind === "quotations"
                ? lines
                    .map((l) => l.description)
                    .join(", ")
                    .slice(0, 160)
                : str("product"),
            email: str("email"),
            phone: str("phone"),
            destination: str("destination"),
            quantity:
              kind === "quotations"
                ? lines.reduce((sum, l) => sum + l.quantity, 0)
                : Number(str("quantity") || 0),
            unit:
              kind === "quotations" ? quoteUnit : str("unit") || profile.unit,
            amount:
              kind === "quotations"
                ? totalCents(lines) / 100
                : Number(str("amount") || 0),
            currency:
              kind === "quotations" ? quoteCurrency : str("currency") || "USD",
            due: str("due") || new Date().toISOString().slice(0, 10),
            source: editing ? str("source") : str("source") || "Manual",
            detail: str("detail"),
            attributes,
            ...(kind === "quotations" ? { lines, parentId: editing ? initial?.parentId : initial?.id } : {}),
          });
        }}
      >
        <div className="form-grid">
          {live && !editing && ["leads", "quotations"].includes(kind) && <div className="full"><CustomerSelection company={entity} branch={branch} customerId={customerId === "manual" ? null : customerId} customerName={contactDraft.title} contactId={linkedContactId} onChange={(id, contact, title) => {
            unsaved.markDirty({});
            setCustomerId(id || "manual");
            setLinkedContactId(contact);
            const customer = records.find((r) => r.id === id && r.kind === "customers" && r.company === entity);
            if (id !== customerId) setContactDraft({
              title: title || "", contact: customer?.contact || "", email: customer?.email || "", phone: customer?.phone || "",
              "attributes.country": customer?.attributes?.country || "",
              "attributes.customerAddress": customer?.attributes?.address || "",
              "attributes.customerTaxNumber": customer?.attributes?.taxNumber || "",
            });
          }} /></div>}
          <Field className="field-wide" error={fieldErrors.title}>
            {profile.nameLabel}
            <Input
              name="title"
              // Marks the field required (the shared Field draws the *);
              // validation itself stays the form's own check (noValidate).
              required={!locked}
              readOnly={locked || (live && customerId !== "manual" && ["leads", "quotations"].includes(kind))}
              maxLength={160}
              onInput={() => clearFieldError("title")}
              {...(["quotations", "leads"].includes(kind)
                ? {
                    value: contactDraft.title,
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                      setContactDraft({
                        ...contactDraft,
                        title: e.target.value,
                      }),
                  }
                : { defaultValue: initial?.title })}
              placeholder={profile.nameLabel}
            />
          </Field>
          <CustomerMatches matches={customerMatches} acknowledged={separate} onAcknowledge={setSeparate} onOpen={(id) => useExisting({ id, kind: "customers" })} />
          {!leadNoticeDismissed && (
            <LeadMatches
              leads={leadMatches()}
              onOpen={(r) => useExisting(r)}
              onDismiss={() => {
                setLeadNoticeDismissed(true);
                // Carry on where the form continues.
                setTimeout(() => document.querySelector<HTMLElement>(`#${CSS.escape(formId)} [name="product"]`)?.focus(), 0);
              }}
            />
          )}
          <Field>
            Business entity
            <Select
              name="company"
              value={entity}
              disabled={Boolean(initial)}
              onChange={(e) => {
                setEntity(e.target.value);
                setCustomerId("manual");
                setLinkedContactId(null);
                setContactDraft({
                  title: "",
                  contact: "",
                  email: "",
                  phone: "",
                });
                setLines([{ description: "", quantity: 1, unitPriceCents: 0 }]);
              }}
            >
              {actor.companies.map((c) => (
                <option key={c} value={c}>
                  {companyName(c)}
                </option>
              ))}
            </Select>
          </Field>
          <input type="hidden" name="branch" value={branch} />
          {!live && kind === "quotations" && !initial && (
            <Field>
              Use saved customer details
              <Select
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  const customer = sources.customers.find(
                    (r) => r.id === e.target.value,
                  );
                  if (customer)
                    setContactDraft({
                      title: customer.title,
                      contact: customer.contact,
                      email: customer.email || "",
                      phone: customer.phone || "",
                      "attributes.country": customer.attributes?.country || "",
                      "attributes.customerAddress":
                        customer.attributes?.address || "",
                      "attributes.customerTaxNumber":
                        customer.attributes?.taxNumber || "",
                    });
                }}
              >
                <option value="manual">Enter customer details manually</option>
                {sources.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {basicFields.map(renderField)}
        </div>
        {quoteEditor && (
          <div className="quotation-items-section">
            <LineEditor
              lines={lines}
              onChange={(value) => { setLines(value); unsaved.markDirty({}); }}
              products={sources.products}
              currency={quoteCurrency}
              unit={quoteUnit}
            />
            <p className="small muted">
              Type a product name to search {companyName(entity)}’s{" "}
              {quoteCurrency}/{quoteUnit} catalog, or enter a custom item.
            </p>
            <div className="balance">
              <span>Quotation total</span>
              <strong>{money(totalCents(lines) / 100, quoteCurrency)}</strong>
            </div>
          </div>
        )}
        <details className="form-more" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
          <summary>{editing && kind !== "quotations" ? "Notes" : "More details & notes"} <span className="muted">(optional)</span></summary>
          <div className="form-grid">{advancedFields.map(renderField)}
          <Field className="full">
            {profile.notes}
            <Textarea
              name="detail"
              defaultValue={
                kind === "quotations" && initial?.kind !== "quotations"
                  ? ""
                  : initial?.detail
              }
              rows={3}
              maxLength={5000}
              placeholder={profile.notes}
            />
          </Field>
          </div>
        </details>
        {(formError || saveError) && (
          <p className="error" role="alert">
            {formError || saveError}
          </p>
        )}
        <DialogActions
          onCancel={close}
          pending={busy}
          start={
            <span className="ui-dialog-note">
              <ShieldCheck size={14} aria-hidden="true" />
              {actor.name} · Recorded with your company access
            </span>
          }
          primary={{
            type: "submit",
            form: formId,
            label: editing ? "Save changes" : createLabel,
            pendingLabel: "Saving…",
            pending: busy,
          }}
        />
      </form>
      {unsaved.confirm}
    </Dialog>
  );
}
