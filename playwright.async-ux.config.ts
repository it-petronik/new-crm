import { defineConfig } from "@playwright/test";
import base from "./playwright.mail.config";
export default defineConfig({
  ...base,
  testMatch: "async-ux.spec.ts",
  workers: 1,
  timeout: 90000,
});
