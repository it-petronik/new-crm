import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import { currentActor, checkOrigin } from "@/lib/auth";
import { isPreview } from "@/lib/db";
import { OutboundError } from "@/lib/outbound/model";
import { outboundCommand, outboundView } from "@/lib/outbound/store";
import type { OutboundEnv } from "@/lib/outbound/transport";
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function run(request: Request, write: boolean) {
  try {
    if (write) {
      try {
        checkOrigin(request);
      } catch {
        return reply({ error: "Invalid request origin." }, 403);
      }
    }
    const actor = await currentActor();
    if (!actor) return reply({ error: "Sign in required." }, 401);
    if (isPreview())
      return reply(
        { error: "Open the signed-in workspace to manage communication." },
        409,
      );
    const { env } = await getCloudflareContext({ async: true });
    const config = env as unknown as OutboundEnv & { DB: D1Database };
    if (!config.DB)
      return reply({ error: "Communication is unavailable." }, 503);
    if (!write) return reply(await outboundView(config.DB, actor, config));
    const raw = await request.text();
    if (raw.length > 16000)
      return reply({ error: "Message is too large." }, 413);
    return reply(
      await outboundCommand(config.DB, actor, JSON.parse(raw), config),
    );
  } catch (e) {
    if (e instanceof OutboundError)
      return reply({ error: e.message }, e.status);
    if (e instanceof z.ZodError)
      return reply(
        { error: e.issues[0]?.message || "Check your fields." },
        400,
      );
    if (e instanceof SyntaxError)
      return reply({ error: "Invalid message data." }, 400);
    return reply(
      {
        error:
          "Communication unavailable. Delivery is not confirmed. Refresh and check history before trying again.",
      },
      503,
    );
  }
}
export const GET = (request: Request) => run(request, false);
export const POST = (request: Request) => run(request, true);
