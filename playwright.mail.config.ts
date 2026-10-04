import { defineConfig } from "@playwright/test";
import base from "./playwright.collab.config";
export default defineConfig({
  ...base, testMatch: "mail-local.spec.ts", workers: 1, retries: 0,
  webServer: process.env.MAIL_REVIEW_SERVER === "1" ? undefined : base.webServer,
});
