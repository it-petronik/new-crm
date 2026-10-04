"use client";
import { StatusBadge } from "./ui/status-badge";
import { companyName } from "@/lib/company-name";
import { PageHeader } from "./ui/layout";
import { check, required, minLength, number } from "@/lib/validation";
import { Pagination, ListFilters, ListEmpty, usePagination } from "./pagination";
import {
  Button,
  Input,
  Select,
  Textarea,
  Field,
  Dialog,
  DialogActions,
} from "@/components/ui/controls";
import { useState, useEffect } from "react";
import {
  CalendarDays,
  Monitor,
  Plus,
  Clock3,
  CheckCircle2,
} from "lucide-react";
import { type Actor, type RecordItem } from "@/lib/domain";
export default function MyRequests({
  actor,
  preview,
}: {
  actor: Actor;
  preview: boolean;
}) {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<"leave" | "it">("leave");
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const pagination = usePagination(records);
  useEffect(() => {
    if (preview) {
      try {
        setRecords(
          JSON.parse(
            localStorage.getItem("enercore-my-requests-preview") || "[]",
          ),
        );
      } catch {}
      setLoaded(true);
    } else {
      fetch("/api/my-requests")
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.error);
          setRecords(data.records);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoaded(true));
    }
  }, [preview]);
  return (
    <div className="requests-content">
      <PageHeader className="page-heading" title="My requests" description="Your time off, support requests, and decisions — all in one place." actions={<Button variant="primary" onClick={() => { setError(""); setFieldErrors({}); setFormOpen(true); }}><Plus size={16}/>New request</Button>} />
      <div className="module-metrics">
        <div className="mini-stat">
          <CalendarDays size={18} />
          <span>Total requests</span>
          <b>{records.length}</b>
        </div>
        <div className="mini-stat">
          <Clock3 size={18} />
          <span>Awaiting action</span>
          <b>
            {
              records.filter((r) =>
                ["Pending Approval", "Open", "In Progress"].includes(r.status),
              ).length
            }
          </b>
        </div>
        <div className="mini-stat">
          <CheckCircle2 size={18} />
          <span>Completed</span>
          <b>
            {
              records.filter((r) =>
                ["Approved", "Resolved", "Completed"].includes(r.status),
              ).length
            }
          </b>
        </div>
      </div>
      {formOpen && <Dialog title="New request" description="Choose what you need. We’ll send it to the right team." onClose={() => { if (!busy) setFormOpen(false); }} dismissOnOutside={false} className="request-create-dialog">
          <form
            id="self-service-request"
            noValidate
            className="request-form"
            onInput={(e) => {
              const name = (e.target as HTMLElement & { name?: string }).name;
              if (name) setFieldErrors((prev) => (prev[name] ? { ...prev, [name]: "" } : prev));
            }}
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              // Client-side only, for immediate feedback; the API re-checks.
              const found: Record<string, string> = {};
              const titleError = check(String(f.get("title") ?? ""), [
                required(kind === "leave" ? "Leave type" : "Issue summary"),
                minLength(kind === "leave" ? "Leave type" : "Issue summary", 2),
              ]);
              if (titleError) found.title = titleError;
              const dueError = check(String(f.get("due") ?? ""), [
                required(kind === "leave" ? "A start date" : "A date"),
              ]);
              if (dueError) found.due = dueError;
              if (kind === "leave") {
                const quantityError = check(String(f.get("quantity") ?? ""), [
                  required("Working days"),
                  number("Working days", { min: 1, max: 365 }),
                ]);
                if (quantityError) found.quantity = quantityError;
              }
              setFieldErrors(found);
              const first = Object.keys(found)[0];
              if (first) {
                const el = form.querySelector("[name=\"" + first + "\"]");
                setTimeout(() => (el as HTMLElement | null)?.focus(), 0);
                return;
              }
              setBusy(true);
              try {
                const body = {
                  kind,
                  title: String(f.get("title")),
                  company: String(f.get("company")),
                  branch: String(f.get("branch")),
                  due: String(f.get("due")),
                  quantity: Number(f.get("quantity") || 1),
                  detail: String(f.get("detail") || ""),
                };
                let record: RecordItem;
                if (preview) {
                  const now = new Date().toISOString();
                  record = {
                    ...body,
                    id: crypto.randomUUID(),
                    status: kind === "leave" ? "Pending Approval" : "Open",
                    ownerId: actor.id,
                    owner: actor.name,
                    contact: actor.name,
                    product: "",
                    amount: 0,
                    currency: "USD",
                    unit: kind === "leave" ? "days" : "request",
                    source: "Self-service",
                    createdAt: now,
                    updatedAt: now,
                  };
                } else {
                  const r = await fetch("/api/my-requests", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                  });
                  const data = await r.json();
                  if (!r.ok) throw new Error(data.error);
                  record = data.record;
                }
                const next = [record, ...records];
                setRecords(next);
                if (preview)
                  localStorage.setItem(
                    "enercore-my-requests-preview",
                    JSON.stringify(next),
                  );
                setError("");
                form.reset();
                setFormOpen(false);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Could not submit request.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="segmented">
              <Button
                type="button"
                className={kind === "leave" ? "selected" : ""}
                aria-pressed={kind === "leave"}
                onClick={() => { setKind("leave"); setError(""); setFieldErrors({}); }}
              >
                <CalendarDays size={15} /> Leave
              </Button>
              <Button
                type="button"
                className={kind === "it" ? "selected" : ""}
                aria-pressed={kind === "it"}
                onClick={() => { setKind("it"); setError(""); setFieldErrors({}); }}
              >
                <Monitor size={15} /> IT support
              </Button>
            </div>
            <div className="form-grid">
              <Field className={kind === "it" ? "full" : undefined} error={fieldErrors.title}>
                {kind === "leave" ? "Leave type" : "Issue summary"}
                <Input
                  name="title"
                  maxLength={160}
                  placeholder={
                    kind === "leave" ? "Annual leave" : "Describe the problem"
                  }
                />
              </Field>
              <Field>
                Company
                <Select name="company">
                  {actor.companies.map((c) => (
                    <option key={c} value={c}>
                      {companyName(c)}
                    </option>
                  ))}
                </Select>
              </Field>
              <input
                type="hidden"
                name="branch"
                value={actor.branches[0] || "Main"}
              />
              <Field error={fieldErrors.due}>
                {kind === "leave" ? "Start date" : "Needed by"}
                <Input name="due" type="date" />
              </Field>
              {kind === "leave" && (
                <Field error={fieldErrors.quantity}>
                  Working days
                  <Input name="quantity" inputMode="numeric" />
                </Field>
              )}
              <Field className="full">
                Details
                <Textarea name="detail" maxLength={5000} rows={3} placeholder={kind === "leave" ? "Anything your approver should know (optional)" : "What happened, and what help do you need?"} />
              </Field>
            </div>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <DialogActions pending={busy} onCancel={() => setFormOpen(false)} start={<span className="muted small">{kind === "leave" ? "Sent for approval after you submit." : "Sent to IT after you submit."}</span>} primary={{label:busy ? "Submitting…" : kind === "leave" ? "Request leave" : "Send to IT",type:"submit",form:"self-service-request",disabled:busy || !loaded}}/>
          </form>
        </Dialog>}
        <section className="panel request-history-panel">
          <div className="panel-heading">
            <h2>Your request history</h2>
            <span className="count">{records.length}</span>
          </div>
          {records.length > 0 && <ListFilters {...pagination} label="requests" />}
          {records.length ? (
            pagination.items.map((r) => (
              <div className="settings-row" key={r.id}>
                <span>
                  {r.title}
                  <small style={{ display: "block", marginTop: 6 }}>
                    {r.kind === "leave" ? "Leave" : "IT support"} · {companyName(r.company)} · {r.due}{r.kind === "leave" ? ` · ${r.quantity} ${r.quantity === 1 ? "day" : "days"}` : ""}
                  </small>
                </span>
                <StatusBadge status={r.status} />
              </div>
            ))
          ) : (
            <div className="empty">
              <CalendarDays />
              <h3>No requests yet</h3>
              <p>Need time off or a hand from IT? Create a request and follow its progress here.</p>
              <Button variant="secondary" onClick={() => setFormOpen(true)}><Plus size={15}/>Create your first request</Button>
            </div>
          )}
          {records.length > 0 && <ListEmpty {...pagination} label="requests" />}
          <Pagination {...pagination} label="requests" />
        </section>
    </div>
  );
}
