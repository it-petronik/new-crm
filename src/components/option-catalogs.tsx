"use client";
import { useState } from "react";
import { type Actor, type Kind, labels } from "@/lib/domain";
import { canUseCatalog, catalogDefaults, catalogFields, catalogLabels } from "@/lib/shared-options";
import { companyName } from "@/lib/company-name";
import { Field, Select } from "./ui/controls";
import { SharedSelect } from "./ui/shared-select";
import { PageTitle } from "./ui/layout";

export default function OptionCatalogs({ actor, preview }: { actor: Actor; preview: boolean }) {
  const [company, setCompany] = useState(actor.companies[0]);
  const catalogs = Object.entries(catalogFields).flatMap(([kind, fields]) => fields.map(field => ({ kind: kind as Exclude<Kind, "leave">, field, id: `${kind}:${field}`, label: `${labels[kind as Exclude<Kind, "leave">]} · ${catalogLabels[field] || field}` }))).filter(c => canUseCatalog(actor, company, c.id));
  const [choice, setChoice] = useState("");
  const selected = catalogs.find(c => c.id === choice) || catalogs[0];
  const defaults = selected ? catalogDefaults(selected.id) : [];
  return <div className="option-catalogs">
    <PageTitle title="Option Catalogs" subtitle="Reusable choices for your team. Add, rename or remove custom options without changing saved documents." />
    <div className="catalog-filters"><Field>Company<Select value={company} onChange={e => setCompany(e.target.value)}>{actor.companies.map(c => <option key={c} value={c}>{companyName(c)}</option>)}</Select></Field><Field>Catalog<Select value={selected?.id || ""} onChange={e => setChoice(e.target.value)}>{catalogs.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field></div>
    {selected ? <SharedSelect key={`${company}:${selected.id}`} inlineManager allowEditing={canUseCatalog(actor, company, selected.id, true)} catalog={selected.id} company={company} live={!preview} options={defaults} label={catalogLabels[selected.field] || selected.field} onOptions={() => {}} /> : <p className="muted">No catalogs are available for your current access.</p>}
    <p className="muted small">Roles, access rights, workflow statuses and currencies are controlled by the workspace, not by these catalogs. You can edit your own choices; workspace managers can manage the team's choices.</p>
  </div>;
}
