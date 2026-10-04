"use client";
import { ArrowUpRight, Building2, CheckCircle2, Clock3, Database, Palette, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { companyName } from "@/lib/company-name";
import { canManageUsers, type Actor } from "@/lib/domain";
import { Button, Field, Select } from "./ui/controls";
import { Surface } from "./ui/layout";
import { palettes, setPalette, setTheme, usePalette, useTheme } from "./theme-toggle";
import styles from "./workspace-settings.module.css";

/** Settings expose known account facts, not guessed integration health. */
export default function WorkspaceSettings({ actor, preview, onAppearance, onAccess }: { actor: Actor; preview: boolean; onAppearance: () => void; onAccess: () => void }) {
  const theme = useTheme(), palette = usePalette();
  return <div className={styles.workspace}>
    <Surface className={styles.overview}>
      <span className={styles.emblem}><SlidersHorizontal size={24}/></span>
      <div><span className={styles.eyebrow}>YOUR WORKSPACE</span><h2>One place. A connected team.</h2><p>Manage your experience and understand what you can access.</p></div>
      <div className={styles.scope}><strong>{actor.companies.length}</strong><span>{actor.companies.length === 1 ? "company" : "companies"}<small>in your access scope</small></span></div>
    </Surface>
    <div className={styles.grid}>
      <Surface className={styles.section}>
        <header><span className={styles.sectionIcon}><Building2 size={18}/></span><div><h2>Connected companies</h2><p>Your authorised business entities</p></div></header>
        <ul className={styles.companies}>{actor.companies.map(company => <li key={company}>
          <span className={styles.companyAvatar}>{companyName(company).slice(0,2).toUpperCase()}</span>
          <div><strong>{companyName(company)}</strong><small>Included in your workspace</small></div>
          <span className={styles.active}><CheckCircle2 size={13} aria-hidden="true"/> Active</span>
        </li>)}</ul>
        <p className={styles.note}><ShieldCheck size={14}/> Access remains limited by your role and branch permissions.</p>
      </Surface>
      <Surface className={styles.section}>
        <header><span className={styles.sectionIcon}><ShieldCheck size={18}/></span><div><h2>Your access</h2><p>Account and permission details</p></div></header>
        <dl className={styles.facts}><div><dt>Signed in as</dt><dd>{actor.name}</dd></div><div><dt>Role</dt><dd>{actor.role}</dd></div><div><dt>Branch scope</dt><dd>{actor.branches.join(", ") || "All branches in your company scope"}</dd></div><div><dt>Data mode</dt><dd>{preview ? "Fictional browser preview" : "Connected workspace"}</dd></div></dl>
        <p className={styles.note}>Record access and changes are checked on the server. Deactivating an account revokes its active sessions.</p>
        {canManageUsers(actor) && <Button variant="secondary" onClick={onAccess}>Manage access <ArrowUpRight size={15}/></Button>}
      </Surface>
      <Surface className={styles.section}>
        <header><span className={styles.sectionIcon}><Palette size={18}/></span><div><h2>Make it yours</h2><p>Personal preferences, saved on this browser</p></div></header>
        <div className={styles.preferences}><Field>Display mode<Select value={theme} onChange={e => setTheme(e.target.value as "light" | "dark")}><option value="light">Light</option><option value="dark">Dark</option></Select></Field><Field>Accent palette<Select value={palette} onChange={e => setPalette(e.target.value)}>{palettes.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</Select></Field></div>
        <p className={styles.note}>Navigation, forms and selections share your palette. Reduced-motion preferences follow your device settings.</p>
        <Button variant="secondary" onClick={onAppearance}>Open appearance preview <ArrowUpRight size={15}/></Button>
      </Surface>
      <Surface className={styles.section}>
        <header><span className={styles.sectionIcon}><Database size={18}/></span><div><h2>Workspace essentials</h2><p>How your workspace behaves</p></div></header>
        <div className={styles.essential}><Clock3 size={17}/><div><strong>Business time · Dubai (GST)</strong><p>Meetings and planned posts use UTC+4. Their time fields show the business time zone.</p></div></div>
        <div className={styles.essential}><SlidersHorizontal size={17}/><div><strong>Shared field options</strong><p>Create and manage supported selection options inside forms. Saved options are reusable by your team.</p></div></div>
        <div className={styles.essential}><ShieldCheck size={17}/><div><strong>Connections need configuration</strong><p>Email, calling and AI availability depend on their service configuration. Opening this page does not verify those connections.</p></div></div>
      </Surface>
    </div>
  </div>;
}
