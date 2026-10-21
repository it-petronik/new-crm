import { canRead, isProforma, type Actor, type RecordItem } from "../domain";

/** Immutable approved master. Image bytes live in private D1, never public/. */
export const PETRONIK_SEAL = {
  id: "petronik-pi-2026-10-153-v1",
  signatureSha256:
    "fcdbb96de78b2522321e7b433a548ed66ef7831311c1f15a1f90ad581bea70ef",
  stampSha256:
    "f90ff044abe377a852a2f16992f0ca65c5d9d0ad3f15fd5280e44fba9bae26b4",
} as const;
export function usesApprovedSeal(record: RecordItem) {
  return (
    !record.deletedAt &&
    record.company === "Petronik" &&
    (record.kind === "quotations" || isProforma(record))
  );
}
export function canReadDocumentSeal(actor: Actor, record: RecordItem) {
  return usesApprovedSeal(record) && canRead(actor, record);
}
export function documentSealUrl(record: RecordItem, connected: boolean) {
  return connected && usesApprovedSeal(record)
    ? `/api/document-seals?recordId=${encodeURIComponent(record.id)}&version=${PETRONIK_SEAL.id}`
    : undefined;
}
async function verifiedPng(base64: string, expected: string) {
  if (
    !base64 ||
    base64.length > 200000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    throw new Error("Invalid seal image");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== expected)
    throw new Error("Seal image does not match approved master");
  return `data:image/png;base64,${base64}`;
}
export async function documentSealSvg(signaturePng: string, stampPng: string) {
  const [signature, stamp] = await Promise.all([
    verifiedPng(signaturePng, PETRONIK_SEAL.signatureSha256),
    verifiedPng(stampPng, PETRONIK_SEAL.stampSha256),
  ]);
  // Original PDF positions, transparency, proportions and paint order.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 273.19 134.75"><image x="73.82" y="8.02" width="199.37" height="112.4" preserveAspectRatio="none" href="${signature}"/><image x="0" y="0" width="143.87" height="134.75" preserveAspectRatio="none" href="${stamp}"/></svg>`;
}
