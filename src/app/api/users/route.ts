import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { currentActor, checkOrigin } from "@/lib/auth";
import {
  roles,
  companies,
  modules,
  canManageUsers,
  type Actor,
} from "@/lib/domain";
import { inAdminScope, mayAssign } from "@/lib/access-control";
const safeSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  companies: true,
  branches: true,
  active: true,
  moduleAccess: true,
};
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
  const users = await db.user.findMany({
    select: safeSelect,
    orderBy: { name: "asc" },
  });
  return NextResponse.json(
    {
      users: users.filter((u) =>
        inAdminScope(actor, u.companies as string[], u.branches as string[]),
      ),
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
    const { password, ...fields } = body;
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          ...fields,
          moduleAccess: fields.moduleAccess || {},
          email: body.email.toLowerCase(),
          passwordHash,
        },
        select: safeSelect,
      });
      await tx.auditEvent.create({
        data: {
          id: crypto.randomUUID(),
          company: body.companies[0],
          actorId: actor.id,
          actor: actor.name,
          action: `Created user: ${body.name} (${body.role})`,
          recordId: user.id,
        },
      });
      return user;
    });
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
    await db.$transaction(
      async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: body.id },
          select: safeSelect,
        });
        if (!target) throw new Error("Access denied.");
        const current = {
          ...target,
          role: target.role as Actor["role"],
          companies: target.companies as string[],
          branches: target.branches as string[],
        };
        const requested =
          "role" in body
            ? body
            : {
                ...current,
                moduleAccess: (target.moduleAccess ||
                  {}) as Actor["moduleAccess"],
              };
        if (!mayAssign(actor, current, requested))
          throw new Error("Access denied.");
        const changes =
          "role" in body
            ? {
                role: body.role,
                companies: body.companies,
                branches: body.branches,
                moduleAccess: body.moduleAccess || {},
              }
            : { active: body.active };
        await tx.user.update({ where: { id: body.id }, data: changes });
        await tx.session.deleteMany({ where: { userId: body.id } });
        await tx.auditEvent.create({
          data: {
            id: crypto.randomUUID(),
            company: current.companies[0],
            actorId: actor.id,
            actor: actor.name,
            recordId: body.id,
            action: `Updated user access: ${target.name}`,
            before: {
              role: current.role,
              companies: current.companies,
              branches: current.branches,
              moduleAccess: target.moduleAccess,
              active: target.active,
            },
            after: changes,
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
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
