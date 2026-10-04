"use client";
import { useEffect, useState, type SelectHTMLAttributes } from "react";
import { Pencil, Plus, Trash2, Settings2, Users } from "lucide-react";
import { Button, Dialog, DialogActions, Field, Input, Select } from "./controls";
import { capitalizeOption, optionKey, type SharedOption } from "@/lib/shared-options";
import styles from "./shared-select.module.css";

export function SharedSelect({ catalog, company, live, options, label, onOptions, ...props }: SelectHTMLAttributes<HTMLSelectElement> & {
  catalog: string; company: string; live: boolean; options: string[]; label: string; onOptions: (options: string[]) => void;
}) {
  const [rows, setRows] = useState<SharedOption[]>([]);
  const [canAdd, setCanAdd] = useState(false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<SharedOption | null>(null);
  const [removing, setRemoving] = useState<SharedOption | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const key = `enercore-preview-options:${company}:${catalog}`;
  const initial = String(props.defaultValue || options[0] || "");
  const [selected, setSelected] = useState(initial);
  const current = String(props.value ?? selected);
  const endpoint = `/api/shared-options?${new URLSearchParams({ company, catalog })}`;
  const merge = (items: SharedOption[]) => {
    setRows(items);
    // Preserve historical text even when its choice was renamed or removed.
    onOptions([...new Set([...options, ...items.map(r => r.label), initial])]);
  };
  async function refresh() {
    if (!live) {
      try { merge(JSON.parse(localStorage.getItem(key) || "[]")); } catch { merge([]); }
      setCanAdd(true);
      return;
    }
    const response = await fetch(endpoint, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Choices could not be loaded.");
    merge(data.options); setCanAdd(data.canAdd);
  }
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [company, catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const update = () => { void refresh().catch(e => setError(e.message)); };
    window.addEventListener("focus", update);
    window.addEventListener("enercore:options-changed", update);
    return () => { window.removeEventListener("focus", update); window.removeEventListener("enercore:options-changed", update); };
  }, [company, catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const choices = [...new Set([...options, ...rows.map(r => r.label), ...(current ? [current] : [])])];
  async function save(method: "POST" | "PATCH" | "DELETE", row?: SharedOption) {
    const nextLabel = capitalizeOption(text);
    if (method !== "DELETE" && (!nextLabel || [...options, ...rows.filter(r => r.id !== row?.id).map(r => r.label)].some(v => optionKey(v) === optionKey(nextLabel)))) {
      setError(nextLabel ? "That choice already exists." : "Enter a name for the choice."); return;
    }
    setBusy(true); setError("");
    try {
      if (live) {
        const response = await fetch("/api/shared-options", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company, catalog, ...(row ? { id: row.id, version: row.version } : {}), ...(method !== "DELETE" ? { label: nextLabel } : {}) }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "The change could not be saved.");
        await refresh();
      } else {
        const next = method === "DELETE" ? rows.filter(r => r.id !== row?.id) : method === "PATCH" ? rows.map(r => r.id === row?.id ? { ...r, label: nextLabel, version: r.version + 1 } : r) : [...rows, { id: crypto.randomUUID(), label: nextLabel, version: 1, canManage: true }];
        localStorage.setItem(key, JSON.stringify(next)); merge(next);
      }
      setText(""); setEditing(null); setRemoving(null);
      window.dispatchEvent(new Event("enercore:options-changed"));
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save the choice."); }
    finally { setBusy(false); }
  }
  return <div className={styles.control}>
    <Select {...props} value={current} onChange={e => { setSelected(e.target.value); props.onChange?.(e); }}>
      {choices.map(value => <option key={value} value={value}>{capitalizeOption(value)}</option>)}
    </Select>
    <Button type="button" className={styles.manage} aria-label={`Manage ${label.toLowerCase()} choices`} disabled={props.disabled} onClick={() => { setOpen(true); void refresh().catch(e => setError(e.message)); }}><Settings2 size={13} />Manage choices</Button>
    {open && <Dialog title={`${label} choices`} description="Shared vocabulary for your company" onClose={() => !busy && setOpen(false)} className="option-manager-dialog" dismissOnOutside={!busy}>
      <div className={styles.manager}>
        <p className={styles.notice}><Users size={16} />{live ? `People with access to ${company} can use these choices.` : "Preview only · saved in this browser, not shared with other people."}</p>
        <p className={styles.hint}>Built-in choices stay fixed. Renaming or deleting a custom choice never changes saved records.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className={styles.list}>
          {options.map(option => <div className={styles.row} key={option}><span>{capitalizeOption(option)}</span><small>Built-in</small></div>)}
          {rows.map(row => <div className={styles.row} key={row.id}><span>{row.label}</span>{row.canManage ? <div><Button type="button" className="icon-button" aria-label={`Edit ${row.label}`} disabled={busy} onClick={() => { setEditing(row); setRemoving(null); setText(row.label); }}><Pencil size={14} /></Button><Button type="button" className="icon-button danger" aria-label={`Delete ${row.label}`} disabled={busy} onClick={() => setRemoving(row)}><Trash2 size={14} /></Button></div> : <small>Shared choice</small>}</div>)}
        </div>
        {removing ? <div className={styles.confirm}><p>Remove “{removing.label}” from future selections? Existing records keep their value.</p><Button type="button" className="secondary compact" onClick={() => setRemoving(null)}>Keep choice</Button><Button type="button" className="danger-button compact" disabled={busy} onClick={() => void save("DELETE", removing)}>Delete choice</Button></div> : canAdd && <div className={styles.editor}>
          <Field>{editing ? "Rename choice" : "New choice"}<Input value={text} maxLength={catalog.endsWith(":unit") ? 20 : 60} placeholder="e.g. Partner referral" onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void save(editing ? "PATCH" : "POST", editing || undefined); } }} /></Field>
          <Button type="button" className="primary" disabled={busy || !text.trim()} onClick={() => void save(editing ? "PATCH" : "POST", editing || undefined)}><Plus size={15} />{editing ? "Save name" : "Add choice"}</Button>
          {editing && <Button type="button" className="ghost compact" onClick={() => { setEditing(null); setText(""); }}>Cancel edit</Button>}
        </div>}
      </div>
      <DialogActions cancel="Done" pending={busy} />
    </Dialog>}
  </div>;
}
