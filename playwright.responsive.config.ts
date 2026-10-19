import { defineConfig } from "@playwright/test";
import base from "./playwright.mail.config";
export default defineConfig({
  ...base,
  testMatch: "responsive-pages.spec.ts",
  workers: 1,
  timeout: 600000,
});
