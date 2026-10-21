import { NextResponse } from "next/server";
import { currentActor, checkOrigin } from "@/lib/auth";
import { getDb, isPreview } from "@/lib/db";
import { HrError, hrCommandSchema } from "@/lib/hr/model";
import { hrChange, hrView } from "@/lib/hr/store";
import { hrStorage } from "@/lib/hr/storage";
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
function failure(e: unknown) {
  return reply(
    {
      error:
        e instanceof HrError
          ? e.message
          : "The HR register is not ready. Please ask your administrator to complete the local setup, then refresh.",
    },
    e instanceof HrError ? e.status : 503,
  );
}
export async function GET(request: Request) {
  const a = await currentActor();
  if (!a) return reply({ error: "Please sign in again." }, 401);
  try {
    const db = await getDb();
    if (!db) throw new HrError(503, "The HR database is not connected.");
    const view = await hrView(
      db,
      a,
      new URL(request.url).searchParams.get("company") || undefined,
    );
    view.uploads = Boolean(await hrStorage());
    return reply(view);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
  } catch {
    return reply({ error: "Please reopen this page before saving." }, 403);
  }
  const a = await currentActor();
  if (!a) return reply({ error: "Please sign in again." }, 401);
  if (isPreview())
    return reply(
      { error: "Fictional preview changes stay in this browser." },
      403,
    );
  if (Number(request.headers.get("content-length")) > 64000)
    return reply(
      { error: "This HR entry is too long. Please shorten the notes." },
      413,
    );
  const parsed = hrCommandSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return reply(
      {
        error:
          "Please complete the required fields and check dates, amounts and review notes.",
        fields: Object.fromEntries(
          parsed.error.issues.map((i) => [i.path.join("."), i.message]),
        ),
      },
      400,
    );
  try {
    const db = await getDb();
    if (!db) throw new HrError(503, "The HR database is not connected.");
    return reply({ entry: await hrChange(db, a, parsed.data) });
  } catch (e) {
    return failure(e);
  }
}
