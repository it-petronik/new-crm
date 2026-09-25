import { defineConfig } from "@playwright/test";

/**
 * Collaboration Hub suite.
 *
 * Runs against the BUILT Worker (worker.ts wrapping .open-next) in live mode,
 * with a throwaway local D1 and local Durable Objects, started fresh by
 * scripts/collab-test-server.sh. That is the only way to exercise the real
 * session checks, the socket gateway and CollabHub together; `next dev` has
 * neither. Nothing here is conditional: if the server cannot start, the suite
 * fails.
 *
 *   npm run test:collab      # builds, then runs this suite
 */
export default defineConfig({
  testDir: "./e2e/collab",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 4,
  use: {
    baseURL: "http://localhost:8788",
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: {
    command: "bash scripts/collab-test-server.sh",
    url: "http://localhost:8788/login",
    // Always a fresh database: rate-limit counters and memberships from an
    // earlier run must not leak into this one.
    reuseExistingServer: false,
    timeout: 180_000,
  },
  reporter: "list",
});
