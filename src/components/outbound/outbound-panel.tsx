"use client";
import {LoadingState} from "../ui/async-state";
import {requestJson,readJsonResponse} from "@/lib/client-request";
import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  FileText,
  Mail,
  MessageCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogActions,
  Field,
  Input,
  Select,
  Textarea,
} from "../ui/controls";
import { PageHeader } from "../ui/layout";
import type { Actor, RecordItem } from "@/lib/domain";
import {
  canCommunicate,
  labels,
  render,
  tokens,
  type Channel,
  type Message,
  type Template,
  type History,
} from "@/lib/outbound/model";
import { businessInstant, businessStamp, businessToday } from "@/lib/gst";
import styles from "./outbound.module.css";
type Data = {
  messages: Message[];
  templates: Template[];
  history: History[];
  manageCompanies: string[];
  truncated: boolean;
  connections: { company: string; email: string; whatsapp: string }[];
};
type Form = {
  type: "draft" | "template";
  id: string;
  company: string;
  recordId: string;
  channel: Channel;
  name: string;
  subject: string;
  body: string;
  templateId: string | null;
};
const emptyData: Data = {
  messages: [],
  templates: [],
  history: [],
  manageCompanies: [],
  truncated: false,
  connections: [],
};
export default function OutboundPanel({
  actor,
  records,
  preview,
}: {
  actor: Actor;
  records: RecordItem[];
  preview: boolean;
}) {
  const [data, setData] = useState<Data>(emptyData),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [tab, setTab] = useState("drafts"),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form | null>(null),
    [selected, setSelected] = useState<Message | null>(null),
    [schedule, setSchedule] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [date, setDate] = useState(businessToday()),
    [time, setTime] = useState("10:00"),
    [consent, setConsent] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const available = records.filter((r) => canCommunicate(actor, r));
  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await requestJson("/api/outbound", {
      cache: "no-store",
      signal,
    },"Your communication workspace couldn’t load. Please try again.");
    setData(result);
  }, []);
  useEffect(() => {
    const control = new AbortController();
    if (preview) {
      setLoading(false);
      return;
    }
    void load(control.signal)
      .catch((e) => {
        if (!control.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!control.signal.aborted) setLoading(false);
      });
    return () => control.abort();
  }, [load, preview]);
  async function act(value: unknown, success: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/outbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const result = await readJsonResponse(response,"We couldn’t confirm this update. Refresh to check its status before trying again.");
      if (!response.ok)
        throw new Error(result.error || "Could not save communication.");
      setForm(null);
      setSelected(null);
      setSchedule(null);
      setNotice(
        result.status === "captured"
          ? "Captured locally. No message was delivered."
          : result.status === "accepted"
            ? "Provider accepted the message. Delivery is not confirmed."
            : result.status === "uncertain"
              ? "Delivery is uncertain. Check the provider before doing anything else."
              : result.status === "rejected"
                ? "Provider rejected the submission. Inspect it before creating a replacement."
                : success,
      );
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Communication is unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  function open(type: Form["type"]) {
    setEditing(null);
    setError("");
    setNotice("");
    setForm({
      type,
      id: crypto.randomUUID(),
      company: data.manageCompanies[0] || actor.companies[0] || "",
      recordId: available[0]?.id || "",
      channel: "email",
      name: "",
      subject: "",
      body: "",
      templateId: null,
    });
  }
  const patch = (values: Partial<Form>) =>
    setForm((f) => f && { ...f, ...values });
  const record = available.find((r) => r.id === form?.recordId);
  const company = form?.type === "draft" ? record?.company : form?.company;
  const templates = data.templates.filter(
    (t) => t.company === company && t.channel === form?.channel,
  );
  const groups: Record<string, string[]> = {
    drafts: ["draft"],
    review: ["ready", "scheduled"],
    history: [
      "sending",
      "accepted",
      "captured",
      "uncertain",
      "rejected",
      "cancelled",
    ],
  };
  const shown = data.messages.filter(
    (m) =>
      groups[tab]?.includes(m.status) &&
      `${m.recordTitle} ${m.recipient} ${m.subject}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const connection =
    selected &&
    data.connections.find((c) => c.company === selected.company)?.[
      selected.channel
    ];
  return (
    <section className={styles.page}>
      <PageHeader
        title="Outbound communication"
        description="Prepare a thoughtful message. Review the recipient, then decide when to send."
        actions={
          <div className={styles.actions}>
            <Button
              className="secondary"
              disabled={busy || loading || preview}
              onClick={() => void load().catch((e) => setError(e.message))}
              aria-label="Refresh outbound"
            >
              <RefreshCw size={16} />
            </Button>
            {data.manageCompanies.length > 0 && (
              <Button
                className="secondary"
                disabled={busy}
                onClick={() => open("template")}
              >
                <FileText size={16} />
                New template
              </Button>
            )}
            <Button
              className="primary"
              disabled={busy || loading || preview || !available.length}
              onClick={() => open("draft")}
            >
              <Plus size={16} />
              New message
            </Button>
          </div>
        }
      />
      <div className={styles.safety}>
        <ShieldCheck size={20} />
        <div>
          <strong>You stay in control</strong>
          <p>
            Private drafts · no automatic sending · scheduled times are review
            reminders · no attachments while storage is on hold
          </p>
        </div>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      <div className={styles.connections}>
        {data.connections.map((c) => (
          <div key={c.company}>
            <strong>{c.company}</strong>
            <span>
              <Mail size={14} /> Email · {c.email}
            </span>
            <span>
              <MessageCircle size={14} /> WhatsApp · {c.whatsapp}
            </span>
          </div>
        ))}
      </div>
      {preview ? (
        <p>
          Communication requires a signed-in workspace. No messages are sent in
          browser preview.
        </p>
      ) : loading ? (
        <LoadingState label="Loading your communication" variant="cards"/>
      ) : (
        <>
          <div className={styles.toolbar}>
            <div
              className={styles.tabs}
              role="tablist"
              aria-label="Outbound views"
              onKeyDown={(e) => {
                const names = ["drafts", "review", "history", "templates"];
                const index = names.indexOf(tab);
                const next =
                  e.key === "ArrowRight"
                    ? (index + 1) % 4
                    : e.key === "ArrowLeft"
                      ? (index + 3) % 4
                      : e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? 3
                          : -1;
                if (next < 0) return;
                e.preventDefault();
                setTab(names[next]);
                document.getElementById(`outbound-tab-${names[next]}`)?.focus();
              }}
            >
              {[...["drafts", "review", "history"], "templates"].map((t) => (
                <button
                  key={t}
                  role="tab"
                  tabIndex={tab === t ? 0 : -1}
                  aria-selected={tab === t}
                  aria-controls="outbound-results"
                  id={`outbound-tab-${t}`}
                  onClick={() => setTab(t)}
                >
                  {t === "drafts"
                    ? "Drafts"
                    : t === "review"
                      ? "Review reminders"
                      : t === "history"
                        ? "History"
                        : "Templates"}
                  <span>
                    {t === "templates"
                      ? data.templates.length
                      : data.messages.filter((m) =>
                          groups[t]?.includes(m.status),
                        ).length}
                  </span>
                </button>
              ))}
            </div>
            <Input
              className={styles.search}
              aria-label="Search outbound"
              placeholder="Find a contact or message…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div
            id="outbound-results"
            role="tabpanel"
            aria-labelledby={`outbound-tab-${tab}`}
            className={styles.list}
          >
            {tab === "templates"
              ? data.templates
                  .filter((t) =>
                    `${t.name} ${t.company}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((t) => (
                    <article className={styles.row} key={t.id}>
                      <div className={styles.identity}>
                        <strong>{t.name}</strong>
                        <span>
                          {t.company} · {t.channel}
                        </span>
                        <p>{t.body}</p>
                      </div>
                      {data.manageCompanies.includes(t.company) && (
                        <Button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              {
                                action: "archive-template",
                                id: t.id,
                                version: t.version,
                              },
                              "Template archived. Existing message snapshots were preserved.",
                            )
                          }
                        >
                          Archive template
                        </Button>
                      )}
                    </article>
                  ))
              : shown.map((m) => (
                  <article key={m.id} className={styles.row}>
                    <span className={styles.icon}>
                      {m.channel === "email" ? (
                        <Mail size={18} />
                      ) : (
                        <MessageCircle size={18} />
                      )}
                    </span>
                    <div className={styles.identity}>
                      <strong>{m.subject || m.recordTitle}</strong>
                      <span>
                        {m.recordTitle} · {m.company}
                      </span>
                      <span>{m.recipient}</span>
                      {m.scheduledAt && (
                        <small>
                          <CalendarClock size={13} />
                          Review {businessStamp(new Date(m.scheduledAt))}
                        </small>
                      )}
                    </div>
                    <div className={styles.rowEnd}>
                      <span className={styles.badge} data-state={m.status}>
                        {labels[m.status] || m.status}
                      </span>
                      <Button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setSelected(m);
                          setConsent("");
                          setConfirmed(false);
                          setError("");
                        }}
                      >
                        Open message
                      </Button>
                    </div>
                  </article>
                ))}
            {(tab === "templates" ? !data.templates.length : !shown.length) && (
              <div className={styles.empty}>
                <Mail size={28} />
                <h2>
                  {query
                    ? "No matching messages"
                    : "A clear place for your next conversation"}
                </h2>
                <p>
                  {tab === "templates"
                    ? "A manager can create reusable company templates using the supported fields."
                    : "Create a record-linked draft. Nothing leaves the workspace until you review and confirm."}
                </p>
              </div>
            )}
          </div>
          {data.truncated && (
            <p>
              Showing your latest 200 message entries. Older history remains
              stored.
            </p>
          )}
        </>
      )}
      {form && (
        <Dialog
          title={
            form.type === "template"
              ? "Create company template"
              : "Prepare a message"
          }
          description={
            form.type === "template"
              ? "New templates are immutable revisions. Archive an old template when replacing it."
              : "Recipient comes from the CRM record and is checked again before submission."
          }
          onClose={() => {
            if (!busy) setForm(null);
          }}
          dismissOnOutside={false}
        >
          <form
            id="outbound-form"
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                form.type === "template"
                  ? {
                      action: "template",
                      id: form.id,
                      company: form.company,
                      name: form.name,
                      channel: form.channel,
                      subject: form.subject,
                      body: form.body,
                    }
                  : editing
                    ? {
                        action: "edit",
                        id: editing.id,
                        version: editing.version,
                        subject: form.subject,
                        body: form.body,
                      }
                    : {
                        action: "draft",
                        id: form.id,
                        recordId: form.recordId,
                        channel: form.channel,
                        templateId: form.templateId,
                        subject: form.subject,
                        body: form.body,
                      },
                form.type === "template"
                  ? "Company template saved. This does not approve a WhatsApp template with Meta."
                  : "Draft saved privately. Nothing was sent.",
              );
            }}
          >
            {form.type === "template" ? (
              <>
                <Field>
                  Company
                  <Select
                    value={form.company}
                    onChange={(e) => patch({ company: e.target.value })}
                  >
                    {data.manageCompanies.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
                <Field>
                  Template name
                  <Input
                    required
                    maxLength={80}
                    value={form.name}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </Field>
              </>
            ) : (
              <Field>
                Linked CRM record
                <Select
                  disabled={!!editing}
                  required
                  value={form.recordId}
                  onChange={(e) =>
                    patch({
                      recordId: e.target.value,
                      templateId: null,
                      body: "",
                      subject: "",
                    })
                  }
                >
                  {available.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} · {r.company} · {r.kind}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field>
              Channel
              <Select
                disabled={!!editing}
                value={form.channel}
                onChange={(e) =>
                  patch({
                    channel: e.target.value as Channel,
                    templateId: null,
                    body: "",
                    subject: "",
                  })
                }
              >
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
              </Select>
            </Field>
            {form.type === "draft" && (
              <>
                <p className={styles.hint}>
                  Recipient:{" "}
                  {editing?.recipient ||
                    (form.channel === "email"
                      ? record?.email || "Add email to the CRM record first"
                      : record?.phone ||
                        "Add an international phone number to the CRM record first")}
                </p>
                {!editing && (
                  <Field>
                    Use a template
                    <Select
                      value={form.templateId || "none"}
                      onChange={(e) => {
                        const t = templates.find(
                          (t) => t.id === e.target.value,
                        );
                        patch(
                          t && record
                            ? {
                                templateId: t.id,
                                subject: render(t.subject, record, actor),
                                body: render(t.body, record, actor),
                              }
                            : { templateId: null },
                        );
                      }}
                    >
                      <option value="none">Write your own message</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </>
            )}
            {form.channel === "email" && (
              <Field>
                Subject
                <Input
                  required
                  maxLength={200}
                  value={form.subject}
                  onChange={(e) => patch({ subject: e.target.value })}
                />
              </Field>
            )}
            <Field>
              Message
              <Textarea
                required
                rows={6}
                maxLength={4000}
                value={form.body}
                onChange={(e) => patch({ body: e.target.value })}
              />
            </Field>
            {form.type === "template" && (
              <p className={styles.hint}>
                Supported fields: {tokens.map((t) => `{{${t}}}`).join(" · ")}.
                WhatsApp templates also require separate Meta approval and
                server-side mapping.
              </p>
            )}
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <DialogActions
              pending={busy}
              onCancel={() => setForm(null)}
              primary={{
                label: "Save privately",
                type: "submit",
                form: "outbound-form",
                disabled: busy,
              }}
            />
          </form>
        </Dialog>
      )}
      {selected && (
        <Dialog
          title="Review message"
          description={`${selected.company} · ${selected.channel} · ${labels[selected.status]}`}
          onClose={() => {
            if (!busy) setSelected(null);
          }}
          dismissOnOutside={false}
        >
          <div className={styles.form}>
            <dl className={styles.details}>
              <dt>To</dt>
              <dd>{selected.recipient}</dd>
              <dt>Linked record</dt>
              <dd>{selected.recordTitle}</dd>
              {selected.subject && (
                <>
                  <dt>Subject</dt>
                  <dd>{selected.subject}</dd>
                </>
              )}
            </dl>
            <div className={styles.preview}>{selected.body}</div>
            {selected.canAct &&
              ["draft", "ready", "scheduled"].includes(selected.status) && (
                <>
                  <div className={styles.actions}>
                    <Button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setSchedule(selected);
                        setSelected(null);
                      }}
                    >
                      Schedule review
                    </Button>
                    {selected.status !== "ready" && (
                      <Button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            {
                              action: "ready",
                              id: selected.id,
                              version: selected.version,
                            },
                            "Ready for review. Open the message again to confirm sending.",
                          )
                        }
                      >
                        Mark ready
                      </Button>
                    )}
                    <Button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setForm({
                          type: "draft",
                          id: selected.id,
                          company: selected.company,
                          recordId: selected.recordId,
                          channel: selected.channel,
                          name: "",
                          subject: selected.subject,
                          body: selected.body,
                          templateId: selected.templateId,
                        });
                        setSelected(null);
                        setEditing(selected);
                      }}
                    >
                      Edit draft
                    </Button>
                    <Button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          {
                            action: "cancel",
                            id: selected.id,
                            version: selected.version,
                          },
                          "Draft cancelled. Nothing was sent.",
                        )
                      }
                    >
                      Cancel message
                    </Button>
                  </div>
                  {selected.status === "ready" && (
                    <>
                      <p className={styles.hint}>
                        {connection === "sandbox"
                          ? "Local test capture only. No external message will be delivered."
                          : connection === "configured"
                            ? "Sending uses this company's configured provider. Provider acceptance does not confirm delivery."
                            : "No provider is connected for this company. You can save drafts; sending stays disabled."}
                      </p>
                      <Field>
                        Permission / opt-in evidence
                        <Textarea
                          rows={2}
                          maxLength={500}
                          placeholder="How and when this contact agreed to this message"
                          value={consent}
                          onChange={(e) => setConsent(e.target.value)}
                        />
                      </Field>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(e) => setConfirmed(e.target.checked)}
                        />
                        I checked the recipient, message and permission to
                        contact them.
                      </label>
                      <Button
                        className="primary"
                        disabled={
                          busy ||
                          !confirmed ||
                          consent.trim().length < 8 ||
                          connection === "disconnected" ||
                          !connection
                        }
                        onClick={() =>
                          void act(
                            {
                              action: "send",
                              id: selected.id,
                              version: selected.version,
                              confirmed: true,
                              consent,
                            },
                            "",
                          )
                        }
                      >
                        {connection === "sandbox"
                          ? "Confirm test capture"
                          : "Confirm and send"}
                      </Button>
                    </>
                  )}
                </>
              )}
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <h3>Message history</h3>
            <ol className={styles.history}>
              {data.history
                .filter((h) => h.messageId === selected.id)
                .map((h) => (
                  <li key={h.id}>
                    <strong>{h.action}</strong>
                    <span>{businessStamp(new Date(h.at))}</span>
                  </li>
                ))}
            </ol>
            {selected.providerId && (
              <p className={styles.hint}>
                Provider reference: {selected.providerId}
              </p>
            )}
          </div>
        </Dialog>
      )}
      {schedule && (
        <Dialog
          title="Schedule a review reminder"
          description="Dubai time (GST). This does not schedule automatic delivery."
          onClose={() => {
            if (!busy) setSchedule(null);
          }}
        >
          <div className={styles.form}>
            <Field>
              Review date
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={businessToday()}
              />
            </Field>
            <Field>
              Review time
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </Field>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <DialogActions
              pending={busy}
              onCancel={() => setSchedule(null)}
              primary={{
                label: "Schedule review",
                disabled: busy,
                onClick: () => {
                  const at = businessInstant(date, time)?.getTime();
                  if (!at) {
                    setError("Choose a valid date and time.");
                    return;
                  }
                  void act(
                    {
                      action: "schedule",
                      id: schedule.id,
                      version: schedule.version,
                      at,
                    },
                    "Review reminder scheduled. No automatic message will be sent.",
                  );
                },
              }}
            />
          </div>
        </Dialog>
      )}
    </section>
  );
}
