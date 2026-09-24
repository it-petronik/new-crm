import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  /**
   * The suite runs against `next dev`, which compiles routes on demand. With
   * several workers requesting different routes at once a first hit can take
   * far longer than a built bundle would, and the default 30s then reports a
   * slow compile as a failure. This changes no assertion; it only stops the
   * harness calling compilation time a defect.
   */
  timeout: 60_000,
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
