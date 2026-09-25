import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  // The Collaboration Hub suite needs the built Worker in live mode with its
  // Durable Object; it has its own config (playwright.collab.config.ts) and
  // server rather than being skipped here.
  // The no-file-storage variant has its own config too
  // (playwright.collab-nofiles.config.ts).
  testIgnore: ["collab/**", "collab-no-files/**"],
  /**
   * The suite runs against `next dev`, which compiles routes on demand. With
   * several workers requesting different routes at once a first hit can take
   * far longer than a built bundle would, and the default 30s then reports a
   * slow compile as a failure. This changes no assertion; it only stops the
   * harness calling compilation time a defect.
   */
  timeout: 60_000,
  // Compiles every route once before the workers start; see the file's note.
  globalSetup: "./e2e/global-setup.ts",
  /**
   * `next dev` compiles routes on demand and is the bottleneck here, not the
   * application. With more workers than it can serve, whichever test happens
   * to request an uncompiled route waits on the others and a different one
   * fails each run. Fewer workers makes the suite deterministic; it costs
   * wall-clock time, not coverage.
   */
  workers: 3,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: {
    command: "APP_MODE=preview npm run dev -- --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: true,
  },
  reporter: "list",
});
