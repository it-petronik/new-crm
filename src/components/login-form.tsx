"use client";
import {
  Button,
  Input,
  Select,
  Textarea,
  Field,
} from "@/components/ui/controls";
import { AlertCircle } from "lucide-react";
import { check, required, email as emailRule } from "@/lib/validation";
import { useEffect, useState } from "react";
import { renewSession } from "@/lib/session-client";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand";
import { demoAccounts, demoPassword, previewActorKey } from "@/lib/fixtures";
import ThemeToggle from "@/components/theme-toggle";
export default function LoginForm({ preview, next = "/", resume = false }: { preview: boolean; next?: string; resume?: boolean }) {
  const [error, setError] = useState("");
  // "Keep me signed in": try the device's credential before showing the form.
  const [resuming, setResuming] = useState(resume);
  useEffect(() => {
    if (!resume) return;
    let active = true;
    void renewSession().then((ok) => {
      if (ok) window.location.replace(next);
      else if (active) setResuming(false);
    });
    return () => {
      active = false;
    };
  }, [resume, next]);
  // Field messages appear on blur and clear as soon as the value is valid.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <section className="login-story">
        <div className="brand">
          <BrandLogo company="Enercore" />
        </div>
        <span className="eyebrow">CONNECTED BUSINESS. CLEARER DECISIONS.</span>
        <h1>
          Every company.
          <br />
          Every team.
          <br />
          <em>One direction.</em>
        </h1>
        <p>Your people, pipeline and operations. Finally working together.</p>
        <div className="login-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
          <b>e</b>
        </div>
        <small>ENERCORE GROUP · BUSINESS WORKSPACE</small>
      </section>
      <section className="login-form">
        <div className="login-box">
          <span className="eyebrow">YOUR WORKSPACE AWAITS</span>
          <h2>Welcome back.</h2>
          <p>Sign in with your company account.</p>
          {resuming ? (
            <p className="login-resume" role="status" aria-live="polite">
              Signing you back in…
            </p>
          ) : (
          <form
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                if (preview) {
                  // Preview has no database; demo accounts stand in for real
                  // credentials so each role's view can be tried.
                  const email = String(f.get("email") || "").trim().toLowerCase();
                  const match = demoAccounts.find((a) => a.email === email);
                  if (!match || f.get("password") !== demoPassword)
                    throw new Error("Use one of the demo accounts listed below.");
                  localStorage.setItem(previewActorKey, JSON.stringify(match.actor));
                  window.location.href = "/";
                  return;
                }
                const r = await fetch("/api/auth", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    email: f.get("email"),
                    password: f.get("password"),
                    remember: f.get("remember") === "on",
                  }),
                });
                const data = await r.json();
                if (!r.ok) throw new Error(data.error);
                window.location.href = next;
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Unable to sign in.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field error={fieldErrors.email}>
              Work email
              <Input
                name="email"
                inputMode="email"
                autoComplete="username"
                placeholder="you@company.com"
                onBlur={(e) => setFieldErrors((f) => ({ ...f, email: check(e.target.value, [required("Work email"), emailRule]) }))}
                onChange={(e) => fieldErrors.email && setFieldErrors((f) => ({ ...f, email: check(e.target.value, [required("Work email"), emailRule]) }))}
              />
            </Field>
            <Field error={fieldErrors.password}>
              Password
              <Input
                name="password"
                type="password"
                autoComplete="current-password"
                onBlur={(e) => setFieldErrors((f) => ({ ...f, password: check(e.target.value, [required("Password")]) }))}
                onChange={(e) => fieldErrors.password && setFieldErrors((f) => ({ ...f, password: check(e.target.value, [required("Password")]) }))}
              />
            </Field>
            {!preview && (
              <label className="login-remember">
                <input type="checkbox" name="remember" defaultChecked />
                <span>
                  Keep me signed in on this device
                  <small>Untick on a shared computer.</small>
                </span>
              </label>
            )}
            {error && (
              <div className="form-error" role="alert">
                <AlertCircle size={15} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
            <Button className="primary" disabled={busy}>
              {busy ? "Signing in…" : "Sign in to workspace"}
              <ArrowRight size={17} />
            </Button>
          </form>
          )}
          <div className="secure-note">
            <ShieldCheck size={16} /> Individual access. Protected company data.
          </div>
          {preview && (
            <div className="demo-accounts">
              <strong>Demo accounts · preview only</strong>
              <p>Fictional sign-ins for trying each role. Password: <code>{demoPassword}</code></p>
              <ul>
                {demoAccounts.map((a) => (
                  <li key={a.email}>
                    <button
                      type="button"
                      onClick={() => {
                        localStorage.setItem(previewActorKey, JSON.stringify(a.actor));
                        window.location.href = "/";
                      }}
                    >
                      <code>{a.email}</code>
                      <span>{a.actor.role}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="muted small">
            Need access or a password reset? Contact your IT administrator.
          </p>
        </div>
      </section>
    </main>
  );
}
