import {
  allowedModules,
  isProforma,
  totalCents,
  type Actor,
  type RecordItem,
} from "./domain";
import { quotationError } from "./quotation";

/** Bank details are explicit, reviewed input. Never copy them from a PDF. */
export const proformaAttributeKeys = [
  "documentType",
  "customerReference",
  "deliveryPeriod",
  "originCountry",
  "loadingPort",
  "partialShipment",
  "bankName",
  "bankAccountName",
  "bankAccountNumber",
  "bankIban",
  "bankSwift",
  "bankBranch",
] as const;
export function canCreateProforma(
  actor: Actor,
  company: string,
  branch: string,
) {
  return (
    ["Accounts Manager", "Accountant"].includes(actor.role) &&
    allowedModules(actor).includes("accounts") &&
    actor.moduleAccess?.accounts !== "read" &&
    actor.companies.includes(company) &&
    (!actor.branches.length || actor.branches.includes(branch))
  );
}
export function proformaError(
  r: Pick<
    RecordItem,
    "kind" | "attributes" | "lines" | "due" | "title" | "customerId" | "unit"
  >,
): string {
  if (!isProforma(r)) return "";
  if (r.attributes?.entryType)
    return "A proforma cannot also be a cashbook entry.";
  if (!r.customerId) return "Choose a customer for this proforma.";
  if (!r.title.trim()) return "Choose a customer name.";
  if (!r.unit.trim()) return "Choose a quantity unit.";
  if (
    (r.lines || []).some(
      (l) =>
        !l.description.trim() ||
        (l.itemName?.length || 0) > 160 ||
        l.description.length > 200 ||
        l.quantity > 1000000 ||
        l.unitPriceCents > 100000000 ||
        (l.packaging?.length || 0) > 100,
    )
  )
    return "Check each item description, quantity, price and packaging.";
  const error = quotationError(
    r.lines || [],
    r.attributes?.issuedDate || "",
    r.due,
  );
  if (error) return error;
  if (
    !Number.isSafeInteger(totalCents(r.lines || [])) ||
    totalCents(r.lines || []) > 100000000000
  )
    return "The total is too large. Check quantities and prices.";
  const a = r.attributes || {};
  if (
    Object.entries(a).some(
      ([key, value]) => key.startsWith("bank") && value.trim(),
    ) &&
    (!a.bankName?.trim() ||
      !a.bankAccountName?.trim() ||
      !a.bankAccountNumber?.trim())
  )
    return "Complete the bank name, account holder and account number, or leave all bank details blank.";
  return "";
}
/** Stable, collision-resistant reference, not an invented sequential counter. */
export function proformaReference(id: string, date: string) {
  return `PI-${date.slice(0, 7)}-${id
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-16)
    .toUpperCase()}`;
}
