import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "management-live.spec.ts",
  workers: 1,
  timeout: 180000,
  outputDir: "test-results-management-live",
  use: {
    baseURL: "http://127.0.0.1:8789",
    headless: true,
    reducedMotion: "reduce",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  reporter: "list",
});
