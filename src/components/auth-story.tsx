import { BrandLogo } from "./brand";
import { ArrowUpRight, Layers3, ShieldCheck } from "lucide-react";

export function AuthStory({ recovery = false }: { recovery?: boolean }) {
  return (
    <section className="login-story auth-story">
      <div className="brand">
        <BrandLogo lockup inverse company="Enercore" />
      </div>
      <div className="auth-story-copy">
        <span className="eyebrow">
          {recovery
            ? "A SECURE WAY BACK"
            : "CONNECTED BUSINESS. CLEARER DECISIONS."}
        </span>
        <h1>
          {recovery ? (
            <>
              Your workspace.
              <br /> <em>A fresh start.</em>
            </>
          ) : (
            <>
              Less switching.
              <br /> More clarity.
              <br /> <em>One Enercore.</em>
            </>
          )}
        </h1>
        <p>
          {recovery
            ? "Choose a new password and return to your team. Reset links work once and expire after 30 minutes."
            : "Keep your conversations, customers and next steps together. A calmer place to get work done."}
        </p>
      </div>
      <div className="auth-story-system" aria-hidden="true">
        <span>
          <Layers3 size={18} /> Connected companies
        </span>
        <span>
          <ArrowUpRight size={18} /> Clear next steps
        </span>
        <span>
          <ShieldCheck size={18} /> Individual access
        </span>
      </div>
      <small>ENERCORE · BUSINESS WORKSPACE</small>
    </section>
  );
}
