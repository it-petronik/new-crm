import { z } from "zod";
import { canRead, type Actor, type RecordItem } from "../domain";
export const contactRoles = [
  "Purchasing",
  "Decision maker",
  "Technical",
  "Finance",
  "Logistics",
  "Management",
  "Sales",
  "Export",
  "Other",
] as const;
const text = z.string().trim().max(300).default("");
export const contactInput = z
  .object({
    name: z.string().trim().min(1).max(160),
    jobTitle: text,
    role: text,
    email: z.union([z.email(), z.literal("")]).default(""),
    phone: z.string().max(50).default(""),
    whatsapp: z.string().max(50).default(""),
    country: text,
    notes: z.string().max(3000).default(""),
    active: z.boolean().default(true),
  })
  .strict();
export const capabilityInput = z
  .object({
    grade: text,
    originCountry: text,
    moq: z.number().nonnegative().max(1e9).nullable().default(null),
    moqUnit: text,
    packaging: text,
    leadTime: text,
    notes: z.string().max(3000).default(""),
    active: z.boolean().default(true),
  })
  .strict();
export type ContactDetails = z.infer<typeof contactInput>;
export type CapabilityDetails = z.infer<typeof capabilityInput>;
export type Contact = ContactDetails & {
  id: string;
  parentId: string;
  version: number;
};
export type Capability = CapabilityDetails & {
  id: string;
  supplierId: string;
  productId: string;
  version: number;
  supplier?: string;
  product?: string;
};
export class CommercialError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const unavailable = () => new CommercialError(404, "Record not found.");
export const normalizedName = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const legalSuffixes = new Set(["llc", "l l c", "ltd", "limited", "fze", "fzco", "fz", "fzc", "fzllc", "inc", "co", "company", "corp", "corporation", "plc", "pte", "pvt", "private", "gmbh", "sa", "bv", "srl", "spa", "llp", "est", "establishment"]);
/**
 * A company name without its legal form ("Petrochem Trading LLC" and
 * "Petrochem Trading" share "petrochem trading"). Deterministic: no fuzzy
 * scoring, only trailing legal-form words are removed.
 */
export function companyCore(name: string) {
  const words = normalizedName(name.replace(/\./g, "")).split(" ").filter(Boolean);
  while (words.length > 1 && legalSuffixes.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}
export function duplicateReasons(
  a: { title?: string; name?: string; email?: string; phone?: string },
  b: typeof a,
  names = true,
) {
  const reasons: string[] = [];
  const name = normalizedName(a.title || a.name || "");
  if (names && name && name === normalizedName(b.title || b.name || ""))
    reasons.push("Same normalized name");
  if (
    a.email?.trim() &&
    a.email.trim().toLowerCase() === b.email?.trim().toLowerCase()
  )
    reasons.push("Same email");
  const phone = (a.phone || "").replace(/\D/g, "");
  if (phone.length >= 7 && phone === (b.phone || "").replace(/\D/g, ""))
    reasons.push("Same phone");
  const domain = a.email?.trim().toLowerCase().split("@")[1];
  if (
    names &&
    domain &&
    ![
      "gmail.com",
      "outlook.com",
      "hotmail.com",
      "yahoo.com",
      "icloud.com",
      "aol.com",
      "live.com",
    ].includes(domain) &&
    domain === b.email?.trim().toLowerCase().split("@")[1]
  )
    reasons.push("Same business email domain");
  return reasons;
}
export function customerRelationships(
  customer: RecordItem,
  records: RecordItem[],
  actor: Actor,
) {
  const visible = records.filter(
    (r) =>
      !r.deletedAt &&
      r.company === customer.company &&
      r.branch === customer.branch &&
      canRead(actor, r),
  );
  return {
    linked: visible.filter((r) => r.customerId === customer.id),
    legacy: visible.filter(
      (r) =>
        !r.customerId &&
        ["leads", "quotations", "orders", "logistics", "accounts"].includes(
          r.kind,
        ) &&
        normalizedName(r.title) === normalizedName(customer.title),
    ),
  };
}
