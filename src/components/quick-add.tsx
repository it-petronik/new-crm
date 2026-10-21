"use client";
import { Form } from '@/components/ui/controls';

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Dialog, DialogActions, Field, Input, Select } from "@/components/ui/controls";
import { leadTypes } from "@/lib/lead-desk";
import { mayOwn } from "@/lib/notification-rules";
import { previewPeople } from "@/lib/team-preview";
import { requestJson } from "@/lib/client-request";
import { useForm } from "@/components/ui/use-form";
import { required, email as emailRule, minLength, number } from "@/lib/validation";
import { AlertCircle } from "lucide-react";
import { companyName } from "@/lib/company-name";
import { recordProfiles } from "@/lib/record-profiles";
import { followUpPresets, isoDate } from "@/lib/attention";
import { type Actor, type Kind, type RecordItem } from "@/lib/domain";
import { quickCreateKinds } from "@/lib/workspace-experience";
import { InquiryCapture } from "./ai/inquiry-capture";
import { SkeletonText } from "./ui/skeleton";
import { fillEmptyFields, type CaptureDraft } from "@/lib/ai/capture-fields";

/**
 * Quick add: the fastest path from "I just spoke to someone" to a saved record.
 *
 * It asks only for what the system genuinely cannot know — who, what, and when
 * to follow up. Owner, company, branch, status, dates, currency and unit are
 * filled in from the workspace and the signed-in user, because asking someone
 * to retype what the application already knows is the reason CRM data goes
 * stale.
 *
 * Everything else stays available through the full form, which this links to
 * rather than replaces.
 */

/** Kinds a person creates ad hoc. Others originate from a quotation. */
type QuickKind = "leads" | "customers" | "suppliers" | "products";
const QUICK_KINDS: QuickKind[] = ["leads", "customers", "suppliers", "products"];

export type QuickAddValues = Omit<
  RecordItem,
  "id" | "status" | "ownerId" | "owner" | "createdAt" | "updatedAt"
> & { assigneeId?: string };

/** The name a validation message should use for the record's title field. */
const profileLabel = (kind: QuickKind) => recordProfiles[kind].nameLabel;

