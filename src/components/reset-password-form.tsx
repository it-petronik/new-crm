"use client";
import { Form } from '@/components/ui/controls';

import { useEffect, useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button, Input, Field } from "@/components/ui/controls";
import { AlertCircle } from "lucide-react";
import { check, required, email as emailRule, minLength } from "@/lib/validation";
import { BrandLogo } from "@/components/brand";
import ThemeToggle from "@/components/theme-toggle";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-reset";
import { AuthStory } from "./auth-story";
import {readJsonResponse,friendlyError} from "@/lib/client-request";

export default function ResetPasswordForm({ preview }: { preview: boolean }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  // Field messages appear on blur and clear as soon as the value is valid.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("token") || "";
    setToken(value);
    // Remove the token from the address bar and history entry so it does not
    // linger in the browser history or leak through a Referer header.
    if (value) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  return (
    <main className="login-page">
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <AuthStory recovery/>
      <section className="login-form">
        <div className="login-box">
          {done ? (
            <>
              <span className="eyebrow">DONE</span>
              <h2>Password updated.</h2>
              <p>
                You have been signed out everywhere. Sign in again with your new
                password.
              </p>
              <Button className="primary" onClick={() => (window.location.href = "/login")}>
                Go to sign in <ArrowRight size={17} />
              </Button>
            </>
          ) : (
            <>
              <span className="eyebrow">ACCOUNT RECOVERY</span>
              <h2>Choose a new password.</h2>
              <p>At least {MIN_PASSWORD_LENGTH} characters. Use something unique to this workspace.</p>
              <Form
            noValidate
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const data = new FormData(form);
                  const password = String(data.get("password") || "");
                  if(busy)return;
                  const found={password:check(password,[required("A new password"),minLength("Your password",MIN_PASSWORD_LENGTH)]),confirm:check(String(data.get("confirm")||""),[required("Confirmation")])};setFieldErrors(found);
                  if(found.password||found.confirm)return;
                  if (password !== String(data.get("confirm") || ""))
                    return setError("Those passwords do not match.");
                  setBusy(true);
                  setError("");
                  try {
                    const response = await fetch("/api/password-reset/confirm", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ token, password }),
                    });
                    const result = await readJsonResponse(response,"The password update couldn’t be confirmed. Try signing in before requesting another reset.");
                    if (!response.ok) throw new Error(result.error);
                    setDone(true);
                  } catch (err) {
                    setError(friendlyError(err,"The password update couldn’t be confirmed. Try signing in before requesting another reset."));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Field error={fieldErrors.password} hint={`At least ${MIN_PASSWORD_LENGTH} characters`}>
                  New password
                  <Input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    onChange={(e) => fieldErrors.password && setFieldErrors((f) => ({ ...f, password: check(e.target.value, [required("A new password"), minLength("Your password", MIN_PASSWORD_LENGTH)]) }))}
                  />
                </Field>
                <Field error={fieldErrors.confirm}>
                  Confirm new password
                  <Input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    onChange={(e) => fieldErrors.confirm && setFieldErrors((f) => ({ ...f, confirm: "" }))}
                  />
                </Field>
                {preview && (
                  <p className="muted small">
                    Preview mode uses fictional data. Password reset needs the
                    configured workspace database.
                  </p>
                )}
                {error && (
                  <div className="form-error" role="alert">
                    <AlertCircle size={15} aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}
                <Button type="submit" className="primary" disabled={busy}>
                  {busy ? "Updating…" : "Update password"}
                  <ArrowRight size={17} />
                </Button>
              </Form>
              <div className="secure-note">
                <ShieldCheck size={16} /> Updating your password signs you out on
                every device.
              </div>
              <p className="muted small">
                No link, or it stopped working? Ask an administrator to issue a
                new one.
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
