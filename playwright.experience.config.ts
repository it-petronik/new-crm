import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir:"./e2e", testMatch:"experience-review.spec.ts", workers:1, timeout:480000,
  outputDir:"test-results-experience", use:{ baseURL:"http://127.0.0.1:8789", headless:true,
    reducedMotion:"reduce", launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} }, reporter:"list",
});