export default function QuickAdd({
  actor,
  company,
  branch,
  onCreate,
  onClose,
  initialKind,
  preview = false,
  onManageTeam,
}: {
  actor: Actor;
  company: string;
  branch: string;
  onCreate: (values: QuickAddValues) => Promise<void>;
  onClose: () => void;
  onOpenFullForm: (kind: Kind) => void;
  initialKind?: Kind;
  preview?: boolean;
  onManageTeam?: () => void;
}) {
  const permitted = quickCreateKinds(actor, company, branch) as QuickKind[];
  const [kind, setKind] = useState<QuickKind>(
    initialKind && (permitted as string[]).includes(initialKind)
      ? (initialKind as QuickKind)
      : permitted[0],
  );
  const [name, setName] = useState("");
  const [brand, setBrand] = useState(company);
  const [assigneeId, setAssigneeId] = useState("");
  const [people, setPeople] = useState<{id: string; name: string; role: string}[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [leadType, setLeadType] = useState("Buyer inquiry");
  const [source, setSource] = useState("Manual");
  const [product, setProduct] = useState("");
  const [grade, setGrade] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [destination, setDestination] = useState("");
  const [captured, setCaptured] = useState(false);
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState(followUpPresets()[1].date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const values = { name, contact, email, product, amount, quantity: kind === "leads" ? quantity : "", unit };
  const { form, errorFor, blur, revalidate, submit, reset } = useForm(
    {
      name: [required(profileLabel(kind)), minLength(profileLabel(kind), 2)],
      email: [emailRule],
      amount: [number("Estimated value", { min: 0 })],
      quantity: [number("Quantity", {min:0, max:100000000})],
      unit: [(value: string) => kind === "leads" && Number(quantity) > 0 && !value.trim() ? "Choose a unit for this quantity." : ""],
    },
    ["name", "email", "amount", "quantity", "unit"],
  );

  useEffect(() => { nameRef.current?.focus(); }, []);
  useEffect(() => {
    if (kind !== "leads") return;
    let active = true;
    setAssigneeId(""); setPeople([]); setPeopleError(""); setPeopleLoading(true);
    const draft = { kind: "leads", company: brand, branch, ownerId: actor.id } as RecordItem;
    const load = preview
      ? Promise.resolve({ people: previewPeople(actor).filter(p => mayOwn(p, draft)) })
      : requestJson<{ people: {id: string; name: string; role: string}[] }>(`/api/records/assignees?company=${encodeURIComponent(brand)}`);
    load.then(result => { if(active) setPeople(result.people); }).catch(() => { if(active) setPeopleError("Salespeople could not load. You can save the lead and assign it later."); }).finally(() => {if(active) setPeopleLoading(false);});
    return () => { active = false; };
  }, [kind, brand, actor.id, branch, preview]);

  if (!permitted.length) return null;
  const profile = recordProfiles[kind];
  function applyInquiry(suggested: CaptureDraft) {
    const next = fillEmptyFields({title: name, contact, email, phone, product, grade, quantity, unit, destination}, suggested);
    setName(next.title || ""); setContact(next.contact || ""); setEmail(next.email || ""); setPhone(next.phone || "");
    setProduct(next.product || ""); setGrade(next.grade || ""); setQuantity(next.quantity || ""); setUnit(next.unit || ""); setDestination(next.destination || ""); setCaptured(true);
  }

  async function save() {
    // Client validation is for speed of feedback only; the API re-checks
    // everything and remains the authority.
    if (!submit(values)) return;
    if (busy) return; // never submit twice
    setBusy(true);
    setError("");
    try {
      await onCreate({
        kind,
        company: brand,
        branch,
        title: name.trim(),
        contact: contact.trim(),
        product: product.trim(),
        // Defaults the system can determine; the full form can refine them.
        quantity: kind === "leads" ? Number(quantity) || 0 : 0,
        unit: (kind === "leads" && unit) || profile.unit || "MT",
        amount: Number(amount) || 0,
        currency: "USD",
        due: due || isoDate(new Date()),
        detail: "",
        source: kind === "leads" ? source : "Manual",
        ...(kind === "leads" ? { phone: phone.trim(), destination: destination.trim(), attributes: { leadType, ...(grade.trim() ? {grade: grade.trim()} : {}) } } : {}),
        ...(kind === "leads" && assigneeId ? { assigneeId } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      } as QuickAddValues);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setBusy(false);
    }
  }

  return (
    <Dialog onClose={onClose} title="Quick add" className="quick-add-dialog simple-entry-dialog">
      <p className="quick-add-intro">Add the essentials now. You can fill in more details later.</p>
      {permitted.length > 1 && (
        <Field>What do you want to add?
          <Select aria-label="Record type" value={kind} onChange={event => { setKind(event.target.value as QuickKind); reset(); setError(""); }}>
            {permitted.map(k => <option key={k} value={k}>{recordProfiles[k].noun}</option>)}
          </Select>
        </Field>
      )}

      <Form
        ref={form}
        noValidate
        onSubmit={(e) => { e.preventDefault(); void save(); }}
        className="quick-add-form"
      >
        {kind === "leads" && <InquiryCapture key={`${brand}:${branch}`} company={brand} branch={branch} preview={preview} onApply={applyInquiry}/>}
        {kind === "leads" && <div className="quick-add-row"><Field>Brand<Select aria-label="Lead brand" value={brand} onChange={e=>setBrand(e.target.value)}>{actor.companies.map(c=><option key={c} value={c}>{companyName(c)}</option>)}</Select></Field><Field>Assign to salesperson<Select aria-label="Assign to salesperson" value={assigneeId} onChange={e=>setAssigneeId(e.target.value)} disabled={peopleLoading}><option value="">Keep with me · assign later</option>{people.filter(p=>p.id!==actor.id).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field></div>}
        {kind === "leads" && <div className="muted small">{peopleLoading ? <SkeletonText lines={1}/> : peopleError || "The salesperson will see this lead in their own list. You keep a copy in Created by me."} {onManageTeam && <Button type="button" className="text-button" onClick={onManageTeam}>Add or manage team</Button>}</div>}
        {kind === "leads" && <div className="quick-add-row"><Field>Lead type<Select aria-label="Lead type" value={leadType} onChange={e=>setLeadType(e.target.value)}>{leadTypes.map(t=><option key={t}>{t}</option>)}</Select></Field><Field>Source<Select aria-label="Lead source" value={source} onChange={e=>setSource(e.target.value)}>{["Manual","Website","Email","WhatsApp","LinkedIn","Facebook","Instagram","Advertising","Referral","Trade event"].map(t=><option key={t}>{t}</option>)}</Select></Field></div>}
        <Field error={errorFor("name")}>
          {profile.nameLabel} *
          <Input
            ref={nameRef}
            name="name"
            value={name}
            onChange={(e) => { setName(e.target.value); revalidate("name", e.target.value, values); }}
            onBlur={(e) => blur("name", { ...values, name: e.target.value })}
          />
        </Field>
        <div className="quick-add-row">
          <Field>
            Contact person
            <Input value={contact} onChange={(e) => setContact(e.target.value)} />
          </Field>
          <Field error={errorFor("email")}>
            Email
            <Input
              name="email"
              inputMode="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); revalidate("email", e.target.value, values); }}
              onBlur={(e) => blur("email", { ...values, email: e.target.value })}
            />
          </Field>
        </div>
        <div className="quick-add-row">
          <Field>
            Product / interest
            <Input value={product} onChange={(e) => setProduct(e.target.value)} />
          </Field>
          {kind === "leads" && (
            <Field error={errorFor("amount")}>
              Estimated value (USD)
              <Input
                name="amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); revalidate("amount", e.target.value, values); }}
                onBlur={(e) => blur("amount", { ...values, amount: e.target.value })}
              />
            </Field>
          )}
        </div>

        {kind === "leads" && <div className="quick-add-row"><Field>Phone / WhatsApp<Input type="tel" aria-label="Phone / WhatsApp" value={phone} maxLength={50} onChange={e=>setPhone(e.target.value)}/></Field><Field>Follow-up date<Input type="date" aria-label="Follow-up date" value={due} onChange={(e) => setDue(e.target.value)} /></Field></div>}
        {kind === "leads" && captured && <div className="quick-add-row">
          <Field>Grade<Input aria-label="Grade" maxLength={160} value={grade} onChange={e=>setGrade(e.target.value)}/></Field>
          <Field>Destination<Input aria-label="Destination" maxLength={160} value={destination} onChange={e=>setDestination(e.target.value)}/></Field>
          <Field error={errorFor("quantity")}>Quantity<Input name="quantity" aria-label="Quantity" type="number" min={0} max={100000000} step="0.01" value={quantity} onChange={e=>{setQuantity(e.target.value);revalidate("quantity",e.target.value,values);}}/></Field>
          <Field error={errorFor("unit")}>Quantity unit<Input name="unit" aria-label="Quantity unit" maxLength={20} value={unit} onChange={e=>{setUnit(e.target.value);revalidate("unit",e.target.value,values);}}/></Field>
        </div>}
        <p className="muted small quick-add-note">
          Will save to {companyName(brand)} · Responsible: {people.find(p=>p.id===assigneeId)?.name || actor.name}. Only the name is required.
        </p>

        {error && (
          <div className="form-error" role="alert">
            <AlertCircle size={15} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* DialogActions portals into the dialog footer, outside this <Form>
            in the DOM, so the actions call save directly rather than relying
            on an implicit submit. Enter still works: onSubmit is intact. */}
        <DialogActions
          pending={busy}
          primary={{
            label: `Save ${profile.noun.toLowerCase()}`,
            pendingLabel: "Saving…",
            icon: <Plus size={16} aria-hidden="true" />,
            pending: busy,
            onClick: () => save(),
          }}
        />
      </Form>
    </Dialog>
  );
}
