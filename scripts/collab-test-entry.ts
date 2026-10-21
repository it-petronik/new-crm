// Local regression only. Production still builds worker.ts directly.
import app from "../worker";
import type { D1Database } from "@cloudflare/workers-types";
export { CollabHub, DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "../worker";
export { FakeApollo } from "./fake-apollo-worker";
export { FakeAi } from "./fake-ai-worker";
export {FakeMailbox} from "./fake-mailbox-worker";
import {runMailboxSweep} from "../src/realtime/mailbox-sweep";
import { runAutomationSweep } from "../src/realtime/automation-sweep";

type TestEnv = Parameters<typeof app.fetch>[1] & { DB: D1Database; COLLAB_TEST_CONTROL?: string; AI_TEST?: {run(model: string, input: unknown): Promise<unknown>} };
const networkFetch = globalThis.fetch;
export default {
  ...app,
  async fetch(request: Request, env: TestEnv, ctx: unknown) {
    // Test transport only: fictional responses exercise the real Groq adapter.
    // Install before app.fetch; never allow an actual paid/network inference.
    if (env.COLLAB_TEST_CONTROL && env.AI_TEST) globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== "https://api.groq.com/openai/v1/chat/completions") return networkFetch(input, init);
      const body = JSON.parse(String(init?.body));
      try {
        const raw = await env.AI_TEST!.run(body.model, { ...body, response_format: { json_schema: body.response_format.json_schema.schema } }) as {response: unknown; usage?: unknown};
        return Response.json({ choices: [{message: {content: typeof raw.response === "string" ? raw.response : JSON.stringify(raw.response)}}], usage: raw.usage });
      } catch(error) { return Response.json({error: "Fictional service unavailable"}, {status: /quota|allocation/i.test(String(error)) ? 429 : 503}); }
    }) as typeof fetch;
    if(new URL(request.url).pathname==="/__test/mailbox-sweep"){
      if(request.method!=="POST"||!env.COLLAB_TEST_CONTROL||request.headers.get("X-Test-Control")!==env.COLLAB_TEST_CONTROL)return new Response("Not found",{status:404});
      return Response.json(await runMailboxSweep(env as never));
    }
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
    if (new URL(request.url).pathname === "/__test/automation-sweep") {
      // The scheduled five-minute task automation, on demand, for local
      // review and browser tests. Same token protection; never in worker.ts.
      if (request.method !== "POST" || !env.COLLAB_TEST_CONTROL || request.headers.get("X-Test-Control") !== env.COLLAB_TEST_CONTROL)
        return new Response("Not found", { status: 404 });
      return Response.json(await runAutomationSweep(env as never));
    }
    const response = await app.fetch(request, env, ctx);
    // Local review uses a loopback LiveKit server, not LiveKit Cloud. Keep
    // the actual browser CSP enabled during tests; allow only that local
    // endpoint here. This entrypoint is never used by production.
    const policy = response.headers.get("Content-Security-Policy");
    if (policy && env.COLLAB_TEST_CONTROL && ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)) {
      const local = new Response(response.body, response);
      local.headers.set("Content-Security-Policy", policy.replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:7880 http://127.0.0.1:7880"));
      return local;
    }
    return response;
  },
};
