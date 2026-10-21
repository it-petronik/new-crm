import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "desktop-phone.spec.ts",
  workers: 1,
  timeout: 90000,
  outputDir: "test-results-desktop-phone",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    reducedMotion: "reduce",
    actionTimeout: 15000,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  reporter: "list",
});
