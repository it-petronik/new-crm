import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "proforma-role.spec.ts",
  workers: 1,
  timeout: 90000,
  outputDir: "test-results-proforma",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  reporter: "list",
});
