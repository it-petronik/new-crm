import { type Kind, type RecordItem, money } from "./domain";
import { salaryTotal } from "./salary";
export type FieldSpec = {
  name: string;
  label: string;
  type?: "number" | "date" | "email";
  options?: string[];
  required?: boolean;
  placeholder?: string;
  min?: number;
  /** Rarely needed now: shown under "More details" in create/edit forms. */
  advanced?: boolean;
};
type Profile = {
  title: string;
  noun: string;
  description: string;
  nameLabel: string;
  notes: string;
  unit: string;
  fields: FieldSpec[];
};
const date = (label: string): FieldSpec => ({
  name: "due",
  label,
  type: "date",
  required: true,
});
const contact: FieldSpec = { name: "contact", label: "Contact person" };
const email: FieldSpec = { name: "email", label: "Email", type: "email" };
const phone: FieldSpec = { name: "phone", label: "Phone" };
const currency: FieldSpec = {
  name: "currency",
  label: "Currency",
  options: ["USD", "AED", "EUR", "SGD"],
};
const product: FieldSpec = { name: "product", label: "Product / Grade" };
const quantity: FieldSpec = {
  name: "quantity",
  label: "Quantity",
  type: "number",
  min: 0,
};
const units: FieldSpec = {
  name: "unit",
  label: "Unit",
  options: ["MT", "kg", "litre", "drum", "pail", "piece"],
};
const destination: FieldSpec = {
  name: "destination",
  label: "Destination / Port",
};
const country: FieldSpec = {
  name: "attributes.country",
  label: "Destination country",
  placeholder: "e.g. Vietnam (use the full country name)",
};
/** Rarely needed at creation: waits under "More details". */
const more = (field: FieldSpec): FieldSpec => ({ ...field, advanced: true });
const value: FieldSpec = {
  name: "amount",
  label: "Order value",
  type: "number",
  min: 0,
};
export const recordProfiles: Record<Kind, Profile> = {
  leads: {
    title: "New lead",
    noun: "Lead",
    description: "Who is asking, what they need, and when to follow up.",
    nameLabel: "Customer / company",
    notes: "Notes",
    unit: "MT",
    fields: [
      contact,
      { ...product, label: "Product needed" },
      quantity,
      units,
      destination,
      date("Next follow-up"),
      more({ ...value, label: "Estimated value" }),
      more(currency),
      more({
        name: "source",
        label: "Lead source",
        options: [
          "Manual",
          "Website",
          "Email",
          "WhatsApp",
          "LinkedIn",
          "Referral",
          "Distributor",
          "Trade event",
        ],
      }),
      more(email),
      more(phone),
      more(country),
    ],
  },
  quotations: {
    title: "New quotation",
    noun: "Quotation",
    description:
      "Prepare itemised pricing, delivery terms and validity for your customer.",
    nameLabel: "Customer / Company",
    notes: "Commercial terms & notes",
    unit: "MT",
    fields: [
      {
        name: "attributes.quoteReference",
        label: "Quotation reference",
        placeholder: "Optional customer-facing reference",
      },
      {
        name: "attributes.issuedDate",
        label: "Issue date",
        type: "date",
        required: true,
      },
      {
        name: "attributes.senderName",
        label: "Sender legal name",
        required: true,
      },
      {
        name: "attributes.senderAddress",
        label: "Sender address",
        required: true,
      },
      { name: "attributes.senderTaxNumber", label: "Sender tax / TRN number" },
      { name: "attributes.senderPhone", label: "Sender telephone" },
      { name: "attributes.senderWebsite", label: "Sender website" },
      {
        name: "attributes.customerAddress",
        label: "Customer address",
        required: true,
      },
      {
        name: "attributes.customerTaxNumber",
        label: "Customer tax / TRN number",
      },
      contact,
      email,
      phone,
      currency,
      units,
      date("Valid until"),
      destination,
      country,
      { name: "attributes.signatoryName", label: "Authorized signatory name" },
      {
        name: "attributes.signatoryTitle",
        label: "Authorized signatory title",
      },
      {
        name: "attributes.amountWords",
        label: "Amount in words (calculated)",
      },
      {
        name: "attributes.incoterm",
        label: "Incoterm",
        options: [
          "Not specified",
          "EXW",
          "FCA",
          "FOB",
          "CFR",
          "CIF",
          "DAP",
          "DDP",
        ],
      },
      {
        name: "attributes.paymentTerms",
        label: "Payment terms",
        placeholder: "e.g. Advance payment",
      },
    ],
  },
  customers: {
    title: "Add customer",
    noun: "Customer",
    description: "A company you sell to. Only the name is required.",
    nameLabel: "Company name",
    notes: "Notes",
    unit: "",
    fields: [
      { ...country, label: "Country", placeholder: "e.g. Vietnam" },
      { ...contact, label: "Main contact" },
      email,
      phone,
      more({ name: "destination", label: "City" }),
      more({ name: "attributes.address", label: "Billing address" }),
      more({ name: "attributes.taxNumber", label: "Tax / TRN number" }),
      more({ name: "product", label: "Products of interest" }),
      more({
        name: "attributes.segment",
        label: "Customer segment",
        options: [
          "Distributor",
          "Manufacturer",
          "Trader",
          "Contractor",
          "End user",
          "Other",
        ],
      }),
      more({
        name: "attributes.paymentTerms",
        label: "Agreed payment terms",
        placeholder: "e.g. Net 30 — subject to credit approval",
      }),
    ],
  },
  suppliers: {
    title: "Add supplier",
    noun: "Supplier",
    nameLabel: "Company name",
    description: "A company you buy from. Only the name is required.",
    notes: "Notes",
    unit: "",
    fields: [
      { ...country, label: "Country", placeholder: "e.g. India" },
      { ...contact, label: "Main contact" },
      email,
      phone,
      { name: "product", label: "Products supplied" },
      more({ name: "attributes.address", label: "Business address" }),
      more({ name: "attributes.taxNumber", label: "Tax / TRN number" }),
      more({ name: "attributes.supplierCode", label: "Supplier code" }),
      more({ name: "attributes.website", label: "Website" }),
      more({ name: "attributes.paymentTerms", label: "Payment terms" }),
      more({ name: "attributes.leadTime", label: "Typical lead time" }),
      more(currency),
    ],
  },
  products: {
    title: "Add product",
    noun: "Product",
    description: "A product you trade, with its grade and selling unit.",
    nameLabel: "Product name",
    notes: "Specification notes",
    unit: "MT",
    fields: [
      { name: "product", label: "Grade / Specification", required: true },
      units,
      {
        name: "attributes.packaging",
        label: "Packaging",
        options: ["Bulk", "Flexitank", "Drums", "Pails", "Bags", "Other"],
      },
      more({ name: "attributes.sku", label: "SKU / Product code" }),
      more({ ...quantity, label: "Recorded stock quantity" }),
      more({ ...value, label: "Indicative unit price" }),
      more(currency),
    ],
  },
  hr: {
    title: "Add employee",
    noun: "Employee profile",
    description:
      "Create an employee record. This does not provision a login or grant access.",
    nameLabel: "Employee full name",
    notes: "Employment notes",
    unit: "",
    fields: [
      { name: "contact", label: "Job title", required: true },
      {
        name: "attributes.department",
        label: "Department",
        options: [
          "Sales",
          "Logistics",
          "Accounts",
          "HR",
          "Marketing",
          "IT",
          "Management",
        ],
      },
      { name: "attributes.employeeId", label: "Employee ID" },
      {
        name: "attributes.employeeRole",
        label: "Employee role",
        options: ["Employee", "Manager", "Assistant", "MD"],
      },
      {
        name: "attributes.workArrangement",
        label: "Work arrangement",
        options: ["On-site", "Remote"],
      },
      {
        name: "attributes.basicSalary",
        label: "Basic salary",
        type: "number",
        min: 0,
      },
      {
        name: "attributes.allowance",
        label: "Allowance",
        type: "number",
        min: 0,
      },
      {
        name: "attributes.salaryCurrency",
        label: "Salary currency",
        options: ["AED", "USD", "EUR", "INR"],
      },
      email,
      phone,
      { name: "destination", label: "Office / Work location" },
      date("Joining date"),
    ],
  },
  leave: {
    title: "Request leave",
    noun: "Leave request",
    description: "Specify the leave period and reason for the approval review.",
    nameLabel: "Leave type / Request",
    notes: "Reason for leave",
    unit: "days",
    fields: [
      { name: "contact", label: "Employee name", required: true },
      date("Start date"),
      { ...quantity, label: "Working days", min: 1, required: true },
    ],
  },
  it: {
    title: "Create support ticket",
    noun: "Support ticket",
    description:
      "Tell IT what is affected, how urgent it is, and when help is needed.",
    nameLabel: "Issue summary",
    notes: "Problem description / Steps to reproduce",
    unit: "request",
    fields: [
      { name: "contact", label: "Requested by", required: true },
      {
        name: "attributes.category",
        label: "Category",
        options: [
          "Hardware",
          "Software",
          "Email",
          "Network",
          "Access request",
          "Other",
        ],
      },
      {
        name: "attributes.priority",
        label: "Priority",
        options: ["Normal", "Low", "High", "Urgent"],
      },
      { name: "product", label: "Affected device / Application" },
      date("Needed by"),
      email,
    ],
  },
  marketing: {
    title: "New campaign",
    noun: "Campaign brief",
    description:
      "Define the audience, channel and budget before outreach begins.",
    nameLabel: "Campaign name",
    notes: "Campaign brief / Objective",
    unit: "leads",
    fields: [
      {
        name: "product",
        label: "Channel",
        options: [
          "LinkedIn",
          "Email",
          "Website",
          "Trade event",
          "WhatsApp",
          "Other",
        ],
      },
      { name: "attributes.audience", label: "Target audience" },
      { ...value, label: "Planned budget" },
      currency,
      { ...quantity, label: "Lead target" },
      date("Target date"),
    ],
  },
  orders: {
    title: "Sales order",
    noun: "Sales order",
    description: "Commercial handover from an accepted quotation.",
    nameLabel: "Customer",
    notes: "Order instructions",
    unit: "MT",
    fields: [
      product,
      quantity,
      units,
      value,
      currency,
      contact,
      date("Required by"),
      destination,
      country,
    ],
  },
  logistics: {
    title: "Shipment",
    noun: "Shipment details",
    description: "Delivery coordination and shipment progress.",
    nameLabel: "Customer",
    notes: "Route / Shipment instructions",
    unit: "MT",
    fields: [
      product,
      quantity,
      units,
      destination,
      date("Expected delivery"),
      contact,
    ],
  },
  accounts: {
    title: "Invoice",
    noun: "Invoice details",
    description: "Invoice value, due date and recorded collections.",
    nameLabel: "Customer",
    notes: "Invoice notes",
    unit: "MT",
    fields: [
      { ...value, label: "Invoice amount" },
      currency,
      date("Payment due"),
      contact,
      email,
    ],
  },
};
export function recordFieldValue(record: RecordItem, name: string): string {
  if (name === "attributes.basicSalary") return record.attributes?.basicSalary ?? record.attributes?.monthlySalary ?? "";
  if (name.startsWith("attributes."))
    return record.attributes?.[name.slice(11)] || "";
  const value = record[name as keyof RecordItem];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}
