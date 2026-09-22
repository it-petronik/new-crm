/**
 * Generic sales-document domain types shared by every printable document
 * (Quotation, Proforma Invoice, Tax Invoice, Purchase Order, Commercial Invoice,
 * Delivery Note, ...). A specific document type only ever *narrows* this shape
 * (see quotation.ts / invoice.ts) — it never needs its own layout.
 */

export type DocumentType =
  | "quotation"
  | "proforma"
  | "taxInvoice"
  | "purchaseOrder"
  | "commercialInvoice"
  | "deliveryNote";

export interface DocumentParty {
  name: string;
  trn?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
}

export interface DocumentItem {
  id: string;
  name: string;
  description?: string | null;
  packaging?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  lineTotal: number;
}

export interface DocumentBankAccount {
  accountName: string;
  currency: string;
  accountNumber: string;
  iban?: string | null;
  swift?: string | null;
  bankName: string;
  branch?: string | null;
}

export interface DocumentTotals {
  currency: string;
  subtotal: number;
  vatRate?: number | null;
  vatAmount?: number | null;
  total: number;
  amountInWords?: string | null;
  /** Only rendered when > 0 — e.g. a sales order invoice with a partial payment on record. */
  amountPaid?: number | null;
}

export interface DocumentSignatory {
  companyName: string;
  signedBy?: string | null;
  designation?: string | null;
  stampUrl?: string | null;
  signatureUrl?: string | null;
  date?: string | null;
}

/** Every date a document type might show. Config decides which ones render. */
export interface DocumentDates {
  issueDate?: string | null;
  invoiceDate?: string | null;
  expiryDate?: string | null;
  dueDate?: string | null;
  deliveryDate?: string | null;
}

export interface DocumentData {
  refNo: string;
  from: DocumentParty;
  to: DocumentParty;
  dates: DocumentDates;
  items: DocumentItem[];
  totals: DocumentTotals;
  bankAccount?: DocumentBankAccount | null;
  /** Raw free-text / rich HTML terms & conditions. Omitted from the PDF when empty — no static fallback. */
  termsText?: string | null;
  deliveryTerms?: string | null;
  deliveryTo?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  signatory: DocumentSignatory;
  footerWebsite?: string | null;
}
