import { defineConfig } from "@playwright/test";
import base from "./playwright.management.config";
export default defineConfig({
  ...base,
  testMatch: "crm-polish.spec.ts",
  timeout: 45000,
  outputDir: "test-results-polish",
});
