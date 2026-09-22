export const quoteSections = [
  "Customer & delivery",
  "Items & pricing",
  "Sender & terms",
] as const;
export function quoteSection(name: string): number {
  if (["currency", "unit", "attributes.amountWords"].includes(name)) return 1;
  if (
    name.startsWith("attributes.sender") ||
    name.startsWith("attributes.signatory") ||
    ["attributes.paymentTerms", "detail"].includes(name)
  )
    return 2;
  return 0;
}
export function fieldWidth(name: string): string {
  return /address|amountWords/i.test(name) ||
    ["title", "email", "product", "attributes.senderName"].includes(name)
    ? "field-wide"
    : "";
}
