import { z } from "zod";
import { allowedModules, type Actor } from "./domain";

const text = z
  .string()
  .trim()
  .max(160)
  .refine(
    (v) => !/[\u0000-\u001f\u007f]/.test(v),
    "Use a single line of text.",
  );
export const bankDetailsSchema = z
  .object({
    bankName: text.min(1),
    bankAccountName: text.min(1),
    bankAccountNumber: text.min(1),
    bankIban: text,
    bankSwift: text,
    bankBranch: text,
  })
  .strict();
export type BankDetails = z.infer<typeof bankDetailsSchema>;
export type SavedBankAccount = {
  id: string;
  company: string;
  label: string;
  currency: string;
  details: BankDetails;
  version: number;
};
export const bankMutationSchema = z
  .object({
    id: z.string().uuid(),
    company: z.string().min(1).max(80),
    label: text.min(1).max(80),
    currency: z.enum(["USD", "AED", "EUR", "SGD"]),
    details: bankDetailsSchema,
    version: z.number().int().positive().optional(),
  })
  .strict();
export function canUseBankAccounts(
  actor: Actor,
  company: string,
  write = false,
) {
  return (
    actor.companies.includes(company) &&
    allowedModules(actor).includes("accounts") &&
    (!write ||
      (actor.moduleAccess?.accounts !== "read" &&
        ["MD", "MD Assistant", "IT Administrator", "Group Manager", "Accounts Manager", "Accountant"].includes(
          actor.role,
        )))
  );
}
export const bankFieldLabels = {
  bankName: "Bank Name",
  bankAccountName: "Account Holder",
  bankAccountNumber: "Account Number",
  bankIban: "IBAN",
  bankSwift: "SWIFT",
  bankBranch: "Bank Branch",
} as const;
export function bankSnapshot(
  attributes: Record<string, string> = {},
): BankDetails {
  return Object.fromEntries(
    Object.keys(bankFieldLabels).map((key) => [key, attributes[key] || ""]),
  ) as BankDetails;
}
