"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Select } from "./ui/controls";
import {
  bankDetailsSchema,
  bankFieldLabels,
  bankMutationSchema,
  bankSnapshot,
  canUseBankAccounts,
  type SavedBankAccount,
} from "@/lib/bank-accounts";
import type { Actor } from "@/lib/domain";
import { friendlyError, requestJson } from "@/lib/client-request";

/** Saved templates are copied into draft inputs; documents never reference a
 * mutable bank row. Live account details are never persisted in browser storage. */
export function BankAccountFields({
  actor,
  company,
  currency,
  live,
  initial,
}: {
  actor: Actor;
  company: string;
  currency: string;
  live: boolean;
  initial?: Record<string, string>;
}) {
  const [details, setDetails] = useState(() => bankSnapshot(initial));
  const [accounts, setAccounts] = useState<SavedBankAccount[]>([]);
  const [selected, setSelected] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const requestId = useRef("");
  const previousCurrency = useRef(currency);
  const previewKey = `enercore-preview-banks:${actor.id}:${company}`;
  const canManage = canUseBankAccounts(actor, company, true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    async function load() {
      try {
        const rows = live
          ? (
              await requestJson<{ accounts: SavedBankAccount[] }>(
                `/api/bank-accounts?company=${encodeURIComponent(company)}`,
              )
            ).accounts
          : (JSON.parse(
              localStorage.getItem(previewKey) || "[]",
            ) as SavedBankAccount[]);
        if (active)
          setAccounts(
            rows.filter(
              (row) =>
                row.company === company &&
                bankMutationSchema.safeParse(row).success,
            ),
          );
      } catch (e) {
        if (active)
          setError(
            friendlyError(
              e,
              "We couldn’t load saved bank accounts. You can still enter draft details below.",
            ),
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [company, live, previewKey, revision]);
  useEffect(() => {
    if (previousCurrency.current !== currency && selected) {
      setDetails(bankSnapshot());
      setLabel("");
      setMessage(
        "Currency changed. Select a matching saved account or enter new bank details.",
      );
    }
    previousCurrency.current = currency;
    setSelected("");
  }, [currency]);
  async function save(update: boolean) {
    if (saving || loading || !canManage) return;
    const existing = accounts.find((a) => a.id === selected);
    if (update && (!existing || existing.currency !== currency)) return;
    if (!label.trim() || !bankDetailsSchema.safeParse(details).success) {
      setError(
        "Enter a saved account label, bank name, account holder and account number first.",
      );
      return;
    }
    requestId.current ||= crypto.randomUUID();
    const value = bankMutationSchema.safeParse({
      id: update ? existing!.id : requestId.current,
      company,
      label: label.trim(),
      currency,
      details,
      ...(update ? { version: existing!.version } : {}),
    });
    if (!value.success) {
      setError(
        "Check the account details and use a label of 80 characters or fewer.",
      );
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      let account: SavedBankAccount;
      if (live) {
        account = (
          await requestJson<{ account: SavedBankAccount }>(
            "/api/bank-accounts",
            {
              method: update ? "PATCH" : "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(value.data),
            },
          )
        ).account;
      } else {
        const stored: SavedBankAccount[] = JSON.parse(
          localStorage.getItem(previewKey) || "[]",
        );
        const previous = stored.find((a) => a.id === value.data.id);
        if (update && previous?.version !== existing!.version)
          throw new Error(
            "Someone changed this saved account. Reload the list before editing it.",
          );
        account = { ...value.data, version: (previous?.version || 0) + 1 };
        localStorage.setItem(
          previewKey,
          JSON.stringify([
            ...stored.filter((a) => a.id !== account.id),
            account,
          ]),
        );
      }
      setAccounts((rows) =>
        [...rows.filter((a) => a.id !== account.id), account].sort((a, b) =>
          a.label.localeCompare(b.label),
        ),
      );
      setSelected(account.id);
      requestId.current = "";
      setMessage(
        update
          ? "Saved account updated. Existing documents have not changed."
          : "Bank account saved. You can select it in future drafts.",
      );
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="span-all bank-account-fields">
      <div className="proforma-grid">
        <Field className="span-all">
          Saved Bank Account
          <Select
            value={selected}
            disabled={loading || saving}
            onChange={(e) => {
              const account = accounts.find((a) => a.id === e.target.value);
              setSelected(account?.id || "");
              setMessage("");
              setError("");
              requestId.current = "";
              if (account) {
                setDetails({ ...account.details });
                setLabel(account.label);
              } else setLabel("");
            }}
          >
            <option value="">
              {loading ? "Loading saved accounts…" : "Enter details manually"}
            </option>
            {accounts
              .filter((a) => a.currency === currency)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.currency} · Ending{" "}
                  {a.details.bankAccountNumber.slice(-4)}
                </option>
              ))}
          </Select>
        </Field>
        <p className="span-all muted small">
          {live
            ? "Shared with authorized finance users in this company."
            : "Preview only — saved on this browser, not the live workspace."}{" "}
          Only {currency} accounts are shown. Selecting one copies its details
          into this draft.
        </p>
        {Object.entries(bankFieldLabels).map(([name, title]) => (
          <Field key={name}>
            {title}
            <Input
              name={name}
              value={details[name as keyof typeof details]}
              readOnly={saving}
              maxLength={160}
              autoComplete="off"
              onChange={(e) => {
                setDetails((d) => ({ ...d, [name]: e.target.value }));
                requestId.current = "";
                setMessage("");
              }}
            />
          </Field>
        ))}
        {canManage && (
          <Field className="span-all">
            Saved Account Label{" "}
            <Input
              value={label}
              disabled={saving}
              maxLength={80}
              placeholder="For example, Main USD Account"
              onChange={(e) => {
                setLabel(e.target.value);
                requestId.current = "";
              }}
            />
          </Field>
        )}
      </div>
      <div className="bank-account-actions">
        {canManage && (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={saving || loading}
              onClick={() => void save(false)}
            >
              Save As New Account
            </Button>
            {selected && (
              <Button
                type="button"
                variant="secondary"
                disabled={saving || loading}
                onClick={() => void save(true)}
              >
                Update Selected Account
              </Button>
            )}
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={saving || loading}
          onClick={() => {
            setSelected("");
            setRevision((v) => v + 1);
          }}
        >
          Reload Saved Accounts
        </Button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="muted small" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
