import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkOrigin, currentActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { sharedOptions } from "@/lib/schema";
import { canManageOption, canUseCatalog, capitalizeOption, optionKey } from "@/lib/shared-options";
import { cashEntryProfile, recordProfiles } from "@/lib/record-profiles";
import type { Kind } from "@/lib/domain";

const scope = z.object({ company: z.string().min(1).max(80), catalog: z.string().min(1).max(100) });
const mutation = scope.extend({ id: z.string().max(100).optional(), version: z.number().int().positive().optional(), label: z.string().trim().min(1).max(60).optional() }).strict();
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return reply({ error: "Sign in required." }, 401);
  const parsed = scope.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return reply({ error: "Choose a company and field." }, 400);
  const { company, catalog } = parsed.data;
  if (!canUseCatalog(actor, company, catalog)) return reply({ error: "This field is not available." }, 403);
  const db = await getDb();
  if (!db) return reply({ error: "Database unavailable." }, 503);
  const rows = await db.select().from(sharedOptions).where(and(eq(sharedOptions.company, company), eq(sharedOptions.catalog, catalog))).orderBy(asc(sharedOptions.label));
  return reply({ options: rows.map(r => ({ id: r.id, label: r.label, version: r.version, canManage: canUseCatalog(actor, company, catalog, true) && canManageOption(actor, r.createdBy) })), canAdd: canUseCatalog(actor, company, catalog, true) });
}

async function change(request: Request) {
  try {
    checkOrigin(request);
    const actor = await currentActor();
    if (!actor) return reply({ error: "Sign in required." }, 401);
    const { company, catalog, id, version, label } = mutation.parse(await request.json());
    if (!canUseCatalog(actor, company, catalog, true)) return reply({ error: "You cannot change choices for this field." }, 403);
    const db = await getDb();
    if (!db) return reply({ error: "Database unavailable." }, 503);
    const normalized = optionKey(label || "");
    if (request.method !== "DELETE" && (!normalized || /[\u0000-\u001f\u007f]/.test(label!))) return reply({ error: "Enter a valid option, up to 60 characters." }, 400);
    if (request.method !== "DELETE") {
      const [kind, field] = catalog.split(":");
      const defaults = (kind === "accounts" ? cashEntryProfile : recordProfiles[kind as Kind]).fields.find(f => f.name === field)?.options || [];
      if (defaults.some(v => optionKey(v) === normalized)) return reply({ error: "That is already a built-in choice." }, 409);
      if (field === "unit" && label!.length > 20) return reply({ error: "Units must be 20 characters or fewer." }, 400);
    }
    if (request.method === "POST") {
      const row = { id: crypto.randomUUID(), company, catalog, label: capitalizeOption(label!), normalized, createdBy: actor.id, version: 1, updatedAt: Date.now() };
      const inserted = await db.insert(sharedOptions).values(row).onConflictDoNothing().returning({ id: sharedOptions.id });
      if (!inserted.length) return reply({ error: "That choice already exists." }, 409);
      return reply({ option: { id: row.id, label: row.label, version: 1, canManage: true } }, 201);
    }
    if (!id || !version) return reply({ error: "Refresh the choices and try again." }, 400);
    const guard = and(eq(sharedOptions.id, id), eq(sharedOptions.company, company), eq(sharedOptions.catalog, catalog));
    const [existing] = await db.select().from(sharedOptions).where(guard).limit(1);
    if (!existing) return reply({ error: "This choice no longer exists." }, 404);
    if (!canManageOption(actor, existing.createdBy)) return reply({ error: "Only its creator or a workspace manager can change this choice." }, 403);
    const versionGuard = and(guard, eq(sharedOptions.version, version));
    const changed = request.method === "DELETE"
      ? await db.delete(sharedOptions).where(versionGuard).returning({ id: sharedOptions.id })
      : await db.update(sharedOptions).set({ label: capitalizeOption(label!), normalized, version: version + 1, updatedAt: Date.now() }).where(versionGuard).returning({ id: sharedOptions.id });
    return changed.length ? reply({ ok: true }) : reply({ error: "Someone changed this choice. Refresh and try again." }, 409);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Invalid request origin")) return reply({ error: "Invalid request origin." }, 403);
    if (e instanceof Error && /unique|constraint/i.test(e.message)) return reply({ error: "That choice already exists." }, 409);
    return reply({ error: "Could not update this choice. Check the details and try again." }, 400);
  }
}
export const POST = change;
export const PATCH = change;
export const DELETE = change;
