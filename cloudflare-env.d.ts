import type { D1Database, DurableObjectNamespace, R2Bucket } from "@cloudflare/workers-types";

/**
 * Bindings and variables available to the Worker at runtime. The Cloudflare
 * types are imported rather than loaded globally, because loading them
 * globally replaces the DOM lib and breaks the React components.
 */
declare global {
  interface CloudflareEnv {
    DB: D1Database;
    /** Collaboration Hub realtime relay; live environment only. */
    COLLAB_HUB?: DurableObjectNamespace;
    /** Collaboration files (R2); live environment only. */
    COLLAB_FILES?: R2Bucket;
    /** Local HR document review only; live uploads deliberately disabled. */
    HR_FILES?: R2Bucket;
    HR_UPLOADS_ENABLED?: string;
    /** Private server secret, never exposed in a client bundle. */
    GROQ_API_KEY?: string;
    AI_PROVIDER?: "groq";
    APP_MODE?: string;
    APP_URL?: string;
    NODE_ENV?: string;
  }
}

export {};
