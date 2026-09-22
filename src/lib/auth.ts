import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { type Actor, roles } from "./domain";
export const sessionCookie = "enercore_session";
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function currentActor(): Promise<Actor | null> {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token || !process.env.DATABASE_URL) return null;
  const session = await db.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: true },
  });
  if (
    !session ||
    session.expiresAt < new Date() ||
    !session.user.active ||
    !roles.includes(session.user.role as Actor["role"])
  )
    return null;
  return {
    id: session.user.id,
    name: session.user.name,
    role: session.user.role as Actor["role"],
    companies: session.user.companies as string[],
    branches: session.user.branches as string[],
    email: session.user.email,
    moduleAccess: (session.user.moduleAccess ||
      undefined) as Actor["moduleAccess"],
  };
}
export async function startSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 8 * 3600000);
  await db.session.create({
    data: { id: hashToken(token), userId, expiresAt: expires },
  });
  (await cookies()).set(sessionCookie, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}
export function checkOrigin(request: Request) {
  const configured = process.env.APP_URL;
  if (
    !configured ||
    request.headers.get("origin") !== new URL(configured).origin
  )
    throw new Error("Invalid request origin. Configure APP_URL.");
}
