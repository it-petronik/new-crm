import { redactSensitive } from "./sanitize";

/** Pure detection and evidence validation. No provider or persistence here. */
export const CAPTURE_FIELDS = ["title", "contact", "email", "phone", "product", "grade", "quantity", "unit", "destination"] as const;
export type CaptureField = typeof CAPTURE_FIELDS[number];
export type CaptureDraft = Partial<Record<CaptureField, string>>;
export const CAPTURE_LABELS: Record<CaptureField, string> = {
  title: "Customer / company", contact: "Contact person", email: "Email", phone: "Phone",
  product: "Product", grade: "Grade", quantity: "Quantity", unit: "Unit", destination: "Destination",
};

export function detectInquiry(text: string): CaptureDraft {
  const clean = redactSensitive(text.slice(0, 2500));
  const draft: CaptureDraft = {};
  const labels: Partial<Record<CaptureField, string>> = {
    title: "company|customer|buyer", contact: "contact|contact person|name", product: "product|requirement",
    grade: "grade|specification", destination: "destination|delivery to|port of discharge",
  };
  for (const [field, label] of Object.entries(labels)) {
    const values = [...clean.matchAll(new RegExp(`(?:^|[\\n;])\\s*(?:${label})\\s*:\\s*([^\\n;]{2,160})`, "gi"))].map(match=>match[1].trim());
    if (new Set(values).size === 1 && !values[0].includes("[redacted")) draft[field as CaptureField] = values[0];
  }
  const emails = [...new Set(clean.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi))];
  if (emails.length === 1) draft.email = emails[0];
  const phones = [...clean.matchAll(/(?:^|[\s:])\+\d[\d ().-]{7,22}\d\b/g)].map(match=>match[0].trim());
  if (new Set(phones).size === 1) draft.phone = phones[0];
  const products = [...new Set(clean.match(/\b(?:base oil|bitumen|rubber process oil|industrial grease|hydraulic oil|engine oil|polypropylene|polyethylene)\b/gi)?.map(value=>value.toLowerCase()))];
  const grades = [...new Set(clean.match(/\b(?:SN\s?\d{2,4}|NLGI\s?\d|ISO\s?VG\s?\d+|60\/70|80\/100)\b/gi))];
  if (!draft.product && products.length === 1) draft.product = products[0];
  if (!draft.grade && grades.length === 1) draft.grade = grades[0];
  const quantities = [...clean.matchAll(/(?<![-\d.,])\b(\d[\d,]*(?:\.\d+)?)\s*(MT|KG|L|litres?|drums?|bags?)\b/gi)];
  // Multiple quantities could mean packaging sizes or alternatives. Don't guess.
  if (quantities.length === 1) {
    const quantity = Number(quantities[0][1].replaceAll(",", ""));
    if (quantity > 0 && quantity <= 100000000) { draft.quantity = String(quantity); draft.unit = quantities[0][2].toUpperCase(); }
  }
  return Object.fromEntries(Object.entries(draft).filter(([, value]) => Boolean(value)));
}

/** Never overwrite typed fields, including the quantity/unit pair. */
export function fillEmptyFields(current: CaptureDraft, suggested: CaptureDraft): CaptureDraft {
  const next = { ...current };
  for (const field of CAPTURE_FIELDS) {
    if (field === "quantity" || field === "unit") continue;
    if (!current[field]?.trim() && suggested[field]) next[field] = suggested[field];
  }
  if (!current.quantity?.trim() && !current.unit?.trim() && suggested.quantity && suggested.unit) {
    next.quantity = suggested.quantity; next.unit = suggested.unit;
  }
  return next;
}

/** Model proposals must match literal evidence, not just a JSON schema. */
export function verifiedCapture(text: string, items: {field: CaptureField; value: string; evidence: string}[]): CaptureDraft {
  const source = redactSensitive(text).toLowerCase(), draft: CaptureDraft = {};
  const conflicts = new Set<CaptureField>();
  for (const item of items) {
    if (!(CAPTURE_FIELDS as readonly string[]).includes(item.field)) continue;
    const value = item.value.trim(), evidence = item.evidence.trim().toLowerCase();
    if (!value || value.length > 160 || !source.includes(evidence) || !evidence.includes(value.toLowerCase()) || value.includes("[redacted") || redactSensitive(value) !== value) continue;
    if (item.field === "quantity" && (!/^\d[\d,]*(?:\.\d+)?$/.test(value) || !(Number(value.replaceAll(",", "")) > 0) || Number(value.replaceAll(",", "")) > 100000000)) continue;
    if (item.field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) continue;
    if (item.field === "phone" && !/^[+\d][\d\s().-]{5,49}$/.test(value)) continue;
    if (item.field === "unit" && !/^(MT|KG|L|litres?|drums?|bags?)$/i.test(value)) continue;
    if (draft[item.field] && draft[item.field]!.toLowerCase() !== value.toLowerCase()) conflicts.add(item.field);
    draft[item.field] = value;
  }
  for (const field of conflicts) delete draft[field];
  if (!draft.unit) delete draft.quantity;
  if (draft.quantity) {
    // A model cannot combine a packaging quantity with another phrase's unit.
    const phrases = [...source.matchAll(/(?<![-\d.,])\b(\d[\d,]*(?:\.\d+)?)\s*(MT|KG|L|litres?|drums?|bags?)\b/gi)];
    const matched = phrases.some(match=>match[1].replaceAll(",", "") === draft.quantity!.replaceAll(",", "") && match[2].toLowerCase() === draft.unit!.toLowerCase());
    if (!matched) {delete draft.quantity; delete draft.unit;}
    else draft.quantity = draft.quantity.replaceAll(",", "");
  }
  return draft;
}
