import { getCloudflareContext } from "@opennextjs/cloudflare";
import { currentActor, checkOrigin } from "@/lib/auth";
import { isPreview } from "@/lib/db";
import { syncMailboxFolders, type MailboxEnv } from "@/lib/mail/mailbox";
import { MailboxError } from "@/lib/mail/credentials";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    try {
      checkOrigin(request);
    } catch {
      return Response.json(
        { error: "Invalid origin." },
        { status: 403, headers },
      );
    }
    const actor = await currentActor();
    if (!actor)
      return Response.json(
        { error: "Sign in required." },
        { status: 401, headers },
      );
    if (isPreview())
      throw new MailboxError(409, "Use the full local workspace.");
    const { env } = await getCloudflareContext({ async: true });
    return Response.json(
      await syncMailboxFolders(env as unknown as MailboxEnv, actor.id),
      { headers },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof MailboxError
            ? e.message
            : "Mailbox folders unavailable.",
      },
      { status: e instanceof MailboxError ? e.status : 502, headers },
    );
  }
}
