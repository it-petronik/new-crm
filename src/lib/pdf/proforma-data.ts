import type { RecordItem } from "../domain";
import { quotationData } from "./quotation-data";
import { documentValidity } from "./document-validity";
export function proformaData(r: RecordItem, connected = false) {
  const data = quotationData(r, connected);
  const a = r.attributes || {};
  return {
    ...data,
    dates: { ...data.dates, invoiceDate: data.dates.issueDate },
    extraInfo: [
      { label: "Customer ID", value: a.customerReference },
      { label: "Invoice validity", value: documentValidity(data.dates.issueDate, r.due) },
      { label: "Origin", value: a.originCountry },
      { label: "Port of loading", value: a.loadingPort },
      { label: "Partial Shipment Allowed", value: a.partialShipment },
    ].filter((entry) => entry.value),
    deliveryTerms: [data.deliveryTerms, data.deliveryTo, a.deliveryPeriod].filter(Boolean).join("\n"),
    deliveryTo: undefined,
    notes:
      r.status === "Draft"
        ? "DRAFT — for review only. Not issued. Proforma only: not a tax invoice or proof of payment."
        : r.status === "Cancelled"
          ? "CANCELLED — do not use for payment. Proforma only: not a tax invoice."
          : "Proforma only: not a tax invoice or proof of payment.",
    signatory: { ...data.signatory, signedBy: a.signatoryName || null },
    bankAccount:
      a.bankName && a.bankAccountName && a.bankAccountNumber
        ? {
            bankName: a.bankName,
            accountName: a.bankAccountName,
            accountNumber: a.bankAccountNumber,
            currency: r.currency,
            iban: a.bankIban,
            swift: a.bankSwift,
            branch: a.bankBranch,
          }
        : null,
  };
}
