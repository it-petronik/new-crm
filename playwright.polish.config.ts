import { defineConfig } from "@playwright/test";
import base from "./playwright.mail.config";
export default defineConfig({ ...base, testMatch: "workspace-polish.spec.ts", timeout: 90_000, use: { ...base.use, actionTimeout: 15_000 } });
