import { defineConfig } from "@playwright/test";
import base from "./playwright.lead-desk.config";
export default defineConfig({...base,testMatch:"worklist-design.spec.ts",outputDir:"test-results-worklist"});
