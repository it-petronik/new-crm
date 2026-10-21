import { eq } from "drizzle-orm";
import { currentActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { contentDisposition } from "@/lib/collab-files";
import { HrError } from "@/lib/hr/model";
import { hrEntry, hrAudit } from "@/lib/hr/store";
import { hrFiles } from "@/lib/hr/tables";
import { hrStorage } from "@/lib/hr/storage";
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'",
};
export async function GET(
  _r: Request,
  context: { params: Promise<{ id: string }> },
) {
  const a = await currentActor();
  if (!a)
    return Response.json(
      { error: "Please sign in again." },
      { status: 401, headers },
    );
  try {
    const db = await getDb();
    if (!db) throw new HrError(503, "The HR database is not connected.");
    const { id } = await context.params,
      f = await db.select().from(hrFiles).where(eq(hrFiles.id, id)).get();
    if (!f) throw new HrError(404, "This document is not available to you.");
    const parent = await hrEntry(db, a, f.entryId); // Authorise every download, including old versions.
    if (parent.kind !== "document")
      throw new HrError(404, "This document is not available to you.");
    const bucket = await hrStorage();
    if (!bucket)
      throw new HrError(503, "Protected document storage is disabled here.");
    const object = await bucket.get(f.storageKey);
    if (!object)
      throw new HrError(
        404,
        "The stored file could not be found. Please ask HR to check its retained version.",
      );
    await hrAudit(db, a, parent, "File downloaded", f.name, null, {
      fileId: f.id,
    });
    return new Response(object.body, {
      headers: {
        ...headers,
        "Content-Type": f.mime,
        "Content-Length": String(object.size),
        "Content-Disposition": contentDisposition(f.name, false),
      },
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof HrError
            ? e.message
            : "We couldn’t open this document. Please try again.",
      },
      { status: e instanceof HrError ? e.status : 503, headers },
    );
  }
}
