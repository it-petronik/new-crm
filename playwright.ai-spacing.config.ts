import { defineConfig } from "@playwright/test";
import base from "./playwright.management.config";
export default defineConfig({
  ...base,
  testMatch: /\/e2e\/ai-spacing\.spec\.ts$/,
  timeout: 60000,
  outputDir: "test-results-ai-spacing",
  use: { ...base.use, reducedMotion: "no-preference" },
});
