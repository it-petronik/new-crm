import { canRead, canWrite, type Actor, type Kind, type RecordItem } from "./domain";
import { cashEntryProfile, recordProfiles } from "./record-profiles";

/** Business vocabulary only. Workflow states, roles, money and legal standards
 * are deliberately not configurable: changing them would change behaviour. */
export const catalogFields: Partial<Record<Kind, string[]>> = {
  leads: ["source", "unit"], quotations: ["unit", "attributes.packaging"], orders: ["unit"],
  customers: ["attributes.segment"], suppliers: ["attributes.segment"],
  products: ["unit", "attributes.packaging"],
  hr: ["attributes.department", "attributes.workArrangement"],
  it: ["attributes.category"],
  marketing: ["product"],
  accounts: ["unit", "attributes.packaging", "attributes.deliveryPeriod", "attributes.originCountry", "attributes.loadingPort", "attributes.partialShipment", "attributes.paymentTerms", "attributes.category", "attributes.department", "attributes.paymentMethod"],
};
export function optionCatalog(kind: Kind, field: string) {
  return catalogFields[kind]?.includes(field) ? `${kind}:${field}` : null;
}
export const catalogLabels: Record<string, string> = { source: "Lead Sources", unit: "Quantity Units", product: "Campaign Products", "attributes.segment": "Segments", "attributes.packaging": "Packaging", "attributes.department": "Departments", "attributes.workArrangement": "Work Arrangements", "attributes.category": "Categories", "attributes.paymentMethod": "Payment Methods", "attributes.deliveryPeriod": "Delivery Periods", "attributes.originCountry": "Countries Of Origin", "attributes.loadingPort": "Loading Ports", "attributes.partialShipment": "Partial Shipments", "attributes.paymentTerms": "Payment Terms" };
export function catalogDefaults(catalog: string): string[] {
  const kind = catalogKind(catalog);
  if (!kind) return [];
  const field = catalog.split(":")[1];
  if (field === "unit") return ["MT", "kg", "litre", "drum", "pail", "piece"];
  if (field === "attributes.packaging" && ["accounts", "quotations"].includes(kind)) return ["Bulk", "Drum", "Flexi Bags", "Pail", "IBC"];
  if (field === "attributes.partialShipment") return ["Allowed", "Not Allowed"];
  return (kind === "accounts" ? cashEntryProfile : recordProfiles[kind]).fields.find(f => f.name === field)?.options || [];
}
export function catalogKind(catalog: string): Kind | null {
  const [kind, field] = catalog.split(":");
  return optionCatalog(kind as Kind, field) === catalog ? kind as Kind : null;
}
/** Display labels are capitalized; stored enum values and acronyms stay intact. */
export function capitalizeOption(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/(^|[\s/-])(\p{L})/gu, (_, start, letter: string) => start + letter.toLocaleUpperCase());
}
export function optionKey(value: string) { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
export function canUseCatalog(actor: Actor, company: string, catalog: string, write = false) {
  const kind = catalogKind(catalog);
  if (!kind) return false;
  const scope = { kind, company, branch: actor.branches[0] || "Main", ownerId: actor.id } as RecordItem;
  return write ? canWrite(actor, scope) : canRead(actor, scope);
}
export function canManageOption(actor: Actor, createdBy: string) {
  return actor.id === createdBy || ["MD", "Group Manager", "IT Administrator"].includes(actor.role);
}
export type SharedOption = { id: string; label: string; version: number; canManage: boolean };
