import { z } from "zod";
import { redactSensitive } from "../ai/sanitize";

export const intakeSchema = z.object({
  category: z.enum(["sales", "customer", "it", "other"]),
  summary: z.string().max(600),
  company: z.string().max(160),
  contact: z.string().max(160),
  product: z.string().max(160),
  quantity: z.number().nonnegative().nullable(),
  unit: z.string().max(30),
  evidence: z.array(z.string().max(240)).max(5),
}).strict();
export type MailIntake = z.infer<typeof intakeSchema>;

// Deterministic local substitute, never presented as an AI model response.
// It extracts only literal labelled values and refuses ambiguous categories.
export function simulateIntake(subject: string, body: string): MailIntake {
  const text = redactSensitive(`${subject}\n${body}`).slice(0, 12000);
  const sales = /\b(quotation|quote|enquiry|pricing|purchase|availability)\b/i.test(text);
  const it = /\b(password|printer|laptop|login|network|computer|technical issue|IT support)\b/i.test(text);
  const customer = /\b(customer registration|register our company|customer account)\b/i.test(text);
  const count = Number(sales) + Number(it) + Number(customer);
  const quantity = text.match(/\b(\d+(?:\.\d+)?)\s*(MT|kg|litres?|tons?|units?)\b/i);
  const label = (name: string) => text.match(new RegExp(`^${name}:\\s*([^\\n]+)`, "im"))?.[1].trim().slice(0, 160) || "";
  return intakeSchema.parse({ category: count !== 1 ? "other" : it ? "it" : customer ? "customer" : "sales",
    summary: redactSensitive(subject).slice(0, 600), company: label("Company"), contact: label("Contact"),
    product: label("Product") || text.match(/\b(?:Base Oil\s+)?SN\s*\d{2,4}\b/i)?.[0] || "", quantity: quantity ? Number(quantity[1]) : null, unit: quantity?.[2] || "",
    evidence: text.split("\n").filter(s => s.trim()).slice(0, 3).map(s => s.slice(0, 240)),
  });
}
