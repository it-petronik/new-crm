import { defineConfig } from "@playwright/test";
import base from "./playwright.mail.config";
export default defineConfig({
  ...base,
  testMatch: "ai-ui.spec.ts",
  workers: 1,
  timeout: 120000,
});
