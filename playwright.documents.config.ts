import { defineConfig } from "@playwright/test";
import base from "./playwright.print-review.config";
export default defineConfig({
  ...base,
  testMatch: "document-completeness.spec.ts",
  outputDir: "test-results-documents",
});
