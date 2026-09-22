import type { DocumentData } from "@/types/document";

function PartyBlock({
  label,
  party,
}: {
  label: string;
  party: DocumentData["from"];
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold text-slate-500">{label}</p>
      <h3 className="text-sm font-bold">{party.name}</h3>
      {party.trn && <p className="mt-1 font-medium">TRN: {party.trn}</p>}
      <div className="mt-2 space-y-0.5">
        {party.address && (
          <p className="whitespace-pre-wrap">{party.address}</p>
        )}
        {party.email && <p>Email: {party.email}</p>}
        {party.phone && <p>Tel: {party.phone}</p>}
      </div>
    </div>
  );
}

/** From / To two-column block, shared by every document type. */
export function PartySection({ doc }: { doc: DocumentData }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-10 border-t border-slate-300 pt-5">
      <PartyBlock label="From:" party={doc.from} />
      <PartyBlock label="To:" party={doc.to} />
    </div>
  );
}
