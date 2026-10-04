import { defineConfig } from "@playwright/test";
import base from "./playwright.mail.config";
export default defineConfig({ ...base, testMatch: ["compact-experience.spec.ts", "call-recording.spec.ts", "call-feedback.spec.ts"], timeout: 120_000 });
