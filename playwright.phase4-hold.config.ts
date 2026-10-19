import {defineConfig} from "@playwright/test";
import base from "./playwright.mail.config";
export default defineConfig({...base,testDir:"./e2e/collab-no-files",testMatch:"no-files.spec.ts",workers:1});
