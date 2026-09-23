import type { D1Database } from "@cloudflare/workers-types";

/**
 * Bindings and variables available to the Worker at runtime. The Cloudflare
 * types are imported rather than loaded globally, because loading them
 * globally replaces the DOM lib and breaks the React components.
 */
declare global {
  interface CloudflareEnv {
    DB: D1Database;
    APP_MODE?: string;
    APP_URL?: string;
    NODE_ENV?: string;
  }
}

export {};
