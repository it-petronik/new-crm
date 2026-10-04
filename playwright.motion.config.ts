import { defineConfig } from "@playwright/test";
import base from "./playwright.mail.config";
export default defineConfig({ ...base, testMatch: "motion-system.spec.ts", timeout: 120_000 });
