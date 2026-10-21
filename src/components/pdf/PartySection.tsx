import type { DocumentData } from "@/types/document";
import { ContactLink } from "./ContactLink";

function PartyBlock({
  label,
  party,
  referenceFieldsOnly = false,
}: {
  label: string;
  party: DocumentData["from"];
  referenceFieldsOnly?: boolean;
}) {
  return (
    <div className="pdf-party">
      <p className="mb-1.5 text-[11px] font-semibold text-slate-500">{label}</p>
      <h3 className="text-sm font-bold">{party.name}</h3>
      {party.attention && <p className="mt-1">Attention: {party.attention}</p>}
      {!referenceFieldsOnly && party.trn && <p className="mt-1 font-medium">TRN: {party.trn}</p>}
      <div className="mt-2 space-y-0.5">
        {party.address && (
          <p className="whitespace-pre-wrap">{party.address}</p>
        )}
        {!referenceFieldsOnly && party.email && <p>Email: <ContactLink kind="email" value={party.email} /></p>}
        {!referenceFieldsOnly && party.phone && <p>Tel: <ContactLink kind="phone" value={party.phone} /></p>}
      </div>
    </div>
  );
}

/** From / To two-column block, shared by every document type. */
export function PartySection({ doc, referenceFieldsOnly = false }: { doc: DocumentData; referenceFieldsOnly?: boolean }) {
  return (
    <div className="pdf-party-grid mt-6 grid grid-cols-2 gap-10 border-t border-slate-300 pt-5">
      <PartyBlock label={referenceFieldsOnly ? "Issuer:" : "From:"} party={doc.from} referenceFieldsOnly={referenceFieldsOnly} />
      <PartyBlock label="To:" party={doc.to} referenceFieldsOnly={referenceFieldsOnly} />
    </div>
  );
}
