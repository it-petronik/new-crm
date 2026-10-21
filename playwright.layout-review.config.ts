import { defineConfig } from "@playwright/test";
import base from "./playwright.management.config";
export default defineConfig({
  ...base,
  testMatch: /\/e2e\/layout-review\.spec\.ts$/,
  timeout: 60000,
  outputDir: "test-results-layout-review",
});
