/** Presentation only: never use display names as persisted company/access keys. */
const displayNames: Record<string, string> = {
  // Persisted keys are left exactly as they are; only the label differs.
  Petronik: "PETRONIK FZCO",
  Istanegry: "Istanergy",
};
export function companyName(value: string): string {
  return displayNames[value] || value;
}
