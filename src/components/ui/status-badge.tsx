"use client";
import { statusTone, type Tone } from "@/lib/status";

/**
 * The one status badge.
 *
 * Meaning is carried by the text first; the dot and tint reinforce it. Nothing
 * here depends on colour alone, and the tone for a given status comes from a
 * single map, so the same business state cannot look different on two pages.
 */
export function StatusBadge({
  status,
  size = "default",
}: {
  status: string;
  size?: "default" | "sm";
}) {
  const tone = statusTone(status);
  return (
    <span className={`e-badge tone-${tone}${size === "sm" ? " is-sm" : ""}`} title={status}>
      <span className="e-badge-dot" aria-hidden="true" />
      <span className="e-badge-text">{status}</span>
    </span>
  );
}

/** A bare tone chip for counts and labels that are not record statuses. */
export function TonePill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`e-badge tone-${tone}`}>{children}</span>;
}
