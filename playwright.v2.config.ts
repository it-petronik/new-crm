import { defineConfig } from "@playwright/test";
import base from "./playwright.mail.config";
export default defineConfig({ ...base, testMatch: ["v2-inner-pages.spec.ts", "meeting-media.spec.ts"], timeout: 180_000 });
