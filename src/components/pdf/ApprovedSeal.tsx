"use client";
import { useState } from "react";
export function ApprovedSeal({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p className="pdf-seal-error" role="alert">
      Approved signature and stamp unavailable. Reload the document before
      printing or issuing.
    </p>
  ) : (
    <img
      className="pdf-approved-seal"
      src={url}
      width={140}
      height={69}
      alt="Approved Petronik signature and company stamp"
      loading="eager"
      onError={() => setFailed(true)}
    />
  );
}
