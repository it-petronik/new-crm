import { NextResponse } from "next/server";
import { z } from "zod";
import { currentActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canRead, type RecordItem } from "@/lib/domain";
import { canViewManagement } from "@/lib/management-dashboard";
import { inAdminScope } from "@/lib/access-control";
import { listManagementPage, listUsers } from "@/lib/data";

export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor)
    return NextResponse.json(
      { error: "Sign in to view the management overview." },
      { status: 401 },
    );
  if (!canViewManagement(actor))
    return NextResponse.json(
      { error: "This overview is available to management only." },
      { status: 403 },
    );
  const query = z
    .object({
      after: z.string().max(100).default(""),
      asOf: z.iso.datetime().optional(),
    })
    .strict()
    .safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success)
    return NextResponse.json(
      { error: "Refresh the management overview to try again." },
      { status: 400 },
    );
  const db = await getDb();
  if (!db)
    return NextResponse.json(
      { error: "The management overview could not connect. Please try again." },
      { status: 503 },
    );
  try {
    const asOf = query.data.asOf || new Date().toISOString();
    const [rows, users] = await Promise.all([
      listManagementPage(db, actor, query.data.after, new Date(asOf)),
      query.data.after ? Promise.resolve([]) : listUsers(db),
    ]);
    return NextResponse.json(
      {
        records: rows
          .map((r) => r.payload as RecordItem)
          .filter((r) => !r.deletedAt && canRead(actor, r)),
        // The roster never includes password hashes, email or security fields.
        people: users
          .filter((p) => inAdminScope(actor, p.companies, p.branches))
          .map((p) => ({
            id: p.id,
            name: p.name,
            role: p.role,
            companies: p.companies,
            branches: p.branches,
            active: p.active,
          })),
        asOf,
        next: rows.length === 500 ? rows.at(-1)!.id : null,
      },
      { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "The overview could not refresh. Your records have not changed. Please try again.",
      },
      { status: 503 },
    );
  }
}
