"use client";
import { companyName } from "@/lib/company-name";
import { commercialLocked, correctionFields } from "@/lib/record-mutations";
import { Fragment, useState, useId } from "react";
import { ArrowRight, ShieldCheck, X } from "lucide-react";
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
import { recordProfiles, recordFieldValue } from "@/lib/record-profiles";
import { amountInWords, quotationError } from "@/lib/quotation";
import { fieldWidth, quoteSection, quoteSections } from "@/lib/form-layout";
import { cashEntryProfile } from "@/lib/record-profiles";
import { isCashEntry } from "@/lib/cashbook";
export default function RecordForm({
  initial,
  kind,
  actor,
  company,
  busy,
  records,
  onClose,
  onSave,
  editing = false,
  saveError,
}: {
  initial: RecordItem | null;
  editing?: boolean;
  saveError?: string;
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
  const locked = Boolean(editing && initial && commercialLocked(initial));
  const quoteEditor = kind === "quotations" && !locked;
  const [formError, setFormError] = useState("");
  const [section, setSection] = useState(0);
  const hiddenField = (name: string) =>
    quoteEditor && quoteSection(name) !== section
      ? " form-field-hidden"
      : "";
  const [entity, setEntity] = useState(
    initial?.company ||
      (company === "All companies" ? actor.companies[0] : company),
  );
  const [branch] = useState(initial?.branch || actor.branches[0] || "Main");
  const [quoteCurrency, setQuoteCurrency] = useState(
    initial?.currency || "USD",
  );
  const [quoteUnit, setQuoteUnit] = useState(initial?.unit || "MT");
  const [customerId, setCustomerId] = useState("manual");
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
  return (
    <Dialog
      title={editing ? `Edit ${profile.noun.toLowerCase()}` : profile.title}
      onClose={onClose}
      className={`record-form-dialog ${profile.fields.length > 11 ? "dialog-wide" : "dialog-compact"} ${kind === "quotations" ? "quotation-form-dialog" : ""}`}
    >
      <div className="modal-header">
        <span className="eyebrow">{profile.noun}</span>
        <Button
          className="icon-button"
          aria-label="Close form"
          onClick={onClose}
        >
          <X size={20} />
        </Button>
      </div>
      <h2>{profile.title}</h2>
      <p className="muted">{locked ? "Commercial values and links are protected. You can correct contact, delivery and notes fields." : profile.description}</p>
      {quoteEditor && (
        <nav className="form-sections" aria-label="Quotation sections">
          {quoteSections.map((s, i) => (
            <Button
              key={s}
              type="button"
              aria-pressed={section === i}
              onClick={() => setSection(i)}
            >
              <span>{i + 1}</span>
              {s}
            </Button>
          ))}
        </nav>
      )}
      <form
        id={formId}
        noValidate={quoteEditor}
        onSubmit={(e) => {
          e.preventDefault();
          if (quoteEditor) {
            const invalid = [
              ...e.currentTarget.querySelectorAll<
                HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
              >("input,textarea,select"),
            ].find((field) => field.willValidate && !field.validity.valid);
            if (invalid) {
              setSection(
                invalid.closest(".quotation-items-section, .line-editor")
                  ? 1
                  : quoteSection(invalid.name),
              );
              setFormError(
                invalid.validationMessage || "Complete the required field.",
              );
              setTimeout(() => invalid.focus(), 0);
              return;
            }
          }
          const data = new FormData(e.currentTarget);
          const str = (name: string) => data.has(name) ? String(data.get(name) || "") : editing && initial ? recordFieldValue(initial, name) : "";
          const attributes = Object.fromEntries(
            profile.fields
              .filter((f) => f.name.startsWith("attributes."))
              .map((f) => [f.name.slice(11), str(f.name)]),
          );
          if (kind === "hr") attributes.monthlySalary = String((Math.round(Number(attributes.basicSalary || 0) * 100) + Math.round(Number(attributes.allowance || 0) * 100)) / 100);
          const error =
            quoteEditor
              ? quotationError(lines, attributes.issuedDate, str("due"))
              : "";
          setFormError(error);
          if (error) {
            setSection(error.includes("Validity") ? 0 : 1);
            return;
          }
          void onSave({
            kind,
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
          <Field className={"field-wide" + hiddenField("title")}>
            {profile.nameLabel}
            <Input
              name="title"
              readOnly={locked}
              required
              minLength={2}
              maxLength={160}
              {...(kind === "quotations"
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
          <Field className={hiddenField("company")}>
            Business entity
            <Select
              name="company"
              value={entity}
              disabled={Boolean(initial)}
              onChange={(e) => {
                setEntity(e.target.value);
                setCustomerId("manual");
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
          {kind === "quotations" && !initial && (
            <Field className={hiddenField("customer")}>
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
          {profile.fields.filter(field => !locked || correctionFields.includes(field.name)).map((field) => {
            const initialValue = initial
              ? recordFieldValue(initial, field.name)
              : "";
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
                  className={fieldWidth(field.name) + hiddenField(field.name)}
                >
                  {field.label}
                  {field.options ? (
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
                      {...(kind === "quotations" &&
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
          })}
        </div>
        {quoteEditor && (
          <div
            className={
              section !== 1 ? "form-field-hidden" : "quotation-items-section"
            }
          >
            <LineEditor
              lines={lines}
              onChange={setLines}
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
        <div className={"form-grid" + hiddenField("detail")}>
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
        {(formError || saveError) && (
          <p className="error" role="alert">
            {formError || saveError}
          </p>
        )}
        <DialogActions>
          <div className="form-footer">
            <span>
              <ShieldCheck size={14} />
              {actor.name} · Recorded with your company access
            </span>
            <Button type="button" className="secondary" onClick={onClose}>
              Cancel
            </Button>
            {quoteEditor && section < 2 && (
              <Button
                type="button"
                className="secondary"
                onClick={() => setSection(section + 1)}
              >
                Next section <ArrowRight size={14} />
              </Button>
            )}
            <Button
              type="submit"
              form={formId}
              className="primary"
              loading={busy}
              disabled={busy}
            >
              {editing ? "Save changes" : "Save record"}
              <ArrowRight size={15} />
            </Button>
          </div>
        </DialogActions>
      </form>
    </Dialog>
  );
}
