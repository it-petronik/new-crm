"use client";
import { useEffect, useState } from "react";
import { Button, Field, Input, Select } from "../ui/controls";
import type { Contact } from "@/lib/commercial/model";
import type { RecordItem } from "@/lib/domain";
export async function commercialCall<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/commercial", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not save.");
  return data;
}
export function RecordPicker({
  kind,
  company,
  branch,
  label,
  onSelect,
}: {
  kind: "customers" | "products";
  company: string;
  branch: string;
  label: string;
  onSelect: (id: string, title: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<{ id: string; label: string }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setRows([]);
    if (query.trim().length < 2) return () => controller.abort();
    const p = new URLSearchParams({ q: query, kind, company, branch });
    fetch(`/api/commercial?${p}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        return d;
      })
      .then((d) => {
        setRows(d.results);
        setError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError("Search unavailable. Try again.");
      });
    return () => controller.abort();
  }, [query, kind, company, branch]);
  return (
    <div className="commercial-picker">
      <Field>
        {label}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type at least 2 characters"
          autoComplete="off"
        />
      </Field>
      {error && <p role="alert">{error}</p>}
      {rows.length > 0 && (
        <ul className="commercial-results">
          {rows.map((r) => (
            <li key={r.id}>
              <Button
                type="button"
                className="secondary"
                onClick={() => {
                  onSelect(r.id, r.label);
                  setQuery("");
                  setRows([]);
                }}
              >
                {r.label}
                <small>Ref {r.id.slice(-8)}</small>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export function CustomerSelection({
  company,
  branch,
  customerId,
  customerName,
  contactId,
  onChange,
  onCreated,
}: {
  company: string;
  branch: string;
  customerId: string | null;
  customerName?: string;
  contactId: string | null;
  onChange: (
    customerId: string | null,
    contactId: string | null,
    title?: string,
  ) => void;
  onCreated?: (r: RecordItem) => void;
}) {
  const [people, setPeople] = useState<Contact[]>([]);
  const [quick, setQuick] = useState(false);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [person, setPerson] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [possible, setPossible] = useState<
    { id: string; title: string; reasons: string[] }[]
  >([]);
  useEffect(() => {
    let alive = true;
    setPeople([]);
    if (customerId)
      fetch(
        `/api/commercial?view=contacts&id=${encodeURIComponent(customerId)}`,
      )
        .then((r) => r.json())
        .then((d) => {
          if (alive) setPeople(d.contacts || []);
        })
        .catch(() => {
          if (alive) setError("Contacts could not be loaded.");
        });
    return () => {
      alive = false;
    };
  }, [customerId]);
  async function create(createAnyway = false) {
    setBusy(true);
    setError("");
    try {
      const d = await commercialCall<{
        record?: RecordItem;
        duplicates?: typeof possible;
      }>({
        action: "customer",
        company,
        branch,
        title: name,
        country,
        contactName: person,
        email,
        phone,
        requestId,
        createAnyway,
      });
      if (d.duplicates) {
        setPossible(d.duplicates);
        return;
      }
      if (d.record) {
        onChange(
          d.record.id,
          d.record.primaryContactId || null,
          d.record.title,
        );
        onCreated?.(d.record);
        setQuick(false);
        setRequestId(crypto.randomUUID());
        setPossible([]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="commercial-selection">
      <RecordPicker
        kind="customers"
        company={company}
        branch={branch}
        label="Search customer"
        onSelect={(id, title) => onChange(id, null, title)}
      />
      {customerId && (
        <>
          <p className="muted small">
            Selected customer: <strong>{customerName || "Customer selected"}</strong>{" "}
            <Button
              type="button"
              className="secondary compact"
              onClick={() => onChange(null, null)}
            >
              Clear selection
            </Button>
          </p>
          <Field>
            Contact
            <Select
              value={contactId || "__none"}
              onChange={(e) => onChange(customerId, e.target.value === "__none" ? null : e.target.value)}
            >
              <option value="__none">No contact selected</option>
              {people
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.role || "Contact"}
                  </option>
                ))}
            </Select>
          </Field>
        </>
      )}
      <Button
        type="button"
        className="secondary compact"
        onClick={() => setQuick(!quick)}
      >
        Create customer
      </Button>
      {quick && (
        <div className="form-grid">
          <Field>
            Company name
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setPossible([]);
              }}
            />
          </Field>
          <Field>
            Country (optional)
            <Input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </Field>
          <Field>
            Contact name (optional)
            <Input value={person} onChange={(e) => setPerson(e.target.value)} />
          </Field>
          <Field>
            Email (optional)
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field>
            Phone (optional)
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          {possible.length > 0 && (
            <div className="field-wide">
              <p>Possible existing customer</p>
              {possible.map((p) => (
                <div key={p.id}>
                  <strong>{p.title}</strong>
                  <p className="muted">{p.reasons.join(" · ")}</p>
                  <Button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      onChange(p.id, null, p.title);
                      setQuick(false);
                    }}
                  >
                    Use existing
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                disabled={busy}
                onClick={() => void create(true)}
              >
                Create anyway
              </Button>
            </div>
          )}
          {!possible.length && (
            <Button
              type="button"
              disabled={busy || name.trim().length < 2}
              onClick={() => void create()}
            >
              Save customer
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
