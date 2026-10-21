import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "theme-role-review.spec.ts",
  workers: 1,
  timeout: 240000,
  outputDir: "test-results-theme",
  use: {
    baseURL: "http://127.0.0.1:8789",
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  reporter: "list",
});
