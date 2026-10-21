import {defineConfig} from "@playwright/test";
export default defineConfig({testDir:"./e2e", testMatch:"ai-workflow.spec.ts", workers:1, timeout:120000,
  outputDir:"test-results-ai-workflow", use:{actionTimeout:15000,baseURL:"http://localhost:3000", headless:true, reducedMotion:"reduce", launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}}, reporter:"list"});
