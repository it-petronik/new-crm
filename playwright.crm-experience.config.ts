import { defineConfig } from "@playwright/test";
import base from "./playwright.management.config";
export default defineConfig({
  ...base,
  testMatch: /\/e2e\/crm-experience\.spec\.ts$/,
  timeout: 90000,
  outputDir: "test-results-crm-experience",
});
