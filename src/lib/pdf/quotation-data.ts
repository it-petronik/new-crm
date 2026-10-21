import { type RecordItem, totalCents } from "../domain";
import { legalCompanyName as companyName } from "../company-name";
import { type DocumentData } from "@/types/document";
import { companyFooter } from "./company-footer";
import { documentSealUrl } from "./document-seal";
export function quotationData(r: RecordItem, connected = false): DocumentData {
  const a = r.attributes || {};
  const lines = r.lines?.length
    ? r.lines
    : [
        {
          description: r.product,
          quantity: r.quantity || 1,
          unitPriceCents: Math.round((r.amount * 100) / (r.quantity || 1)),
        },
      ];
  const files: Record<string, string> = {
    Petronik: "petronik",
    Afrilube: "afrilube",
    Petronex: "petronex",
    Istanegry: "istanergy",
    Enercore: "enercore-lockup",
  };
  const total = totalCents(lines) / 100;
  const footer = companyFooter(r.company);
  return {
    refNo: a.quoteReference || r.id,
    from: {
      name: companyName(a.senderName || r.company),
      address: a.senderAddress,
      trn: a.senderTaxNumber,
      phone: a.senderPhone,
      email: a.senderEmail,
      logoUrl: files[r.company] ? `/brands/${files[r.company]}.${["Istanegry", "Enercore", "Petronex"].includes(r.company) ? "svg" : "png"}` : undefined,
    },
    to: {
      name: r.title,
      attention: r.contact,
      address: a.customerAddress,
      trn: a.customerTaxNumber,
      email: r.email,
      phone: r.phone,
    },
    dates: {
      issueDate: a.issuedDate || r.createdAt.slice(0, 10),
      expiryDate: r.due,
    },
    items: lines.map((l, i) => ({
      id: String(i),
      name: "itemName" in l && l.itemName ? l.itemName : l.description,
      description: "itemName" in l && l.itemName ? l.description : undefined,
      packaging: l.packaging || "",
      quantity: l.quantity,
      unit: r.unit?.toLowerCase() === "kg" ? "kg" : r.unit?.toLowerCase() === "mt" ? "MT" : r.unit,
      unitPrice: l.unitPriceCents / 100,
      lineTotal: Math.round(l.quantity * l.unitPriceCents) / 100,
    })),
    totals: { currency: r.currency, subtotal: total, total },
    deliveryTerms: a.incoterm === "Not specified" ? undefined : a.incoterm,
    deliveryTo: [r.destination, a.country].filter(Boolean).join(", "),
    paymentTerms: a.paymentTerms,
    termsText: r.detail || undefined,
    signatory: {
      companyName: companyName(a.senderName || r.company),
      approvedSealUrl: documentSealUrl(r, connected),
      signedBy: a.signatoryName || "",
      designation: a.signatoryTitle,
      date: a.issuedDate || r.createdAt.slice(0, 10),
    },
    footerMessage: footer.message,
    footerWebsite: footer.website,
    footerContacts: footer,
  };
}
