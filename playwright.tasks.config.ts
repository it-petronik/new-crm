import { defineConfig } from "@playwright/test";
import base from "./playwright.mail.config";
export default defineConfig({ ...base, testMatch: "tasks.spec.ts", timeout: 120_000 });
