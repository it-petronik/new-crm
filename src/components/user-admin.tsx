"use client";
import { companyName } from "@/lib/company-name";
import { Avatar } from "./avatar";
import { Pagination, ListFilters, ListEmpty, SortHeader, usePagination } from "./pagination";
import { useEffect, useState } from "react";
import { Plus, ShieldCheck, X, KeyRound } from "lucide-react";
import {
  Button,
  Input,
  Select,
  Field,
  Dialog,
  DialogActions,
  DialogPresence,
} from "./ui/controls";
import {
  roles,
  labels,
  roleModules,
  canManageUsers,
  type Actor,
} from "@/lib/domain";
import { leadership, mayAssign, branchesForRole } from "@/lib/access-control";
import { check, required, minLength, email as emailRule } from "@/lib/validation";
type User = Actor & { email: string; active: boolean };
export default function UserAdmin({
  actor,
  preview,
}: {
  actor: Actor;
  preview: boolean;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [profile, setProfile] = useState<User | null>(null);
  const [editor, setEditor] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Holds the generated link for exactly one viewing; never persisted.
  const [resetLink, setResetLink] = useState<{ link: string; name: string; minutes: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [ready, setReady] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const key = `enercore-user-preview-${actor.id}`;
  async function load() {
    const r = await fetch("/api/users");
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setUsers(d.users);
  }
  useEffect(() => {
    if (preview) {
      try {
        const saved = localStorage.getItem(key);
        setUsers(
          saved
            ? JSON.parse(saved)
            : [
                { ...actor, email: "preview@example.invalid", active: true },
                {
                  id: "demo-sales",
                  name: "Leila Ahmed",
                  email: "leila@example.invalid",
                  role: "Sales Executive",
                  companies: [actor.companies[0]],
                  branches: actor.branches.length ? actor.branches : ["Main"],
                  active: true,
                },
              ],
        );
      } catch {
        setUsers([
          { ...actor, email: "preview@example.invalid", active: true },
        ]);
      }
      setReady(true);
    } else
      load()
        .catch((e) => setError(e.message))
        .finally(() => setReady(true));
  }, [preview]);
  function persist(next: User[]) {
    if (preview) localStorage.setItem(key, JSON.stringify(next));
    setUsers(next);
  }
  function edit(user: User, isNew = false) {
    setEditor({ ...user, moduleAccess: { ...user.moduleAccess } });
    setCreating(isNew);
    setReview(false);
    setError("");
  }
  const assignableRoles = roles.filter(
    (r) =>
      r !== "Branch Manager" &&
      (actor.role === "MD" || !leadership.includes(r)),
  );
  const editable = (user: User) =>
    user.id !== actor.id &&
    (actor.role === "MD" || !leadership.includes(user.role));
  const pagination = usePagination(users);
  if (!canManageUsers(actor))
    return (
      <div className="error">
        You do not have access to user administration.
      </div>
    );
  return (
    <section className="panel filterable-table-panel">
      {profile ? <div className="access-profile">
        <Button className="secondary" onClick={() => setProfile(null)}>← Back to users</Button>
        <div className="access-profile-heading"><Avatar name={profile.name} size={44} /><div><h2>{profile.name}</h2><p>{profile.role}</p></div><span className={`badge ${profile.active ? "green" : "red"}`}>{profile.active ? "Active" : "Inactive"}</span></div>
        <dl className="access-profile-grid"><div><dt>Email</dt><dd>{profile.email}</dd></div><div><dt>Companies</dt><dd>{profile.companies.map(companyName).join(", ")}</dd></div><div><dt>Role</dt><dd>{profile.role}</dd></div></dl>
        <h3>Module access</h3><div className="access-profile-grid">{Object.entries(labels).filter(([m])=>roleModules(profile.role).includes(m as never)).map(([m,label])=><div key={m}><strong>{label}</strong><p>{profile.moduleAccess?.[m as keyof NonNullable<Actor["moduleAccess"]>] || "Role default"}</p></div>)}</div>
        <p className="muted">Account details and assigned access. Personal HR information is not included here.</p>
      </div> : <>
      <div className="panel-heading">
        <div>
          <h2>Team access</h2>
          <p>{users.length} accounts · Role, company and module controls</p>
        </div>
        <Button
          className="primary"
          disabled={!ready}
          onClick={() =>
            edit(
              {
                id: "",
                name: "",
                email: "",
                role: "Sales Executive",
                companies: [actor.companies[0]],
                branches: actor.branches.length ? actor.branches : ["Main"],
                active: true,
              },
              true,
            )
          }
        >
          <Plus size={16} />
          Add user
        </Button>
      </div>
      <ListFilters {...pagination} label="users" sortable={false} />
      {error && !editor && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <SortHeader sortKey="name" query={pagination.query} setQuery={pagination.setQuery}>Person</SortHeader>
              <SortHeader sortKey="role" query={pagination.query} setQuery={pagination.setQuery}>Role</SortHeader>
              <th>Companies</th>
              <SortHeader sortKey="active" query={pagination.query} setQuery={pagination.setQuery}>Status</SortHeader>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {pagination.items.map((u) => (
              <tr key={u.id}>
                <td>
                  {/* The email stays outside the button so its accessible
                      name remains just the person's name. */}
                  <div className="avatar-name">
                    <Avatar name={u.name} size={32} />
                    <span>
                      <Button className="record-link" onClick={() => setProfile(u)}>{u.name}</Button>
                      <small>{u.email}</small>
                    </span>
                  </div>
                </td>
                <td>{u.role}</td>
                <td>{u.companies.map(companyName).join(", ")}</td>
                <td>
                  <span className={`badge ${u.active ? "green" : "red"}`}>
                    {u.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  {editable(u) ? (
                    <div className="access-actions">
                      <Button
                        className="secondary"
                        disabled={busy}
                        onClick={() => edit(u)}
                      >
                        Manage access
                      </Button>
                      <Button
                        className="secondary"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setError("");
                          try {
                            const response = await fetch("/api/users/reset-link", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ userId: u.id }),
                            });
                            const result = await response.json();
                            if (!response.ok) throw new Error(result.error);
                            setCopied(false);
                            setResetLink({ link: result.link, name: result.user.name, minutes: result.expiresInMinutes });
                          } catch (e) {
                            setError(e instanceof Error ? e.message : "Unable to generate a reset link.");
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        <KeyRound size={15} />
                        Reset password
                      </Button>
                      <Button
                        className="text-button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            if (preview)
                              persist(
                                users.map((x) =>
                                  x.id === u.id
                                    ? { ...x, active: !x.active }
                                    : x,
                                ),
                              );
                            else {
                              const r = await fetch("/api/users", {
                                method: "PATCH",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                  id: u.id,
                                  active: !u.active,
                                }),
                              });
                              const d = await r.json();
                              if (!r.ok) throw new Error(d.error);
                              await load();
                            }
                          } catch (e) {
                            setError(
                              e instanceof Error ? e.message : "Update failed",
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {u.active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  ) : (
                    <span className="muted">
                      {u.id === actor.id ? "Your account" : "MD managed"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListEmpty {...pagination} label="users" />
      <Pagination {...pagination} label="users" />
      </>}
      <DialogPresence>
        {resetLink && (
          <Dialog title="Password reset link" onClose={() => setResetLink(null)}>
            <p>
              Give this link to <strong>{resetLink.name}</strong> in person or
              through a channel you trust. It works once and expires in{" "}
              {resetLink.minutes} minutes.
            </p>
            <p className="error" role="alert">
              This is shown once. It is not stored anywhere and cannot be shown
              again — if you lose it, generate a new link.
            </p>
            <Input readOnly value={resetLink.link} aria-label="Reset link" onFocus={(e) => e.currentTarget.select()} />
            <DialogActions>
              <Button
                className="primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(resetLink.link);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
            </DialogActions>
            <p className="muted small">
              Using it signs {resetLink.name} out of every device.
            </p>
          </Dialog>
        )}
      </DialogPresence>
      <DialogPresence>
        {editor && (
          <Dialog
            className="access-editor-dialog"
            title={creating ? "Add user" : "Manage access"}
            onClose={() => !busy && setEditor(null)}
          >
            <div className="modal-header">
              <ShieldCheck size={20} />
              <Button
                className="icon-button"
                aria-label="Close access editor"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                <X size={18} />
              </Button>
            </div>
            <h2>{creating ? "Add user" : editor.name}</h2>
            <p className="muted">
              {preview
                ? "Fictional preview accounts only."
                : "Access changes revoke this person's existing sessions."}{" "}
              Your own access cannot be changed here.
            </p>
            <form
              noValidate
              id="user-access-form"
              onInput={(e) => {
                const name = (e.target as HTMLElement & { name?: string }).name;
                if (name) setFieldErrors((prev) => (prev[name] ? { ...prev, [name]: "" } : prev));
              }}
              onSubmit={async (e) => {
                e.preventDefault();
                // Client-side only for speed of feedback; the API re-checks.
                if (creating) {
                  const entered = new FormData(e.currentTarget);
                  const found: Record<string, string> = {};
                  const nameError = check(editor.name, [required("Name"), minLength("Name", 2)]);
                  if (nameError) found.name = nameError;
                  const emailError = check(editor.email, [required("Work email"), emailRule]);
                  if (emailError) found.email = emailError;
                  if (!preview) {
                    const password = String(entered.get("password") ?? "");
                    const passwordError = check(password, [
                      required("An initial password"),
                      minLength("The password", 14),
                    ]);
                    if (passwordError) found.password = passwordError;
                  }
                  setFieldErrors(found);
                  const first = Object.keys(found)[0];
                  if (first) {
                    const el = e.currentTarget.querySelector("[name=\"" + first + "\"]");
                    setTimeout(() => (el as HTMLElement | null)?.focus(), 0);
                    return;
                  }
                }
                if (
                  !mayAssign(
                    actor,
                    creating ? null : users.find((u) => u.id === editor.id)!,
                    editor,
                  )
                ) {
                  setError(
                    "Choose a permitted role and at least one company within your scope.",
                  );
                  return;
                }
                if (!review) {
                  setReview(true);
                  return;
                }
                setBusy(true);
                try {
                  if (preview)
                    persist(
                      creating
                        ? [...users, { ...editor, id: crypto.randomUUID() }]
                        : users.map((u) => (u.id === editor.id ? editor : u)),
                    );
                  else {
                    const form = new FormData(e.currentTarget);
                    const r = await fetch("/api/users", {
                      method: creating ? "POST" : "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(
                        creating
                          ? {
                              ...editor,
                              password: String(form.get("password") || ""),
                            }
                          : {
                              id: editor.id,
                              role: editor.role,
                              companies: editor.companies,
                              branches: editor.branches,
                              moduleAccess: editor.moduleAccess || {},
                            },
                      ),
                    });
                    const d = await r.json();
                    if (!r.ok) throw new Error(d.error);
                    await load();
                  }
                  setEditor(null);
                  setError("");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Save failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <fieldset disabled={review || busy} className="access-fieldset">
                <div className="form-grid">
                  {creating && (
                    <>
                      <Field error={fieldErrors.name}>
                        Name
                        <Input
                          name="name"
                          maxLength={100}
                          value={editor.name}
                          onChange={(e) =>
                            setEditor({ ...editor, name: e.target.value })
                          }
                        />
                      </Field>
                      <Field error={fieldErrors.email}>
                        Work email
                        <Input
                          name="email"
                          inputMode="email"
                          value={editor.email}
                          onChange={(e) =>
                            setEditor({ ...editor, email: e.target.value })
                          }
                        />
                      </Field>
                    </>
                  )}
                  <Field>
                    Role
                    <Select
                      value={editor.role}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          role: e.target.value as Actor["role"],
                          branches: branchesForRole(actor, e.target.value),
                          moduleAccess: {},
                        })
                      }
                    >
                      {assignableRoles.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <h3 className="section-caption">Company access</h3>
                <div className="choice-grid">
                  {actor.companies.map((c) => (
                    <Button
                      key={c}
                      type="button"
                      aria-pressed={editor.companies.includes(c)}
                      className={`choice-card ${editor.companies.includes(c) ? "selected" : ""}`}
                      onClick={() =>
                        setEditor({
                          ...editor,
                          companies: editor.companies.includes(c)
                            ? editor.companies.filter((x) => x !== c)
                            : [...editor.companies, c],
                        })
                      }
                    >
                      {companyName(c)}
                      <span>
                        {editor.companies.includes(c)
                          ? "Included"
                          : "No access"}
                      </span>
                    </Button>
                  ))}
                </div>
                <h3 className="section-caption">Module access</h3>
                <p className="muted small">
                  Role default keeps the role's existing rules. View only
                  removes write actions; No access removes the module. Company,
                  ownership and approval limits still apply.
                </p>
                <div className="permission-grid">
                  {roleModules(editor.role).map((m) => (
                    <Field key={m}>
                      {labels[m]}
                      <Select
                        aria-label={`${labels[m]} permission`}
                        value={editor.moduleAccess?.[m] || "write"}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            moduleAccess: {
                              ...editor.moduleAccess,
                              [m]: e.target.value as "none" | "read" | "write",
                            },
                          })
                        }
                      >
                        <option value="write">Role default</option>
                        <option value="read">View only</option>
                        <option value="none">No access</option>
                      </Select>
                    </Field>
                  ))}
                </div>
              </fieldset>
              {creating && !preview && (
                <Field error={fieldErrors.password} hint="At least 14 characters">
                  Initial password
                  <Input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    maxLength={128}
                    readOnly={review}
                  />
                </Field>
              )}
              {review && (
                <div className="review-box">
                  <strong>Review access for {editor.name}</strong>
                  <p>
                    {editor.role} ·{" "}
                    {editor.companies.map(companyName).join(", ")}
                  </p>
                  <p>
                    {Object.entries(editor.moduleAccess || {})
                      .filter(([, v]) => v !== "write")
                      .map(
                        ([m, v]) => `${labels[m as keyof typeof labels]}: ${v}`,
                      )
                      .join(" · ") ||
                      "All modules use the selected role's existing rules."}
                  </p>
                </div>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <DialogActions>
                <div className="form-footer">
                  <span>
                    <ShieldCheck size={14} />
                    {preview
                      ? "Saved only in this browser"
                      : "Changes are audited"}
                  </span>
                  {review && (
                    <Button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => setReview(false)}
                    >
                      Back to edit
                    </Button>
                  )}
                  <Button
                    type="submit"
                    form="user-access-form"
                    className="primary"
                    loading={busy}
                  >
                    {review ? "Confirm access" : "Review changes"}
                  </Button>
                </div>
              </DialogActions>
            </form>
          </Dialog>
        )}
      </DialogPresence>
    </section>
  );
}
