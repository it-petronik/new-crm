/** Produce private installation SQL from the approved local masters. Does not
 * connect to any database. Never put its output in a public folder or Git. */
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { PETRONIK_SEAL, documentSealSvg } from "../src/lib/pdf/document-seal";
async function main() {
  const root = resolve("output/pdf");
  const signature = readFileSync(
    resolve(root, "petronik-signature-master.png"),
  );
  const stamp = readFileSync(resolve(root, "petronik-stamp-master.png"));
  const signaturePng = signature.toString("base64"),
    stampPng = stamp.toString("base64");
  await documentSealSvg(signaturePng, stampPng); // refuse altered masters
  const manifest = JSON.parse(
    readFileSync(resolve(root, "petronik-signature-stamp-master.json"), "utf8"),
  );
  const quoted = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const output = resolve(root, "install-approved-petronik-seal.sql");
  writeFileSync(
    output,
    `-- PRIVATE approved Petronik master installation. Apply only to an explicitly authorized database.\nINSERT INTO ApprovedDocumentSeal(id,company,signaturePng,stampPng,sourceSha256,createdAt) VALUES (${[PETRONIK_SEAL.id, "Petronik", signaturePng, stampPng, manifest.sourceSha256].map(quoted).join(",")},${Date.now()}) ON CONFLICT(id) DO NOTHING;\n`,
    { mode: 0o600 },
  );
  chmodSync(output, 0o600);
  console.log(
    "Private approved-master installation SQL prepared in Git-ignored output/pdf. No database was changed.",
  );
  console.log(
    "Signature/stamp checksums verified:",
    createHash("sha256").update(signature).digest("hex") ===
      PETRONIK_SEAL.signatureSha256 &&
      createHash("sha256").update(stamp).digest("hex") ===
        PETRONIK_SEAL.stampSha256,
  );
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
