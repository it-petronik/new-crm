import { defineConfig } from "@playwright/test";
process.env.D1_TEST_CONFIG = ".wrangler/collab-test/wrangler.test.json";
process.env.D1_TEST_PERSIST = ".wrangler/collab-test/state";
export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "d1-worker.spec.ts",
    "import-records.spec.ts",
    "password-reset.spec.ts",
    "second-administrator.spec.ts",
  ],
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:8788",
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: {
    command:
      "D1_REGRESSION=1 COLLAB_TEST_NO_R2=1 bash scripts/collab-test-server.sh",
    url: "http://localhost:8788/login",
    reuseExistingServer: false,
    timeout: 180_000,
  },
  reporter: "list",
});
