/** Presentation only: never use display names as persisted company/access keys. */
const displayNames: Record<string, string> = {
  // Persisted keys are left exactly as they are; only the label differs.
  Petronik: "Petronik",
  Istanegry: "Istanergy",
};
export function companyName(value: string): string {
  return displayNames[value] || value;
}
/** Commercial documents keep the registered issuer, not the short workspace label. */
export function legalCompanyName(value: string): string {
  return value === "Petronik" ? "PETRONIK FZCO" : companyName(value);
}
