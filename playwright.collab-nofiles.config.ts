import { defineConfig } from "@playwright/test";
import base from "./playwright.collab.config";

/**
 * The Collaboration Hub with NO file storage bound — how production runs
 * until R2 is enabled. Same built Worker and fresh local state as the main
 * Collaboration suite, started without the R2 binding.
 *
 *   npm run test:collab:nofiles
 */
export default defineConfig({
  ...base,
  testDir: "./e2e/collab-no-files",
  webServer: { ...base.webServer!, command: "COLLAB_TEST_NO_R2=1 bash scripts/collab-test-server.sh" } as never,
});
