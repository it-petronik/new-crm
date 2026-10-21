import { defineConfig } from "@playwright/test";
import base from "./playwright.proforma.config";
export default defineConfig({...base,testMatch:"control-density.spec.ts",outputDir:"test-results-density",timeout:180000,use:{...base.use,reducedMotion:"reduce"}});
