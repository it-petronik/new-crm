import { canRead, canWrite, type Actor, type Kind, type RecordItem } from "./domain";

/** Business vocabulary only. Workflow states, roles, money and legal standards
 * are deliberately not configurable: changing them would change behaviour. */
const fields: Partial<Record<Kind, string[]>> = {
  leads: ["source", "unit"], quotations: ["unit"], orders: ["unit"],
  customers: ["attributes.segment"], suppliers: ["attributes.segment"],
  products: ["unit", "attributes.packaging"],
  hr: ["attributes.department", "attributes.workArrangement"],
  it: ["attributes.category"],
  marketing: ["product"],
  accounts: ["attributes.category", "attributes.department", "attributes.paymentMethod"],
};
export function optionCatalog(kind: Kind, field: string) {
  return fields[kind]?.includes(field) ? `${kind}:${field}` : null;
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
