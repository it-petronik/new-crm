"use client";

/** First and last initial, e.g. "Coastal Energy Partners" becomes "CP". */
export function initials(name: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] || "";
  return (first + last).toUpperCase();
}

// Fixed tones so the same name always gets the same colour, in any session.
const tones = [
  { bg: "#dbeafe", ink: "#1d4ed8" },
  { bg: "#dcfce7", ink: "#15803d" },
  { bg: "#fef3c7", ink: "#a16207" },
  { bg: "#ede9fe", ink: "#6d28d9" },
  { bg: "#ffe4e6", ink: "#be123c" },
  { bg: "#ccfbf1", ink: "#0f766e" },
];
export function avatarTone(name: string) {
  let hash = 0;
  for (const character of String(name || "")) hash = (hash * 31 + character.charCodeAt(0)) % 997;
  return tones[hash % tones.length];
}

export function Avatar({
  name,
  image,
  size = 34,
  className,
}: {
  name: string;
  image?: string;
  size?: number;
  className?: string;
}) {
  const tone = avatarTone(name);
  return (
    <span
      className={["entity-avatar", className].filter(Boolean).join(" ")}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.36)),
        ...(image ? {} : { background: tone.bg, color: tone.ink }),
      }}
    >
      {image ? <img src={image} alt="" /> : initials(name)}
    </span>
  );
}
