import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "hr-workspace.spec.ts",
  workers: 1,
  timeout: 60000,
  outputDir: "test-results-hr",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    reducedMotion: "reduce",
    actionTimeout: 10000,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  reporter: "list",
});
