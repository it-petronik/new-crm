import { getCloudflareContext } from "@opennextjs/cloudflare";
import { currentActor } from "@/lib/auth";
import { isPreview } from "@/lib/db";
import { MailboxError } from "@/lib/mail/credentials";
import { readMailboxMessage, type MailboxEnv } from "@/lib/mail/mailbox";
import { z } from "zod";
export async function GET(request: Request) {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  try {
    const actor = await currentActor();
    if (!actor)
      return Response.json(
        { error: "Sign in required." },
        { status: 401, headers },
      );
    if (isPreview())
      throw new MailboxError(409, "Use the full local workspace.");
    const url = new URL(request.url),
      id = z.string().min(1).max(2048).parse(url.searchParams.get("id")),
      part = url.searchParams.get("part") || undefined;
    if (part && !/^(?:\d+(?:\.\d+)*|TEXT)$/.test(part))
      throw new MailboxError(400, "Invalid attachment reference.");
    const { env } = await getCloudflareContext({ async: true });
    const result = await readMailboxMessage(
      env as unknown as MailboxEnv,
      actor.id,
      id,
      part,
      undefined,
      !part && url.searchParams.get("metadata") === "1",
    );
    if ("bytes" in result) {
      const safeName = result.file.name.replace(/[\r\n\0]/g, "");
      return new Response(result.bytes as unknown as BodyInit, {
        headers: {
          ...headers,
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(safeName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
          "Content-Length": String(result.bytes.length),
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }
    return Response.json(result, { headers });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof MailboxError
            ? e.message
            : "Could not load this email. Please retry.",
      },
      {
        status:
          e instanceof MailboxError
            ? e.status
            : e instanceof z.ZodError
              ? 400
              : 502,
        headers,
      },
    );
  }
}
