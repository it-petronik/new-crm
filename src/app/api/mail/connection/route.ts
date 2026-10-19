import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { currentActor, checkOrigin } from "@/lib/auth";
import { isPreview } from "@/lib/db";
import { MailboxError } from "@/lib/mail/credentials";
import {
  connectMailbox,
  mailboxAction,
  mailboxView,
  type MailboxEnv,
} from "@/lib/mail/mailbox";
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
        {
          error:
            "Open the full local workspace at localhost:8788 to connect an email account.",
        },
        409,
      );
    const { env } = await getCloudflareContext({ async: true }),
      config = env as unknown as MailboxEnv;
    if (!write) return reply(await mailboxView(config, actor.id));
    const raw = await request.text();
    if (raw.length > 2500)
      return reply({ error: "Invalid connection request." }, 413);
    const body = JSON.parse(raw);
    if (body.action === "connect")
      return reply(await connectMailbox(config, actor.id, body));
    return reply(await mailboxAction(config, actor.id, body));
  } catch (e) {
    if (e instanceof MailboxError) return reply({ error: e.message }, e.status);
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return reply(
        { error: "Check the email address and connection fields." },
        400,
      );
    return reply(
      { error: "Mailbox connection unavailable. No messages were sent." },
      503,
    );
  }
}
export const GET = (r: Request) => run(r, false);
export const POST = (r: Request) => run(r, true);
