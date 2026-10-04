"use client";
import { useState } from "react";
import { Check, Moon, Sun, Palette } from "lucide-react";
import { PageHeader, Surface, Section, Toolbar, FormGrid } from "./ui/layout";
import { Button, Dialog, DialogActions, Field, Input, Select } from "./ui/controls";
import { StatusBadge } from "./ui/status-badge";
import { palettes, setPalette, setTheme, usePalette, useTheme } from "./theme-toggle";
import styles from "./appearance-settings.module.css";

/** This preview uses the actual shared controls, not a picture of an old theme. */
export default function AppearanceSettings() {
  const theme = useTheme();
  const palette = usePalette();
  const [name, setName] = useState("Example customer");
  const [status, setStatus] = useState("Qualified");
  const [preview, setPreview] = useState(false);
  return <>
    <PageHeader title="Appearance" description="Make the workspace comfortable for you. Changes are saved on this browser."/>
    <div className={styles.grid}>
      <Surface className={styles.settings}>
        <Section title="Display mode" description="Choose a light or dark workspace.">
          <div className={styles.modes}>{(["light", "dark"] as const).map(mode => <button key={mode} className={styles.choice} aria-pressed={theme === mode} onClick={() => setTheme(mode)}>
            {mode === "light" ? <Sun size={20}/> : <Moon size={20}/>}
            <span><strong>{mode === "light" ? "Light mode" : "Dark mode"}</strong><small>{mode === "light" ? "Clear, neutral surfaces" : "A softer view in low light"}</small></span>
            {theme === mode && <Check size={16} aria-hidden="true"/>}
          </button>)}</div>
        </Section>
        <Section title="Accent palette" description="One accent across your navigation, buttons, selections, and focus rings.">
          <div className={styles.palettes}>{palettes.map(p => <button key={p.id} className={styles.palette} aria-pressed={palette === p.id} onClick={() => setPalette(p.id)}>
            <span className={styles.swatches} aria-hidden="true">{p.colors.map(color => <i key={color} style={{background:color}}/>)}</span>
            <strong>{p.name}</strong><small>{palette === p.id ? "Selected" : "Use this palette"}</small>
            {palette === p.id && <Check size={15} className={styles.selectedMark} aria-hidden="true"/>}
          </button>)}</div>
        </Section>
        <p className={styles.note}>Company colours follow the selected business; the all-company workspace uses Enercore violet. Logos and printable documents keep their original branding.</p>
      </Surface>
      <Surface className={styles.preview} aria-label="Live theme preview">
        <Section title="Live preview" description="Real interface components in your selected theme." actions={<Palette size={18} aria-hidden="true"/>}><div className={styles.settings}>
        <div className={styles.sampleHeading}><span className={styles.avatar}>EC</span><div><strong>{name || "Example customer"}</strong><small>Example record · no real data</small></div><StatusBadge status={status}/></div>
        <FormGrid><Field>Customer name<Input value={name} onChange={e=>setName(e.target.value)} maxLength={80}/></Field><Field>Status<Select value={status} onChange={e=>setStatus(e.target.value)}>{["New","Qualified","Won"].map(s=><option key={s}>{s}</option>)}</Select></Field></FormGrid>
        <Toolbar><Button variant="primary" onClick={()=>setPreview(true)}>Preview form</Button><Button variant="secondary" onClick={()=>{setName("Example customer");setStatus("Qualified");}}>Reset sample</Button></Toolbar>
        <div className={styles.meanings}><strong>Meaning stays consistent</strong><Toolbar><StatusBadge status="Won"/><StatusBadge status="Pending Approval"/><StatusBadge status="Overdue"/></Toolbar><p>Success, warnings, and destructive actions keep their meaning in every palette.</p></div>
        </div></Section>
      </Surface>
    </div>
    {preview && <Dialog title="Form preview" description="A sample only. Nothing here creates or edits a CRM record." onClose={()=>setPreview(false)}><FormGrid><Field>Customer<Input value={name || "Example customer"} readOnly/></Field><Field>Status<Input value={status} readOnly/></Field></FormGrid><DialogActions primary={{label:"Done",onClick:()=>setPreview(false)}} cancel={false}/></Dialog>}
  </>;
}
