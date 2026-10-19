import { defineConfig } from "@playwright/test";
import base from "./playwright.mail.config";
export default defineConfig({
  ...base,
  testMatch: "outbound.spec.ts",
  timeout: 120_000,
});
