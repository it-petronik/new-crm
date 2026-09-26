"use client";
import { BrandLogo, brands } from "./brand";
import { useEffect, useState } from "react";
import {
  Building2,
  ArrowUpRight,
  UserRound,
  Sun,
  Moon,
  Keyboard,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import { Button } from "./ui/controls";
import { previewActorKey } from "@/lib/fixtures";
import { AvatarEditor } from "./avatar-editor";
import { useTheme, setTheme, usePalette, setPalette, palettes } from "./theme-toggle";
import {
  allowedModules,
  labels,
  money,
  type Actor,
  type RecordItem,
} from "@/lib/domain";
export type WorkspaceView =
  "collaboration" | "notifications" | "profile" | "appearance" | "access" | "shortcuts";
export const viewLabels: Record<WorkspaceView, string> = {
  collaboration: "Collaboration",
  notifications: "Notifications",
  profile: "My profile",
  appearance: "Appearance",
  access: "Access control",
  shortcuts: "Shortcuts",
};
export function PageTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">WORKSPACE</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
export function ProfilePage({
  actor,
  preview,
  onAppearance,
}: {
  actor: Actor;
  preview: boolean;
  onAppearance: () => void;
}) {
  const modules = allowedModules(actor);
  return (
    <>
      <PageTitle
        title="My profile"
        subtitle="Your personal space, preferences and company access."
      />
      <section className="panel profile-hero">
        <div className="profile-cover">
          <span>ENERCORE</span>
          <ShieldCheck size={28} />
        </div>
        <div className="profile-hero-body">
          <AvatarEditor id={actor.id} name={actor.name} size={92} />
          <div className="profile-heading">
            <h2>{actor.name}</h2>
            <p>{actor.email || "preview@example.invalid"}</p>
            <span className="badge blue">{actor.role}</span>
          </div>
          <Button className="secondary" onClick={onAppearance}>
            <Sun size={16} />
            Appearance preferences
          </Button>
          {/* Every role can reach its profile; Settings is MD and IT only. */}
          <Button
            className="secondary"
            onClick={async () => {
              if (preview) {
                localStorage.removeItem(previewActorKey);
                window.location.href = "/login";
                return;
              }
              const response = await fetch("/api/auth", { method: "DELETE" });
              if (response.ok) window.location.href = "/login";
            }}
          >
            <LogOut size={16} />
            {preview ? "Sign out / switch role" : "Sign out"}
          </Button>
          {!preview && (
            // Every device — including ones kept signed in — signs out.
            <Button
              className="secondary"
              onClick={async () => {
                const response = await fetch("/api/auth", {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ everywhere: true }),
                });
                if (response.ok) window.location.href = "/login";
              }}
            >
              <LogOut size={16} />
              Sign out everywhere
            </Button>
          )}
        </div>
        <div className="profile-summary">
          <span>
            <strong>{actor.companies.length}</strong> Assigned companies
          </span>
          <span>
            <strong>{modules.length}</strong> Available modules
          </span>
          <span>
            <ShieldCheck size={17} /> Role-based access
          </span>
        </div>
      </section>
      <div className="profile-sections">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Account details</h2>
              <p>Your workspace identity</p>
            </div>
            <UserRound size={19} />
          </div>
          <dl className="account-details">
            <div>
              <dt>Full name</dt>
              <dd>{actor.name}</dd>
            </div>
            <div>
              <dt>Email address</dt>
              <dd>{actor.email || "Preview account · no email connected"}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{actor.role}</dd>
            </div>
          </dl>
          <p className="profile-footnote">
            Contact your administrator to update your identity or permissions.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Your companies</h2>
              <p>Companies included in your access</p>
            </div>
            <Building2 size={19} />
          </div>
          <div className="profile-companies">
            {actor.companies.map((c) => (
              <div className="profile-company" key={c}>
                <BrandLogo company={c} />
                <span>{brands[c]?.label || c}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel profile-permissions">
          <div className="panel-heading">
            <div>
              <h2>Module permissions</h2>
              <p>Your role sets the actions available within each module.</p>
            </div>
            <ShieldCheck size={19} />
          </div>
          <div className="permission-summary">
            {modules.map((m) => (
              <div key={m}>
                <span>{labels[m]}</span>
                <span className="permission-level">
                  {actor.role === "MD Assistant" ||
                  actor.moduleAccess?.[m] === "read"
                    ? "View only"
                    : "Role permissions"}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
export function AppearancePage() {
  const theme = useTheme();
  const palette = usePalette();
  return (
    <>
      <PageTitle
        title="Appearance"
        subtitle="Choose a comfortable display. Your preference is remembered on this browser."
      />
      <section className="panel appearance-panel">
        <h2>Display mode</h2>
        <div className="theme-choices">
          {(["light", "dark"] as const).map((t) => (
            <Button
              className={`theme-choice ${theme === t ? "selected" : ""}`}
              key={t}
              aria-pressed={theme === t}
              onClick={() => setTheme(t)}
            >
              <span className={`theme-preview ${t}`}>
                <i />
                <span>
                  <b />
                  <b />
                  <b />
                </span>
              </span>
              <span>
                {t === "light" ? <Sun size={18} /> : <Moon size={18} />}{" "}
                {t === "light" ? "Light mode" : "Dark mode"}
                {theme === t && <small>Selected</small>}
              </span>
            </Button>
          ))}
        </div>
        <h2 className="palette-title">Colour palette</h2>
        <p className="muted">Personalise your workspace accents. Company logos and quotation documents keep their original branding.</p>
        <div className="palette-grid">
          {palettes.map(p => <Button key={p.id} className={`palette-choice ${palette === p.id ? "selected" : ""}`} aria-pressed={palette === p.id} onClick={() => setPalette(p.id)}>
            <span className="palette-swatches" aria-hidden="true">{p.colors.map(color => <i key={color} style={{ background: color }} />)}</span>
            <span>{p.name}</span><small>{palette === p.id ? "Selected" : "Apply palette"}</small>
          </Button>)}
        </div>
      </section>
    </>
  );
}
export function ShortcutsPage({ onCommand }: { onCommand: () => void }) {
  return (
    <>
      <PageTitle
        title="Shortcuts & quick actions"
        subtitle="Get to the next task with fewer clicks."
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>Keyboard shortcuts</h2>
          <Keyboard size={22} />
        </div>
        {[
          ["⌘ / Ctrl + K", "Search pages, records and quick actions"],
          ["/", "Open quick search (outside a text field)"],
          ["Alt + N", "Create a record in the current module"],
          ["Esc", "Close the current popup"],
        ].map(([key, text]) => (
          <div className="settings-row" key={key}>
            <span>{text}</span>
            <kbd>{key}</kbd>
          </div>
        ))}
        <div className="settings-body">
          <Button className="primary" onClick={onCommand}>
            Open command menu
          </Button>
        </div>
      </section>
      <section className="panel automation-summary">
        <div className="panel-heading">
          <h2>Less typing, connected work</h2>
        </div>
        <div className="settings-body">
          <p>
            Saved customer and product details fill quotation drafts. Accepted
            quotations create linked orders, shipments and draft invoices.
            Follow-up dates and status changes surface in your notification
            inbox.
          </p>
          <p>
            Outbound messages and scheduled reminders require a configured
            delivery service; nothing is sent automatically from this preview.
          </p>
        </div>
      </section>
    </>
  );
}
