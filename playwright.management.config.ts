import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "management-redesign.spec.ts",
  workers: 1,
  timeout: 240000,
  outputDir: "test-results-management",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    reducedMotion: "reduce",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  reporter: "list",
});
