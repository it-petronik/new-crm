import { NextResponse } from "next/server";
import { checkOrigin, currentActor } from "@/lib/auth";
import { getDb, isPreview } from "@/lib/db";
import { detectFile, safeFileName } from "@/lib/collab-files";
import { HrError, mayEditHr } from "@/lib/hr/model";
import {
  hrEntry,
  hrRevisionNumber,
  revisionClaim,
  hrAudit,
  conflict,
} from "@/lib/hr/store";
import { hrFiles } from "@/lib/hr/tables";
import { hrStorage } from "@/lib/hr/storage";
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
export async function POST(request: Request) {
  try {
    checkOrigin(request);
  } catch {
    return reply({ error: "Please reopen this page before uploading." }, 403);
  }
  const a = await currentActor();
  if (!a) return reply({ error: "Please sign in again." }, 401);
  try {
    if (isPreview())
      throw new HrError(
        403,
        "Real documents are not stored in the fictional browser preview.",
      );
    const db = await getDb();
    if (!db) throw new HrError(503, "The HR database is not connected.");
    const id = new URL(request.url).searchParams.get("entry") || "";
    const revision = await hrRevisionNumber(db),
      parent = await hrEntry(db, a, id);
    if (
      parent.kind !== "document" ||
      parent.status !== "Recorded" ||
      !mayEditHr(a, parent)
    )
      throw new HrError(
        403,
        "Only an authorised document manager can attach a file to this current document.",
      );
    const bucket = await hrStorage();
    if (!bucket)
      throw new HrError(
        503,
        "Protected uploads are disabled here. Local testing must be enabled by your administrator; live uploads remain on hold.",
      );
    const max = 10485760 + 65536;
    if (Number(request.headers.get("content-length")) > max)
      throw new HrError(413, "Choose a PDF, PNG or JPEG no larger than 10 MB.");
    const reader = request.body?.getReader();
    if (!reader) throw new HrError(400, "Choose a file to upload.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        length += r.value.length;
        if (length > max) {
          await reader.cancel();
          throw new HrError(
            413,
            "This upload is too large. Choose a file no larger than 10 MB.",
          );
        }
        chunks.push(r.value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const c of chunks) {
      body.set(c, offset);
      offset += c.length;
    }
    const form = await new Response(body, {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 10485760)
      throw new HrError(
        400,
        "Choose a non-empty PDF, PNG or JPEG no larger than 10 MB.",
      );
    const bytes = new Uint8Array(await file.arrayBuffer()),
      detected = detectFile(bytes, file.name);
    if (
      !detected ||
      !["application/pdf", "image/png", "image/jpeg"].includes(
        detected.mimeType,
      )
    )
      throw new HrError(
        400,
        "Only PDF, PNG and JPEG files are accepted. Export other documents to PDF first.",
      );
    const fileId = crypto.randomUUID(),
      storageKey = `hr-private/${crypto.randomUUID()}`,
      createdAt = Date.now();
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const row = {
      id: fileId,
      entryId: id,
      storageKey,
      name: safeFileName(file.name),
      mime: detected.mimeType,
      size: bytes.length,
      sha256: Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
      createdBy: a.id,
      createdAt,
    };
    await bucket.put(storageKey, bytes, {
      httpMetadata: { contentType: row.mime },
    });
    try {
      await db.batch([
        revisionClaim(db, revision),
        db.insert(hrFiles).values(row),
        hrAudit(db, a, parent, "File uploaded", row.name, null, {
          fileId,
          size: row.size,
          sha256: row.sha256,
        }),
      ]);
    } catch (e) {
      await bucket.delete(storageKey);
      conflict(e);
    }
    return reply({
      file: {
        id: fileId,
        entryId: id,
        name: row.name,
        mime: row.mime,
        size: row.size,
        createdBy: a.id,
        createdAt,
      },
    });
  } catch (e) {
    return reply(
      {
        error:
          e instanceof HrError
            ? e.message
            : "We couldn’t upload this document. Check the file and try again.",
      },
      e instanceof HrError ? e.status : 503,
    );
  }
}
