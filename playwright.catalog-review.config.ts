import { defineConfig } from "@playwright/test";
import base from "./playwright.proforma.config";
export default defineConfig({ ...base, testMatch: "catalog-wizard.spec.ts", outputDir: "test-results-catalog" });
