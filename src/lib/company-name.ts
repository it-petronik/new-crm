/** Presentation only: never use display names as persisted company/access keys. */
export function companyName(value: string): string {
  return value === "Petronik" ? "PETRONIK FZCO" : value;
}
