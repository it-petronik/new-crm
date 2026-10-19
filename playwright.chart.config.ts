import { defineConfig } from "@playwright/test";
import base from "./playwright.mail.config";
export default defineConfig({ ...base, testMatch: "chart-zoom.spec.ts", timeout: 90_000 });
