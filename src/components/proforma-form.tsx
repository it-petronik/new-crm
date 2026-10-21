"use client";
import { Form } from '@/components/ui/controls';

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogActions,
  Field,
  Input,
  Select,
  Textarea,
  Button,
} from "./ui/controls";
import { LineEditor } from "./record-tools";
import { CustomerSelection } from "./commercial/relationship-picker";
import { SharedSelect } from "./ui/shared-select";
import { BankAccountFields } from "./bank-account-fields";
import { optionCatalog } from "@/lib/shared-options";
import { useUnsavedChanges } from "./use-unsaved";
import { companyName } from "@/lib/company-name";
import { businessToday } from "@/lib/gst";
import { proformaError } from "@/lib/proforma";
import { expiryFromValidity, validityInDays } from "@/lib/pdf/document-validity";
import {
  canRead,
  money,
  totalCents,
  type Actor,
  type LineItem,
  type RecordItem,
} from "@/lib/domain";

type Values = Omit<
  RecordItem,
  "id" | "status" | "ownerId" | "owner" | "createdAt" | "updatedAt"
>;
export default function ProformaForm({
  actor,
  company,
  records,
  initial,
  source,
  live,
  busy,
  error,
  onClose,
  onSave,
  onCustomerCreated,
}: {
  actor: Actor;
  company: string;
  records: RecordItem[];
  initial?: RecordItem | null;
  source?: RecordItem | null;
  live: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (value: Values) => Promise<void>;
  onCustomerCreated: (record: RecordItem) => void;
}) {
  const id = useId();
  const base = initial || source;
  const [entity, setEntity] = useState(
    base?.company ||
      (company === "All companies" ? actor.companies[0] : company),
  );
  const [branch] = useState(
    base?.branch || actor.branches[0] || "Main",
  );
  const [customerId, setCustomerId] = useState(base?.customerId || "");
  const [customerName, setCustomerName] = useState(base?.title || "");
  const [currency, setCurrency] = useState(base?.currency || "USD");
  const [unit, setUnit] = useState(base?.unit || "MT");
  const [lines, setLines] = useState<LineItem[]>(
    base?.lines?.length
      ? base.lines.map((l) => ({ ...l }))
      : [{ description: "", quantity: 1, unitPriceCents: 0, packaging: "" }],
  );
  const [problem, setProblem] = useState("");
  const [step, setStep] = useState(0);
  const [contactId, setContactId] = useState(base?.contactId || null);
  const stepNames = ["Customer & Items", "Delivery & Terms", "Bank & Signing"];
  const formRef = useRef<HTMLFormElement>(null);
  function changeStep(next: number) {
    if (next > step && step === 0 && (!customerId || !lines.length || lines.some(l => !l.description.trim() || l.quantity <= 0))) {
      setProblem(!customerId ? "Choose or create a customer before continuing." : "Add each item description and a quantity greater than zero."); return;
    }
    setProblem(""); setStep(next);
    formRef.current?.closest(".dialog-body")?.scrollTo({ top: 0 });
  }
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (problem || error) {
      alert.current?.scrollIntoView({ block: "nearest" });
      alert.current?.focus({ preventScroll: true });
    }
  }, [problem, error]);
  const unsaved = useUnsavedChanges(busy);
  const close = () => {
    if (!busy) unsaved.guard(onClose)();
  };
  const customers = records.filter(
    (r) =>
      r.kind === "customers" &&
      !r.deletedAt &&
      r.status !== "Inactive" &&
      r.company === entity &&
      r.branch === branch &&
      canRead(actor, r),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (step < 2) { changeStep(step + 1); return; }
    const form = new FormData(event.currentTarget);
    const attrNames = [
      "issuedDate",
      "paymentTerms",
      "incoterm",
      "customerReference",
      "deliveryPeriod",
      "originCountry",
      "loadingPort",
      "partialShipment",
      "customerAddress",
      "customerTaxNumber",
      "senderAddress",
      "senderTaxNumber",
      "senderPhone",
      "senderWebsite",
      "senderEmail",
      "footerMessage",
      "signaturePlan",
      "bankName",
      "bankAccountName",
      "bankAccountNumber",
      "bankIban",
      "bankSwift",
      "bankBranch",
      "signatoryName",
      "signatoryTitle",
    ];
    const attributes = Object.fromEntries(
      attrNames.map((name) => [name, form.has(name) ? String(form.get(name) || "").trim() : base?.attributes?.[name] || ""]),
    );
    const due = expiryFromValidity(attributes.issuedDate, String(form.get("validityDays") || ""));
    if (!due) { setStep(0); setProblem("Enter a valid document date and invoice validity in whole days (zero or more)."); return; }
    const value: Values = {
      kind: "accounts",
      company: entity,
      branch,
      title: customerName,
      customerId,
      contactId,
      contact: String(form.get("contact") || ""),
      product: lines
        .map((l) => l.description)
        .join(", ")
        .slice(0, 160),
      quantity: lines.reduce((sum, l) => sum + l.quantity, 0),
      unit,
      amount: totalCents(lines) / 100,
      currency,
      due,
      detail: String(form.get("terms") || ""),
      source: "Accounts proforma",
      email: base?.email || "",
      destination: String(form.get("destination") || ""),
      lines,
      ...(base?.parentId && initial
        ? { parentId: base.parentId }
        : source
          ? { parentId: source.id }
          : {}),
      attributes: {
        ...attributes,
        documentType: "proforma",
        ...(initial?.attributes?.quoteReference
          ? { quoteReference: initial.attributes.quoteReference }
          : {}),
      },
    };
    const issue = proformaError(value);
    if (issue) {
      if (!customerId || !unit.trim() || lines.some(l => !l.description.trim() || l.quantity <= 0)) setStep(0);
      else if (issue.toLowerCase().includes("bank")) setStep(2);
      else setStep(1);
      setProblem(issue);
      return;
    }
    setProblem("");
    await onSave(value);
  }
  const field = (name: string, label: string, fallback = "", type = "text") => (
    <Field key={name}>
      {label}
      {optionCatalog("accounts", `attributes.${name}`) ? <SharedSelect data-field-control name={name} catalog={optionCatalog("accounts", `attributes.${name}`)!} company={entity} live={live} label={label} options={name === "partialShipment" ? ["Allowed", "Not Allowed"] : []} defaultValue={base?.attributes?.[name] || fallback} onOptions={() => {}} /> : <Input
        name={name}
        type={type}
        maxLength={300}
        defaultValue={base?.attributes?.[name] || fallback}
      />}
    </Field>
  );
  return (
    <>
      <Dialog
        title={initial ? "Edit draft proforma" : "New customer proforma"}
        onClose={close}
        className="proforma-dialog"
      >
        <Form
          id={id}
          ref={formRef}
          noValidate
          onSubmit={submit}
          onChange={unsaved.markDirty}
          className="proforma-form"
        >
          <nav className="form-steps" aria-label="Proforma steps">{stepNames.map((name, n) => <Button type="button" key={name} aria-current={step === n ? "step" : undefined} onClick={() => changeStep(n)}><span>{n + 1}</span>{name}</Button>)}</nav>
          <p className="proforma-notice">
            Prepare a customer offer, review the PDF, then mark it issued. This
            does not create a receivable, send an email or record a payment.
          </p>
          {(problem || error) && (
            <p ref={alert} tabIndex={-1} className="error" role="alert">
              {problem || error}
            </p>
          )}
          <div hidden={step !== 0} className="proforma-step"><section className="proforma-section">
            <h3>Customer & company</h3>
            <div className="proforma-grid">
              <Field>
                Issuing company
                <Select
                  value={entity}
                  disabled={!!base}
                  onChange={(e) => {
                    setEntity(e.target.value);
                    setCustomerId("");
                    setCustomerName("");
                  }}
                >
                  {actor.companies.map((c) => (
                    <option key={c} value={c}>
                      {companyName(c)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field className="customer-field">
                Customer
                <Select
                  value={customerId}
                  disabled={!!initial || !!source}
                  onChange={(e) => {
                    const customer = customers.find(
                      (c) => c.id === e.target.value,
                    );
                    setCustomerId(e.target.value);
                    setCustomerName(customer?.title || "");
                  }}
                >
                  <option value="">Choose a customer</option>
                  {customerId &&
                    !customers.some((c) => c.id === customerId) && (
                      <option value={customerId}>{customerName}</option>
                    )}
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </Select>
              </Field>
              {!base && (
                <div className="span-all">
                  <CustomerSelection
                    company={entity}
                    branch={branch}
                    customerId={customerId || null} customerName={customerName} contactId={contactId} live={live} actor={actor} forProforma
                    onCreated={onCustomerCreated}
                    onChange={(key, contact, title) => { setCustomerId(key || ""); setContactId(contact); setCustomerName(title || ""); }}
                  />
                </div>
              )}
              <Field>
                Attention / contact
                <Input
                  name="contact"
                  maxLength={160}
                  defaultValue={base?.contact}
                />
              </Field>
              {field("customerAddress", "Customer address")}
              {field("customerReference", "Customer ID")}
              {field("issuedDate", "Document date", businessToday(), "date")}
              <Field>
                Invoice validity (days)
                <Input
                  name="validityDays"
                  type="number"
                  min={0}
                  max={9999}
                  step={1}
                  defaultValue={validityInDays(base?.attributes?.issuedDate || businessToday(), base?.due || businessToday())}
                />
              </Field>
              <Field>
                Currency
                <Select
                  value={currency}
                  onChange={(e) =>
                    setCurrency(e.target.value as typeof currency)
                  }
                >
                  {["USD", "AED", "EUR", "SGD"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field>
                Quantity unit
                <SharedSelect data-field-control catalog="accounts:unit" label="Quantity Unit" company={entity} live={live} options={["MT", "kg", "litre", "drum", "pail", "piece"]} onOptions={() => {}}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </Field>
            </div>
          </section>
          <LineEditor
            catalogScope={{ company: entity, live, kind: "accounts" }}
            label="Proforma items"
            lines={lines}
            onChange={setLines}
            currency={currency}
            unit={unit}
            products={records.filter(
              (r) =>
                r.kind === "products" &&
                r.company === entity &&
                canRead(actor, r),
            )}
          />
          <div className="proforma-total">
            <span>Document total</span>
            <strong>{money(totalCents(lines) / 100, currency)}</strong>
          </div>
          </div><section hidden={step !== 1} className="proforma-section proforma-step">
            <h3>Delivery & commercial terms</h3>
            <div className="proforma-grid">
              {field("incoterm", "Incoterm / delivery terms")}
              <Field>
                Delivery destination
                <Input
                  name="destination"
                  maxLength={160}
                  defaultValue={base?.destination}
                />
              </Field>
              {field("deliveryPeriod", "Delivery period")}
              {field("originCountry", "Country of origin")}
              {field("loadingPort", "Port of loading")}
              {field("partialShipment", "Partial Shipment Allowed")}
              <Field className="span-all">
                Payment terms
                <SharedSelect data-field-control name="paymentTerms" label="Payment Terms" catalog="accounts:attributes.paymentTerms" company={entity} live={live} options={[]} defaultValue={base?.attributes?.paymentTerms || ""} onOptions={() => {}} />
              </Field>
              <Field className="span-all">
                Terms & conditions
                <Textarea
                  name="terms"
                  maxLength={5000}
                  rows={5}
                  defaultValue={base?.detail}
                  placeholder="Enter the agreed terms. No terms from another customer's invoice are added automatically."
                />
              </Field>
            </div>
          </section>
          <section hidden={step !== 2} className="proforma-section proforma-step">
            <h3>
              Issuer, bank & signing area{" "}
              <span className="muted">Optional</span>
            </h3>
            <div className="proforma-grid">
              {field("senderAddress", "Issuer address")}
              <p className="span-all muted small">The footer uses the company’s standard contact details on every quotation and proforma.</p>
              <BankAccountFields key={entity} actor={actor} company={entity} currency={currency} live={live} initial={base?.attributes} />
              {entity === "Petronik" ? <div className="span-all"><input type="hidden" name="signaturePlan" value="approved" /><p className="muted small">Petronik’s approved signature and stamp are applied automatically in the connected company workspace. This does not change the document’s approval or issue status.</p></div> : <Field className="span-all">Signature & stamp<Select name="signaturePlan" defaultValue={base?.attributes?.signaturePlan || "blank"}><option value="blank">Leave blank for manual signing</option><option value="later">Add approved images later</option></Select></Field>}
            </div>
            {entity !== "Petronik" && <><div className="document-signing-options"><div><strong>Signature image</strong><p>Optional · reserved for an approved signature</p></div><div><strong>Company stamp</strong><p>Optional · reserved for an approved stamp</p></div></div>
            <p className="muted small">Image upload will be available here when protected file storage is enabled. You can edit these options in a draft later. Issued documents remain locked.</p></>}
            <p className="muted small">
              Verify bank details independently before issuing. The approved signature artwork is not a digital certificate or a change to approval permissions.
            </p>
          </section>
        </Form>
        <DialogActions key={`step-${step}`} onCancel={close} pending={busy} start={step > 0 ? <Button type="button" variant="secondary" disabled={busy} onClick={() => changeStep(step - 1)}>Back</Button> : <span className="muted small">Step 1 Of 3</span>} secondary={<span className="muted small">{step > 0 ? `Step ${step + 1} Of 3` : ""}</span>} primary={step < 2 ? { label: "Continue", type: "button", onClick: () => changeStep(step + 1) } : { label: initial ? "Save Draft Changes" : "Create Draft Proforma", type: "submit", form: id, pending: busy }} />
      </Dialog>
      {unsaved.confirm}
    </>
  );
}
