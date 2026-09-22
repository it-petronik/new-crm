import type { DocumentData } from "@/types/document";

export function BankDetails({ doc }: { doc: DocumentData }) {
  const bankAccount = doc.bankAccount;
  if (!bankAccount) return null;

  return (
    <div className="break-inside-avoid">
      <h2
        className="mb-4 text-base font-bold uppercase"
        style={{ color: "var(--pdf-heading)" }}
      >
        Bank Account Details
      </h2>

      <div className="grid grid-cols-2 gap-x-12 gap-y-4">
        <div>
          <p className="text-slate-500">Bank Name</p>
          <p className="font-semibold">
            {bankAccount.bankName}
            {bankAccount.branch ? ` – ${bankAccount.branch}` : ""}
          </p>
        </div>

        <div>
          <p className="text-slate-500">Account Currency</p>
          <p className="font-semibold">{bankAccount.currency}</p>
        </div>

        <div>
          <p className="text-slate-500">Account Name</p>
          <p className="font-semibold">{bankAccount.accountName}</p>
        </div>

        <div>
          <p className="text-slate-500">Account Number</p>
          <p className="font-semibold">{bankAccount.accountNumber}</p>
        </div>

        <div>
          <p className="text-slate-500">IBAN</p>
          <p className="font-semibold">{bankAccount.iban || "—"}</p>
        </div>

        <div>
          <p className="text-slate-500">SWIFT Code</p>
          <p className="font-semibold">{bankAccount.swift || "—"}</p>
        </div>
      </div>
    </div>
  );
}
