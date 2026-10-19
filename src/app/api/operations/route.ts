import { z } from "zod";
import { checkOrigin, currentActor } from "@/lib/auth";
import { getDb, isPreview } from "@/lib/db";
import { OperationsError } from "@/lib/operations/model";
import {
  operationsCommand,
  operationsFailure,
  operationsView,
} from "@/lib/operations/store";
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function failure(e: unknown) {
  if (e instanceof SyntaxError)
    return reply({ error: "Supply a valid operation." }, 400);
  if (e instanceof z.ZodError)
    return reply(
      { error: e.issues[0]?.message || "Check the supplied fields." },
      400,
    );
  const error = operationsFailure(e);
  return reply({ error: error.message }, error.status);
}
export async function GET(request: Request) {
  try {
    const actor = await currentActor();
    if (!actor) return reply({ error: "Sign in required." }, 401);
    if (isPreview())
      return reply(
        { error: "Operations requires the connected workspace." },
        409,
      );
    const db = await getDb();
    if (!db) return reply({ error: "Database unavailable." }, 503);
    return reply(
      await operationsView(
        db,
        actor,
        new URL(request.url).searchParams.get("company") || undefined,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    try {
      checkOrigin(request);
    } catch {
      throw new OperationsError(403, "Invalid request origin.");
    }
    const actor = await currentActor();
    if (!actor) return reply({ error: "Sign in required." }, 401);
    if (isPreview())
      return reply(
        { error: "Operations requires the connected workspace." },
        409,
      );
    const db = await getDb();
    if (!db) return reply({ error: "Database unavailable." }, 503);
    return reply(await operationsCommand(db, actor, await request.json()));
  } catch (e) {
    return failure(e);
  }
}
