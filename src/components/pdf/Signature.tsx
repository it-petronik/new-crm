import type { DocumentData } from "@/types/document";
import { formatPdfDate } from "@/lib/pdf/format-pdf-date";

export function Signature({ doc }: { doc: DocumentData }) {
  const { signatory } = doc;

  return (
    <div>
      <h2
        className="mb-3 text-base font-bold uppercase"
        style={{ color: "var(--pdf-heading)" }}
      >
        Authorized Signatory
      </h2>

      <div className="grid grid-cols-2 gap-10">
        <div>
          <h3 className="text-sm font-bold">{signatory.companyName}</h3>

          {signatory.signedBy && (
            <p className="mt-1.5 font-semibold">{signatory.signedBy}</p>
          )}
          <p className="mt-0.5 text-slate-500">
            {signatory.designation || "Authorized Signatory"}
          </p>

          <div className="mt-3 flex flex-col gap-2">
            {signatory.stampUrl && (
              <img
                src={signatory.stampUrl}
                alt=""
                className="h-28 w-28 object-contain opacity-90"
              />
            )}
            {signatory.signatureUrl ? (
              <img
                src={signatory.signatureUrl}
                alt=""
                className="h-16 w-40 object-contain"
              />
            ) : (
              <div className="h-12 w-40 border-b border-slate-400" />
            )}
          </div>

          {signatory.date && (
            <p className="mt-3">{formatPdfDate(signatory.date)}</p>
          )}
        </div>

        <div>
          <h3 className="text-sm font-bold">Client Representative</h3>

          <div className="mt-3 space-y-3 text-slate-600">
            <p>Name:</p>
            <p>Title:</p>
            <p>Date:</p>
          </div>
        </div>
      </div>
    </div>
  );
}
