import type { DocumentType } from "@/types/document";

/**
 * Everything that varies between document types lives here. Adding a new
 * document type (e.g. "deliveryNote") never touches a component — it only
 * ever adds/edits an entry in this object.
 */
export interface DocumentTypeConfig {
  /** Printed page title, e.g. "PRO-FORMA INVOICE". */
  title: string;
  /** Label for the reference-number badge, e.g. "Invoice#". */
  refLabel: string;
  /** Which DocumentDates fields to render, in order, with their labels. */
  dateFields: Array<{
    key:
      "issueDate" | "invoiceDate" | "expiryDate" | "dueDate" | "deliveryDate";
    label: string;
  }>;
  /** Show the VAT line in the totals block. */
  showVat: boolean;
  /** Show the bank account details section. */
  showBankDetails: boolean;
  /** Show the terms & conditions section when the document has terms text. */
  showTerms: boolean;
  /** Default footer website shown when a document doesn't supply its own. */
  footerWebsite: string;
}

export const documentConfig: Record<DocumentType, DocumentTypeConfig> = {
  quotation: {
    title: "QUOTATION",
    refLabel: "",
    dateFields: [
      { key: "issueDate", label: "Issued" },
      { key: "expiryDate", label: "Valid Until" },
    ],
    showVat: true,
    showBankDetails: false,
    showTerms: true,
    footerWebsite: "www.petronik.ae",
  },
  proforma: {
    title: "PRO-FORMA INVOICE",
    refLabel: "Invoice#",
    dateFields: [
      { key: "invoiceDate", label: "Invoice Date" },
      { key: "expiryDate", label: "Invoice Expiry" },
    ],
    showVat: true,
    showBankDetails: true,
    showTerms: true,
    footerWebsite: "www.petronik.ae",
  },
  taxInvoice: {
    title: "TAX INVOICE",
    refLabel: "Invoice#",
    dateFields: [
      { key: "invoiceDate", label: "Invoice Date" },
      { key: "dueDate", label: "Due Date" },
    ],
    showVat: true,
    showBankDetails: true,
    showTerms: true,
    footerWebsite: "www.petronik.ae",
  },
  purchaseOrder: {
    title: "PURCHASE ORDER",
    refLabel: "PO#",
    dateFields: [
      { key: "issueDate", label: "Order Date" },
      { key: "deliveryDate", label: "Delivery Date" },
    ],
    showVat: true,
    showBankDetails: false,
    showTerms: true,
    footerWebsite: "www.petronik.ae",
  },
  commercialInvoice: {
    title: "COMMERCIAL INVOICE",
    refLabel: "Invoice#",
    dateFields: [
      { key: "invoiceDate", label: "Invoice Date" },
      { key: "dueDate", label: "Due Date" },
    ],
    showVat: true,
    showBankDetails: true,
    showTerms: true,
    footerWebsite: "www.petronik.ae",
  },
  deliveryNote: {
    title: "DELIVERY NOTE",
    refLabel: "DN#",
    dateFields: [{ key: "deliveryDate", label: "Delivery Date" }],
    showVat: false,
    showBankDetails: false,
    showTerms: false,
    footerWebsite: "www.petronik.ae",
  },
};
