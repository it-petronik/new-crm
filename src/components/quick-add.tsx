"use client";
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Dialog, DialogActions, Field, Input } from "@/components/ui/controls";
import { useForm } from "@/components/ui/use-form";
import { required, email as emailRule, minLength, number } from "@/lib/validation";
import { AlertCircle } from "lucide-react";
import FollowUpControl from "./follow-up-control";
import { recordProfiles } from "@/lib/record-profiles";
import { followUpPresets, isoDate } from "@/lib/attention";
import { allowedModules, type Actor, type Kind, type Module, type RecordItem } from "@/lib/domain";

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
>;

/** The name a validation message should use for the record's title field. */
const profileLabel = (kind: QuickKind) => recordProfiles[kind].nameLabel;

export default function QuickAdd({
  actor,
  company,
  branch,
  onCreate,
  onClose,
  onOpenFullForm,
  initialKind,
}: {
  actor: Actor;
  company: string;
  branch: string;
  onCreate: (values: QuickAddValues) => Promise<void>;
  onClose: () => void;
  onOpenFullForm: (kind: Kind) => void;
  initialKind?: Kind;
}) {
  // Quick-add kinds are all modules too, so the module check is the access check.
  const permitted = QUICK_KINDS.filter((k) => allowedModules(actor).includes(k as Module));
  const [kind, setKind] = useState<QuickKind>(
    initialKind && (QUICK_KINDS as string[]).includes(initialKind)
      ? (initialKind as QuickKind)
      : permitted[0],
  );
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [product, setProduct] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState(followUpPresets()[1].date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const values = { name, contact, email, product, amount };
  const { form, errorFor, blur, revalidate, submit } = useForm(
    {
      name: [required(profileLabel(kind)), minLength(profileLabel(kind), 2)],
      email: [emailRule],
      amount: [number("Estimated value", { min: 0 })],
    },
    ["name", "email", "amount"],
  );

  useEffect(() => { nameRef.current?.focus(); }, []);

  if (!permitted.length) return null;
  const profile = recordProfiles[kind];

  async function save(openFull: boolean) {
    // Client validation is for speed of feedback only; the API re-checks
    // everything and remains the authority.
    if (!submit(values)) return;
    if (busy) return; // never submit twice
    setBusy(true);
    setError("");
    try {
      await onCreate({
        kind,
        company,
        branch,
        title: name.trim(),
        contact: contact.trim(),
        product: product.trim(),
        // Defaults the system can determine; the full form can refine them.
        quantity: 0,
        unit: profile.unit || "MT",
        amount: Number(amount) || 0,
        currency: "USD",
        due: due || isoDate(new Date()),
        detail: "",
        source: "Manual",
        ...(email.trim() ? { email: email.trim() } : {}),
      } as QuickAddValues);
      if (openFull) onOpenFullForm(kind);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setBusy(false);
    }
  }

  return (
    <Dialog onClose={onClose} title="Quick add" className="quick-add-dialog">
      {permitted.length > 1 && (
        <div className="quick-add-kinds" role="tablist" aria-label="Record type">
          {permitted.map((k) => (
            <Button
              key={k}
              role="tab"
              aria-selected={k === kind}
              className={`quick-add-kind${k === kind ? " is-active" : ""}`}
              onClick={() => setKind(k)}
            >
              {recordProfiles[k].noun}
            </Button>
          ))}
        </div>
      )}

      <form
        ref={form}
        noValidate
        onSubmit={(e) => { e.preventDefault(); void save(false); }}
        className="quick-add-form"
      >
        <Field error={errorFor("name")}>
          {profile.nameLabel}
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
          <Field error={errorFor("email")} hint={!email ? "Optional" : undefined}>
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
            <Field error={errorFor("amount")} hint={!amount ? "Optional" : undefined}>
              Estimated value
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

        <FollowUpControl
          compact
          busy={busy}
          onChoose={(date) => setDue(date)}
          onClear={() => setDue(isoDate(new Date()))}
        />
        <p className="muted small quick-add-note">
          Saved to {company} as {actor.name} · follow-up {due}
        </p>

        {error && (
          <div className="form-error" role="alert">
            <AlertCircle size={15} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* DialogActions portals its children into the dialog footer, which
            places them outside this <form> in the DOM. An implicit submit
            button therefore would not submit, so both actions call save
            directly. Enter still works: the form's onSubmit is intact. */}
        <DialogActions>
          <Button className="secondary" type="button" disabled={busy} onClick={() => void save(true)}>
            Save and add details
          </Button>
          <Button className="primary" type="button" disabled={busy} onClick={() => void save(false)}>
            <Plus size={16} /> {busy ? "Saving…" : `Save ${profile.noun.toLowerCase()}`}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
