// Minimal types for the test-only fake AI worker (scripts/fake-ai-worker.ts);
// the app itself uses local types rather than @cloudflare/workers-types.
declare module "cloudflare:workers" {
  export class WorkerEntrypoint<Env = unknown> {
    protected env: Env;
    protected ctx: unknown;
    constructor(ctx: unknown, env: Env);
  }
}
