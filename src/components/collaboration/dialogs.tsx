"use client";

import { useEffect, useState } from "react";
import { Check, Hash, Search, Users, X } from "lucide-react";
import {
  ROOM_DESCRIPTION_MAX,
  ROOM_NAME_MAX,
  ROOM_NAME_MIN,
  type ConversationSummary,
  type DiscoverableRoom,
  type Person,
  type RoomVisibility,
} from "@/lib/collab";
import type { Actor } from "@/lib/domain";
import { companyName } from "@/lib/company-name";
import { collabFetch } from "@/lib/collab-client";
import { Button, Dialog, DialogActions, Field, Input, Select, Textarea } from "../ui/controls";
import { Avatar } from "../avatar";
import { SkeletonListRow } from "../ui/skeleton";

/* ------------------------------------------------------------ people picker */

/**
 * Searches colleagues through the server, which decides who is eligible
 * (active, in scope, not already a member). The picker never sees anyone the
 * server did not offer.
 */
function PeoplePicker({
  query,
  multiple,
  selected,
  onChange,
  exclude = [],
  autoFocus = false,
}: {
  /** Extra search parameters, e.g. `company=X` or `conversationId=Y`. */
  query: string;
  multiple: boolean;
  selected: Person[];
  onChange: (people: Person[]) => void;
  exclude?: string[];
  /** Only when the search is the dialog's first field. */
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Person[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      collabFetch<{ people: Person[] }>(`/people?q=${encodeURIComponent(q)}${query ? `&${query}` : ""}`)
        .then((r) => {
          if (!cancelled) {
            setResults(r.people);
            setError("");
          }
        })
        .catch((e: Error) => {
          if (!cancelled) {
            setResults([]);
            setError(e.message);
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, query]);

  const toggle = (p: Person) => {
    if (!multiple) return onChange([p]);
    onChange(selected.some((s) => s.id === p.id) ? selected.filter((s) => s.id !== p.id) : [...selected, p]);
  };
  const shown = (results ?? []).filter((p) => !exclude.includes(p.id));

  return (
    <div className="collab-picker">
      {multiple && selected.length > 0 && (
        <div className="collab-picker-chips">
          {selected.map((p) => (
            <span key={p.id} className="collab-chip">
              {p.name}
              <button type="button" aria-label={`Remove ${p.name}`} onClick={() => toggle(p)}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="collab-search">
        <Search size={15} aria-hidden="true" />
        <Input
          aria-label="Search people"
          placeholder="Search by name or role"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus={autoFocus}
        />
      </div>
      <ul className="collab-picker-list" aria-label="People">
        {results === null ? (
          <>
            <li><SkeletonListRow /></li>
            <li><SkeletonListRow /></li>
            <li><SkeletonListRow /></li>
          </>
        ) : shown.length ? (
          shown.map((p) => {
            const on = selected.some((s) => s.id === p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={on ? "is-selected" : ""}
                  aria-pressed={on}
                  onClick={() => toggle(p)}
                >
                  <Avatar name={p.name} size={30} />
                  <span>
                    {p.name}
                    <small>{p.role}</small>
                  </span>
                  {on && <Check size={16} aria-hidden="true" />}
                </button>
              </li>
            );
          })
        ) : (
          <li className="collab-picker-empty">{error || (q ? "No one matches that search." : "No one available.")}</li>
        )}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- new DM */

export function NewDirectDialog({
  onClose,
  onOpened,
}: {
  onClose: () => void;
  onOpened: (conversation: ConversationSummary) => void;
}) {
  const [selected, setSelected] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = async (person: Person) => {
    setBusy(true);
    setError("");
    try {
      const { conversation } = await collabFetch<{ conversation: ConversationSummary }>("/conversations", {
        method: "POST",
        body: { kind: "direct", userId: person.id },
      });
      onOpened(conversation);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog title="New message" onClose={onClose} className="dialog-compact collab-dialog">
      <PeoplePicker
        query=""
        autoFocus
        multiple={false}
        selected={selected}
        onChange={(people) => {
          setSelected(people);
          if (people[0]) void start(people[0]);
        }}
      />
      {busy && <p className="collab-dialog-text">Opening conversation…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}

/* ------------------------------------------------------------- new room */

export function NewRoomDialog({
  actor,
  onClose,
  onCreated,
}: {
  actor: Actor;
  onClose: () => void;
  onCreated: (conversation: ConversationSummary) => void;
}) {
  const branchScoped = actor.branches.length > 0;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<RoomVisibility>("private");
  const [company, setCompany] = useState(actor.companies[0] ?? "");
  const [branch, setBranch] = useState(branchScoped ? actor.branches[0] : "");
  const [members, setMembers] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const trimmed = name.trim();
  const nameError =
    trimmed && (trimmed.length < ROOM_NAME_MIN || trimmed.length > ROOM_NAME_MAX)
      ? `Use ${ROOM_NAME_MIN}–${ROOM_NAME_MAX} characters.`
      : "";
  const scopeQuery = `company=${encodeURIComponent(company)}${branch.trim() ? `&branch=${encodeURIComponent(branch.trim())}` : ""}`;

  const create = async () => {
    if (!trimmed || nameError) {
      setError(nameError || "Give the room a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { conversation } = await collabFetch<{ conversation: ConversationSummary }>("/conversations", {
        method: "POST",
        body: {
          kind: "room",
          name: trimmed,
          description: description.trim(),
          visibility,
          company,
          branch: branch.trim() || null,
          memberIds: members.map((m) => m.id),
        },
      });
      onCreated(conversation);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title="New room" onClose={onClose} className="dialog-compact collab-dialog">
      <div className="collab-form">
        <Field error={nameError}>
          Room name
          <Input
            value={name}
            maxLength={ROOM_NAME_MAX}
            placeholder="e.g. Dubai logistics"
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <Field hint="Optional. What the room is for.">
          Description
          <Textarea
            value={description}
            maxLength={ROOM_DESCRIPTION_MAX}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="collab-form-row">
          <Field>
            Company
            <Select
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setMembers([]);
              }}
            >
              {actor.companies.map((c) => (
                <option key={c} value={c}>
                  {companyName(c)}
                </option>
              ))}
            </Select>
          </Field>
          {branchScoped ? (
            <Field>
              Branch
              <Select
                value={branch}
                onChange={(e) => {
                  setBranch(e.target.value);
                  setMembers([]);
                }}
              >
                {actor.branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field hint="Leave blank for the whole company.">
              Branch
              <Input
                value={branch}
                maxLength={80}
                placeholder="Whole company"
                onChange={(e) => {
                  setBranch(e.target.value);
                  setMembers([]);
                }}
              />
            </Field>
          )}
        </div>
        <fieldset className="collab-visibility">
          <legend>Who can find it</legend>
          <label className={visibility === "private" ? "is-selected" : ""}>
            <input
              type="radio"
              name="visibility"
              checked={visibility === "private"}
              onChange={() => setVisibility("private")}
            />
            <span>
              <b>Private</b>
              <small>Only people you add can see it.</small>
            </span>
          </label>
          <label className={visibility === "workspace" ? "is-selected" : ""}>
            <input
              type="radio"
              name="visibility"
              checked={visibility === "workspace"}
              onChange={() => setVisibility("workspace")}
            />
            <span>
              <b>Workspace</b>
              <small>Anyone in this company{branch.trim() ? " branch" : ""} can find and join.</small>
            </span>
          </label>
        </fieldset>
        <div className="collab-form-label">Add people</div>
        <PeoplePicker query={scopeQuery} multiple selected={members} onChange={setMembers} />
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <DialogActions>
        <Button className="primary" loading={busy} onClick={() => void create()}>
          Create room
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ---------------------------------------------------------- browse rooms */

export function BrowseRoomsDialog({
  onClose,
  onJoined,
}: {
  onClose: () => void;
  onJoined: (id: string) => void;
}) {
  const [rooms, setRooms] = useState<DiscoverableRoom[] | null>(null);
  const [q, setQ] = useState("");
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    collabFetch<{ rooms: DiscoverableRoom[] }>("/conversations?discover=1")
      .then((r) => setRooms(r.rooms))
      .catch((e: Error) => {
        setRooms([]);
        setError(e.message);
      });
  }, []);
  const join = async (id: string) => {
    setJoining(id);
    setError("");
    try {
      await collabFetch(`/conversations/${id}/members`, { method: "POST", body: { join: true } });
      onJoined(id);
    } catch (e) {
      setError((e as Error).message);
      setJoining(null);
    }
  };
  const shown = (rooms ?? []).filter(
    (r) => !q || `${r.title} ${r.description ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Dialog title="Browse rooms" onClose={onClose} className="dialog-compact collab-dialog">
      <div className="collab-search">
        <Search size={15} aria-hidden="true" />
        <Input aria-label="Search rooms" placeholder="Search rooms" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="collab-browse">
        {rooms === null ? (
          <>
            <li><SkeletonListRow /></li>
            <li><SkeletonListRow /></li>
          </>
        ) : shown.length ? (
          shown.map((r) => (
            <li key={r.id}>
              <span className="collab-room-icon" aria-hidden="true">
                <Hash size={15} />
              </span>
              <span className="collab-browse-main">
                <b>{r.title}</b>
                <small>
                  {[r.description, `${r.memberCount} ${r.memberCount === 1 ? "member" : "members"}`, r.branch ? `${companyName(r.company)} · ${r.branch}` : companyName(r.company)]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
              <Button className="secondary compact" loading={joining === r.id} onClick={() => void join(r.id)}>
                Join
              </Button>
            </li>
          ))
        ) : (
          <li className="collab-picker-empty">
            {error || (q ? "No rooms match that search." : "There are no open rooms to join right now.")}
          </li>
        )}
      </ul>
    </Dialog>
  );
}

/* ----------------------------------------------------------- add people */

export function AddMembersDialog({
  conversationId,
  onClose,
  onAdded,
}: {
  conversationId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [selected, setSelected] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const add = async () => {
    if (!selected.length) return;
    setBusy(true);
    setError("");
    try {
      await collabFetch(`/conversations/${conversationId}/members`, {
        method: "POST",
        body: { userIds: selected.map((p) => p.id) },
      });
      onAdded();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog title="Add people" onClose={onClose} className="dialog-compact collab-dialog">
      <PeoplePicker
        query={`conversationId=${encodeURIComponent(conversationId)}`}
        autoFocus
        multiple
        selected={selected}
        onChange={setSelected}
      />
      {error && <p className="form-error" role="alert">{error}</p>}
      <DialogActions>
        <Button className="primary" loading={busy} disabled={!selected.length} onClick={() => void add()}>
          <Users size={15} /> Add {selected.length ? selected.length : ""}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ------------------------------------------------------------- edit room */

export function EditRoomDialog({
  conversation,
  onClose,
  onSaved,
}: {
  conversation: ConversationSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(conversation.title);
  const [description, setDescription] = useState(conversation.description ?? "");
  const [visibility, setVisibility] = useState<RoomVisibility>(conversation.visibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trimmed = name.trim();
  const nameError =
    trimmed.length < ROOM_NAME_MIN || trimmed.length > ROOM_NAME_MAX
      ? `Use ${ROOM_NAME_MIN}–${ROOM_NAME_MAX} characters.`
      : "";
  const save = async () => {
    if (nameError) return setError(nameError);
    setBusy(true);
    setError("");
    try {
      await collabFetch(`/conversations/${conversation.id}`, {
        method: "PATCH",
        body: { name: trimmed, description: description.trim(), visibility },
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog title="Room settings" onClose={onClose} className="dialog-compact collab-dialog">
      <div className="collab-form">
        <Field error={trimmed ? nameError : ""}>
          Room name
          <Input value={name} maxLength={ROOM_NAME_MAX} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field>
          Description
          <Textarea
            value={description}
            rows={2}
            maxLength={ROOM_DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field>
          Who can find it
          <Select value={visibility} onChange={(e) => setVisibility(e.target.value as RoomVisibility)}>
            <option value="private">Private — members only</option>
            <option value="workspace">Workspace — anyone in scope can join</option>
          </Select>
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <DialogActions>
        <Button className="primary" loading={busy} onClick={() => void save()}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* --------------------------------------------------------------- confirm */

export function ConfirmDialog({
  title,
  body,
  action,
  destructive,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  action: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose} className="dialog-compact collab-dialog">
      <p className="collab-dialog-text">{body}</p>
      <DialogActions>
        <Button
          className={destructive ? "danger-button" : "primary"}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {action}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
