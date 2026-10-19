import { defineConfig } from "@playwright/test";
import base from "./playwright.mail.config";
export default defineConfig({
  ...base,
  testMatch: ["mailbox.spec.ts","mail-recovery.spec.ts","mail-all.spec.ts"],
  timeout: 120_000,
});
