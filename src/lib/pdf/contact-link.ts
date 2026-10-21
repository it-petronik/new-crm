/** Contact values remain readable text even when they are not safe links. */
export function documentContactLink(kind: "email" | "phone" | "website", value: string) {
  const text = value.trim();
  if (!text || /[\r\n\u0000-\u001f]/.test(text)) return undefined;
  if (kind === "email") return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(text) ? `mailto:${encodeURIComponent(text).replace(/%40/g, "@")}` : undefined;
  if (kind === "phone") {
    if (!/^\+?[\d\s().-]+$/.test(text)) return undefined;
    const number = text.replace(/[^\d+]/g, "");
    return number.replace(/\D/g, "").length >= 6 ? `tel:${number}` : undefined;
  }
  try {
    // Bare company domains are common, but never guess a protocol for an
    // explicitly supplied non-HTTP scheme or protocol-relative destination.
    if (/^(?!https?:)[a-z][a-z\d+.-]*:/i.test(text) || text.startsWith("//") || /\s/.test(text)) return undefined;
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return /^https?:$/.test(url.protocol) && url.hostname.includes(".") && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