export function detailFields(record: RecordItem): [string, string][] {
  const profile = record.kind === "accounts" && record.attributes?.entryType ? cashEntryProfile : recordProfiles[record.kind];
  const rows: [string, string][] = [
    ...profile.fields
      .filter((f) => f.name !== "currency" && f.name !== "unit")
      .map(
        (f) =>
          [
            f.label,
            f.name === "amount"
              ? money(record.amount, record.currency)
              : f.name === "quantity"
                ? `${typeof record.quantity === "number" ? record.quantity.toLocaleString("en-US") : record.quantity} ${record.kind === "leave" || record.kind === "marketing" ? profile.unit : record.unit}`.trim()
                : recordFieldValue(record, f.name) || "—",
          ] as [string, string],
      ),
  ];
  if (record.kind === "hr") {
    // The monthly total is derived, never entered, so it is shown beside its parts.
    const total = salaryTotal(record.attributes);
    if (total) {
      const currencyLabel = record.attributes?.salaryCurrency || "";
      const after = rows.findIndex(([label]) => label === "Salary currency");
      rows.splice(after < 0 ? rows.length : after + 1, 0, [
        "Monthly total",
        `${total}${currencyLabel ? ` ${currencyLabel}` : ""}`,
      ]);
    }
  }
  rows.push(["Record owner", record.owner]);
  return rows;
}
export const cashEntryProfile: Profile = {
  title: "Add income or expense", noun: "Cashbook entry", description: "Record money received or spent. Do not re-enter invoice payments here.", nameLabel: "Description", notes: "Notes", unit: "entry",
  fields: [
    { name: "attributes.entryType", label: "Entry type", options: ["Expense", "Income"], required: true },
    { name: "amount", label: "Amount", type: "number", min: 0.01, required: true }, currency,
    date("Transaction date"),
    { name: "attributes.category", label: "Category", options: ["Office", "Rent", "Utilities", "Travel", "Logistics", "Marketing", "Payroll", "IT", "Other income", "Other expense"], required: true },
    { name: "attributes.paymentMethod", label: "Payment method", options: ["Bank transfer", "Cash", "Card", "Cheque"], required: true },
    { name: "contact", label: "Paid to / Received from" },
    { name: "attributes.reference", label: "Receipt / Bank reference" },
    { name: "attributes.department", label: "Department", options: ["Company", "Sales", "Logistics", "Accounts", "Marketing", "HR", "IT"] },
  ],
};
