import { type RecordItem, totalCents } from "../domain";
import { companyName } from "../company-name";
import { type DocumentData } from "@/types/document";
export function quotationData(r: RecordItem): DocumentData {
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
  };
  const total = totalCents(lines) / 100;
  return {
    refNo: a.quoteReference || r.id,
    from: {
      name: companyName(a.senderName || r.company),
      address: a.senderAddress,
      trn: a.senderTaxNumber,
      phone: a.senderPhone,
      logoUrl: files[r.company] ? `/brands/${files[r.company]}.png` : undefined,
    },
    to: {
      name: r.title,
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
      name: l.description,
      packaging: l.packaging || "",
      quantity: l.quantity,
      unit: r.unit,
      unitPrice: l.unitPriceCents / 100,
      lineTotal: Math.round(l.quantity * l.unitPriceCents) / 100,
    })),
    totals: { currency: r.currency, subtotal: total, total },
    deliveryTerms: a.incoterm === "Not specified" ? undefined : a.incoterm,
    deliveryTo: [r.destination, a.country].filter(Boolean).join(", "),
    termsText: [a.paymentTerms && `Payment: ${a.paymentTerms}`, r.detail]
      .filter(Boolean)
      .join("\n\n"),
    signatory: {
      companyName: companyName(a.senderName || r.company),
      signedBy: a.signatoryName || "Peiman Hussain",
      designation: a.signatoryTitle,
      date: a.issuedDate || r.createdAt.slice(0, 10),
    },
    footerWebsite:
      a.senderWebsite ||
      {
        Petronik: "www.petronik.ae",
        Afrilube: "www.afrilube.com",
        Petronex: "www.petronex.co",
        Istanegry: "www.istanegry.com",
      }[r.company] ||
      r.company,
  };
}
