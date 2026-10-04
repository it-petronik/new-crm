import type { Kind } from "./domain";
import type { FieldSpec } from "./record-profiles";

// Presentation only: never relax the API's validation or workflow rules.
const essentials: Record<Kind, string[]> = {
  leads: ["product", "due"],
  quotations: ["currency", "unit", "due"],
  orders: ["product", "quantity", "unit", "amount", "currency", "due"],
  logistics: ["product", "quantity", "unit", "destination", "due"],
  accounts: ["amount", "currency", "due", "attributes.entryType"],
  customers: ["email", "phone"],
  suppliers: ["product", "email", "phone"],
  products: ["product", "unit"],
  hr: ["contact", "attributes.department", "email", "due"],
  marketing: ["product", "due"],
  it: ["attributes.priority", "due"],
  leave: ["contact", "due", "quantity"],
};

export function isEntryEssential(kind: Kind, field: FieldSpec): boolean {
  return Boolean(field.required) || essentials[kind].includes(field.name);
}

export function entryFields(kind: Kind, fields: FieldSpec[], editing: boolean) {
  return {
    basic: fields.filter((field) => editing || isEntryEssential(kind, field)),
    additional: fields.filter((field) => !editing && !isEntryEssential(kind, field)),
  };
}
