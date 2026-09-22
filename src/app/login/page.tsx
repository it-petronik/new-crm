"use client";
import {
  Button,
  Input,
  Select,
  Textarea,
  Field,
} from "@/components/ui/controls";
import { useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand";
import ThemeToggle from "@/components/theme-toggle";
export default function Login() {
  const [error, setError] = useState("");
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
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                const r = await fetch("/api/auth", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    email: f.get("email"),
                    password: f.get("password"),
                  }),
                });
                const data = await r.json();
                if (!r.ok) throw new Error(data.error);
                window.location.href = "/";
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Unable to sign in.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field>
              Work email
              <Input
                name="email"
                type="email"
                autoComplete="username"
                placeholder="you@company.com"
                required
              />
            </Field>
            <Field>
              Password
              <Input
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={1}
                required
              />
            </Field>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <Button className="primary" disabled={busy}>
              {busy ? "Signing in…" : "Sign in to workspace"}
              <ArrowRight size={17} />
            </Button>
          </form>
          <div className="secure-note">
            <ShieldCheck size={16} /> Individual access. Protected company data.
          </div>
          <p className="muted small">
            Need access or a password reset? Contact your IT administrator.
          </p>
        </div>
      </section>
    </main>
  );
}
