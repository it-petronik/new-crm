// Local regression only. Production still builds worker.ts directly.
import app from "../worker";
import type { D1Database } from "@cloudflare/workers-types";
export { CollabHub, DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "../worker";
export { FakeApollo } from "./fake-apollo-worker";
export { FakeAi } from "./fake-ai-worker";

type TestEnv = Parameters<typeof app.fetch>[1] & { DB: D1Database; COLLAB_TEST_CONTROL?: string };
export default {
  ...app,
  async fetch(request: Request, env: TestEnv, ctx: unknown) {
    if (new URL(request.url).pathname === "/__test/expire-snooze") {
      // The single fixture clock adjustment must use the running D1 owner;
      // opening the live SQLite file for writes can race its transactions.
      if (request.method !== "POST" || !env.COLLAB_TEST_CONTROL || request.headers.get("X-Test-Control") !== env.COLLAB_TEST_CONTROL)
        return new Response("Not found", { status: 404 });
      const { userId, signalKey } = await request.json() as { userId?: string; signalKey?: string };
      if (!userId?.startsWith("collab-user-px") || !signalKey?.startsWith("FOLLOW_UP_OVERDUE:"))
        return new Response("Invalid fixture", { status: 400 });
      await env.DB.prepare('UPDATE "ProactiveState" SET "snoozedUntil" = ? WHERE "userId" = ? AND "signalKey" = ?')
        .bind(Date.now() - 1000, userId, signalKey).run();
      return Response.json({ ok: true });
    }
    return app.fetch(request, env, ctx);
  },
};
