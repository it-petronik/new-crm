import { defineConfig } from "@playwright/test";
import base from "./playwright.mail.config";
export default defineConfig({
  ...base,
  testMatch: "operations.spec.ts",
  timeout: 120_000,
});
