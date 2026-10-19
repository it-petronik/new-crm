import { defineConfig } from "@playwright/test";
import base from "./playwright.mail.config";
/** Run against the saved local workspace started by npm run dev. */
export default defineConfig({
  ...base,
  testMatch: ["call-feedback.spec.ts", "meeting-media.spec.ts"],
  workers: 1,
  retries: 0,
  use: { ...base.use, actionTimeout: 15000 },
});
