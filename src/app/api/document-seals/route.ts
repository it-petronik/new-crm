import { and, eq } from "drizzle-orm";
import { currentActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { findRecord } from "@/lib/data";
import type { RecordItem } from "@/lib/domain";
import { approvedDocumentSeals } from "@/lib/schema";
import {
  canReadDocumentSeal,
  documentSealSvg,
  PETRONIK_SEAL,
} from "@/lib/pdf/document-seal";

const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
const unavailable = (status = 404) =>
  Response.json(
    {
      error:
        "The approved signature and stamp are not available for this document. Please contact your administrator.",
    },
    { status, headers },
  );
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return unavailable(401);
  const params = new URL(request.url).searchParams;
  const id = params.get("recordId") || "";
  if (!id || id.length > 100 || params.get("version") !== PETRONIK_SEAL.id)
    return unavailable();
  try {
    const db = await getDb();
    if (!db) return unavailable(503);
    const record = (await findRecord(db, id))?.payload as
      RecordItem | undefined;
    if (!record || !canReadDocumentSeal(actor, record)) return unavailable();
    const [seal] = await db
      .select()
      .from(approvedDocumentSeals)
      .where(
        and(
          eq(approvedDocumentSeals.id, PETRONIK_SEAL.id),
          eq(approvedDocumentSeals.company, record.company),
        ),
      )
      .limit(1);
    if (!seal) return unavailable(503);
    return new Response(
      await documentSealSvg(seal.signaturePng, seal.stampPng),
      {
        headers: {
          ...headers,
          "Content-Type": "image/svg+xml",
          "Content-Disposition":
            'inline; filename="petronik-approved-seal.svg"',
          "Content-Security-Policy":
            "default-src 'none'; img-src data:; sandbox",
        },
      },
    );
  } catch {
    return unavailable(503);
  }
}
