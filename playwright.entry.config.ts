import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: ["simple-entry.spec.ts", "friendly-workspace.spec.ts"], workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000", launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  } },
  webServer: { command: "APP_MODE=preview npm run dev -- --port 3000", url: "http://localhost:3000", reuseExistingServer: true },
});
