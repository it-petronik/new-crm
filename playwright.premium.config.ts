import { defineConfig } from "@playwright/test";
import base from "./playwright.mail.config";
export default defineConfig({
  ...base,
  testMatch: "premium-flow.spec.ts",
  workers: 1,
  timeout: 90000,
  outputDir: "test-results-premium",
});
