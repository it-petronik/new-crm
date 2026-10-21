import { defineConfig } from "@playwright/test";
import base from "./playwright.print-review.config";
export default defineConfig({
  ...base,
  testMatch: "document-seals.spec.ts",
  outputDir: "test-results-seals",
});
