import { defineConfig } from "@playwright/test";
import base from "./playwright.collab.config";
export default defineConfig({
  ...base,
  testMatch: "apollo-workspace.spec.ts",
  workers: 1,
  retries: 0,
  webServer:
    process.env.APOLLO_REVIEW_SERVER === "1"
      ? undefined
      : ({
          ...base.webServer!,
          command: "COLLAB_TEST_NO_R2=1 bash scripts/collab-test-server.sh",
        } as never),
});
