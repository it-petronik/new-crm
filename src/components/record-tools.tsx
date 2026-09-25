"use client";
import { Button, Input, Textarea, Field } from "@/components/ui/controls";
import { businessStampShort } from "@/lib/gst";
import { check, required, number } from "@/lib/validation";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { ProductInput } from "./product-input";
import { activityProfile } from "@/lib/activity-profile";
import {
  money,
  outstanding,
  type RecordItem,
  type LineItem,
} from "@/lib/domain";
export function LineEditor({
  lines,
  onChange,
  products = [],
  currency = "USD",
  unit = "MT",
}: {
  lines: LineItem[];
  onChange: (lines: LineItem[]) => void;
  products?: RecordItem[];
  currency?: string;
  unit?: string;
}) {
  return (
    <section className="line-editor">
      <h3>Quotation items</h3>
      {lines.map((line, i) => (
        <div className="line-editor-row" key={i}>
          <Field>
            Product / Grade
            <ProductInput
              label={`Item ${i + 1} product`}
              value={line.description}
              products={products}
              currency={currency}
              unit={unit}
              onSelect={(product) =>
                onChange(
                  lines.map((l, n) =>
                    n === i
                      ? {
                          ...l,
                          description: product.title,
                          unitPriceCents: Math.round(product.amount * 100),
                          packaging: product.attributes?.packaging || "",
                        }
                      : l,
                  ),
                )
              }
              onChange={(value) =>
                onChange(
                  lines.map((l, n) =>
                    n === i ? { ...l, description: value } : l,
                  ),
                )
              }
            />
          </Field>
          <Field>
            Quantity
            <Input
              type="number"
              min="0.01"
              max="1000000"
              step="0.01"
              value={line.quantity}
              onChange={(e) =>
                onChange(
                  lines.map((l, n) =>
                    n === i ? { ...l, quantity: Number(e.target.value) } : l,
                  ),
                )
              }
              required
            />
          </Field>
          <Field>
            Packaging / Unit
            <Input
              aria-label={`Item ${i + 1} packaging`}
              placeholder={unit}
              maxLength={100}
              value={line.packaging || ""}
              onChange={(e) =>
                onChange(
                  lines.map((l, n) =>
                    n === i ? { ...l, packaging: e.target.value } : l,
                  ),
                )
              }
            />
          </Field>
          <Field>
            Unit price
            <Input
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              value={line.unitPriceCents / 100}
              onChange={(e) =>
                onChange(
                  lines.map((l, n) =>
                    n === i
                      ? {
                          ...l,
                          unitPriceCents: Math.round(
                            Number(e.target.value) * 100,
                          ),
                        }
                      : l,
                  ),
                )
              }
              required
            />
          </Field>
          {lines.length > 1 && (
            <Button
              type="button"
              className="icon-button"
              aria-label={`Remove item ${i + 1}`}
              onClick={() => onChange(lines.filter((_, n) => n !== i))}
            >
              <X size={14} />
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        className="secondary"
        disabled={lines.length >= 100}
        onClick={() =>
          onChange([
            ...lines,
            { description: "", quantity: 1, unitPriceCents: 0 },
          ])
        }
      >
        <Plus size={14} />
        Add item
      </Button>
    </section>
  );
}
export function RecordActivity({
  record,
  writable,
  busy,
  onAction,
}: {
  record: RecordItem;
  writable: boolean;
  busy: boolean;
  onAction: (
    action:
      | { action: "note"; text: string; due?: string }
      | { action: "payment"; amountCents: number; reference: string },
  ) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const profile = activityProfile(record.kind);
  if (record.kind === "accounts" && record.attributes?.entryType) return null;
  if (!profile && record.kind !== "accounts" && !record.notes?.length)
    return null;
  return (
    <section className="record-activity">
      <div className="activity-heading">
        <h3>
          {profile?.title ||
            (record.kind === "accounts"
              ? "Receipts & balance"
              : "Previous notes")}
        </h3>
        {writable && profile && (
          <Button
            className="secondary"
            type="button"
            aria-expanded={adding}
            onClick={() => setAdding(!adding)}
          >
            {adding ? "Cancel update" : profile.action}
          </Button>
        )}
      </div>
      {!!record.notes?.length && (
        <details className="note-history">
          <summary>
            View {record.notes.length} previous{" "}
            {record.notes.length === 1 ? "update" : "updates"}
          </summary>
          {record.notes?.map((n) => (
            <div className="record-note" key={n.id}>
              <b>{n.actor}</b>
              {/* Business time, not the browser's default locale — otherwise this
                  timestamp disagrees with the GST clock elsewhere on the page. */}
              <small>{businessStampShort(n.at)}</small>
              <p>{n.text}</p>
            </div>
          ))}
        </details>
      )}
      {writable && profile && adding && (
        <form
          noValidate
          onInput={(e) => {
            const name = (e.target as HTMLElement & { name?: string }).name;
            if (name) setFieldErrors((prev) => (prev[name] ? { ...prev, [name]: "" } : prev));
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            const noteError = check(String(data.get("note") ?? ""), [required(profile.label)]);
            if (noteError) {
              setFieldErrors({ note: noteError });
              setTimeout(() => (form.querySelector("[name=\"note\"]") as HTMLElement | null)?.focus(), 0);
              return;
            }
            setFieldErrors({});
            try {
              await onAction({
                action: "note",
                text: String(data.get("note")),
                due: String(data.get("followup") || "") || undefined,
              });
              form.reset();
              setError("");
              setAdding(false);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not save note.");
            }
          }}
        >
          <Field error={fieldErrors.note}>
            {profile.label}
            <Textarea
              name="note"
              maxLength={5000}
              placeholder="What happened? What comes next?"
              rows={2}
            />
          </Field>
          <div className="inline-form">
            {record.kind === "leads" && (
              <Field>
                Next follow-up
                <Input name="followup" type="date" />
              </Field>
            )}
            <Button className="secondary" disabled={busy}>
              {profile.action}
            </Button>
          </div>
        </form>
      )}
      {record.kind === "accounts" && (
        <>
          <div className="balance">
            <span>Outstanding balance</span>
            <strong>{money(outstanding(record), record.currency)}</strong>
          </div>
          {record.payments?.map((p) => (
            <div className="record-note" key={p.id}>
              <b>
                {money(p.amountCents / 100, record.currency)} · {p.reference}
              </b>
              <small>
                {p.actor} · {new Date(p.at).toLocaleDateString()}
              </small>
            </div>
          ))}
          {writable &&
            !["Draft", "Paid", "Cancelled"].includes(record.status) && (
              <form
                noValidate
                onInput={(e) => {
                  const name = (e.target as HTMLElement & { name?: string }).name;
                  if (name) setFieldErrors((prev) => (prev[name] ? { ...prev, [name]: "" } : prev));
                }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const data = new FormData(form);
                  // Immediate feedback only; the API re-checks the amount
                  // against what is actually outstanding.
                  const found: Record<string, string> = {};
                  const amountError = check(String(data.get("payment") ?? ""), [
                    required("An amount"),
                    number("The amount", { min: 0.01, max: outstanding(record) }),
                  ]);
                  if (amountError) found.payment = amountError;
                  const referenceError = check(String(data.get("reference") ?? ""), [
                    required("A reference"),
                  ]);
                  if (referenceError) found.reference = referenceError;
                  setFieldErrors(found);
                  const first = Object.keys(found)[0];
                  if (first) {
                    const el = form.querySelector("[name=\"" + first + "\"]");
                    setTimeout(() => (el as HTMLElement | null)?.focus(), 0);
                    return;
                  }
                  try {
                    await onAction({
                      action: "payment",
                      amountCents: Math.round(
                        Number(data.get("payment")) * 100,
                      ),
                      reference: String(data.get("reference")),
                    });
                    form.reset();
                    setError("");
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Could not record payment.",
                    );
                  }
                }}
              >
                <div className="form-grid">
                  <Field error={fieldErrors.payment}>
                    Amount received ({record.currency})
                    <Input name="payment" inputMode="decimal" />
                  </Field>
                  <Field error={fieldErrors.reference}>
                    Bank / Receipt reference
                    <Input name="reference" maxLength={160} />
                  </Field>
                </div>
                <p className="small muted">
                  Records an existing receipt; does not transfer money.
                </p>
                <Button className="primary" disabled={busy}>
                  Record payment
                </Button>
              </form>
            )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
