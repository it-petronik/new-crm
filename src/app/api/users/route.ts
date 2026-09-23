import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword } from "@/lib/password";
import { getDb } from "@/lib/db";
import {
  listUsers, findUserById, createUser, updateUserAndRevokeSessions, writeAudit,
} from "@/lib/data";
import { currentActor, checkOrigin } from "@/lib/auth";
import {
  roles,
  companies,
  modules,
  canManageUsers,
  type Actor,
} from "@/lib/domain";
import { inAdminScope, mayAssign } from "@/lib/access-control";
/** Never return passwordHash or createdAt to the client. */
type SafeUser = {
  id: string; name: string; email: string; role: string;
  companies: string[]; branches: string[]; active: boolean;
  moduleAccess: Record<string, string> | null;
};
const safeUser = (u: {
  id: string; name: string; email: string; role: string;
  companies: string[]; branches: string[]; active: boolean;
  moduleAccess: Record<string, string> | null;
}): SafeUser => ({
  id: u.id, name: u.name, email: u.email, role: u.role,
  companies: u.companies, branches: u.branches, active: u.active,
  moduleAccess: u.moduleAccess,
});
const accessFields = {
  role: z.enum(roles),
  companies: z.array(z.enum(companies)).min(1).max(4),
  branches: z.array(z.string().trim().min(1).max(80)).max(50),
  moduleAccess: z
    .partialRecord(z.enum(modules), z.enum(["none", "read", "write"]))
    .optional(),
};
const input = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().max(191),
  password: z.string().min(14).max(128),
  ...accessFields,
});
export async function GET() {
  const actor = await currentActor();
  if (!actor || !canManageUsers(actor))
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  const db = await getDb();
  if (!db)
    return NextResponse.json({ users: [] }, { headers: { "Cache-Control": "no-store" } });
  const rows = await listUsers(db);
  return NextResponse.json(
    {
      users: rows
        .map(safeUser)
        .filter((u) => inAdminScope(actor, u.companies, u.branches))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const actor = await currentActor();
    if (!actor || !canManageUsers(actor))
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    const body = input.parse(await request.json());
    if (!mayAssign(actor, null, body))
      return NextResponse.json(
        { error: "Role or scope exceeds your administrative access." },
        { status: 403 },
      );
    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
    const { password, ...fields } = body;
    const passwordHash = await hashPassword(password);
    const id = crypto.randomUUID();
    const row = {
      id,
      name: fields.name,
      email: body.email.toLowerCase(),
      role: fields.role,
      companies: fields.companies,
      branches: fields.branches,
      moduleAccess: fields.moduleAccess || {},
      active: true,
      passwordHash,
    };
    await createUser(db, row);
    await writeAudit(db, {
      id: crypto.randomUUID(),
      company: body.companies[0],
      actorId: actor.id,
      actor: actor.name,
      action: `Created user: ${body.name} (${body.role})`,
      recordId: id,
    });
    const user = safeUser(row);
    return NextResponse.json({ user }, { status: 201 });
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not create account. Check the details, email uniqueness and password length (14+ characters).",
      },
      { status: 400 },
    );
  }
}
export async function PATCH(request: Request) {
  try {
    checkOrigin(request);
    const actor = await currentActor();
    if (!actor || !canManageUsers(actor))
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    const body = z
      .union([
        z.object({ id: z.string(), ...accessFields }),
        z.object({ id: z.string(), active: z.boolean() }),
      ])
      .parse(await request.json());
    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
    const target = await findUserById(db, body.id);
    if (!target) throw new Error("Access denied.");
    const current = {
      ...safeUser(target),
      role: target.role as Actor["role"],
      companies: target.companies,
      branches: target.branches,
    };
    const requested =
      "role" in body
        ? body
        : { ...current, moduleAccess: (target.moduleAccess || {}) as Actor["moduleAccess"] };
    if (!mayAssign(actor, current, requested)) throw new Error("Access denied.");
    const changes =
      "role" in body
        ? {
            role: body.role,
            companies: body.companies,
            branches: body.branches,
            moduleAccess: body.moduleAccess || {},
          }
        : { active: body.active };
    // Updating access and revoking that user's sessions commit together, so a
    // revoked account cannot keep a live session.
    await updateUserAndRevokeSessions(db, body.id, changes);
    await writeAudit(db, {
      id: crypto.randomUUID(),
      company: current.companies[0],
      actorId: actor.id,
      actor: actor.name,
      recordId: body.id,
      action: `Updated user access: ${target.name}`,
      before: {
        role: current.role, companies: current.companies, branches: current.branches,
        moduleAccess: target.moduleAccess, active: target.active,
      },
      after: changes,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      {
        error:
          "Unable to update access. Check scope and role. You cannot change your own access.",
      },
      { status: 400 },
    );
  }
}
