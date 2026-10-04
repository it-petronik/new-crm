import {defineConfig} from '@playwright/test';
import base from './playwright.mail.config';
export default defineConfig({...base,testMatch:['layout-review.spec.ts','design-foundation.spec.ts','studio-redesign.spec.ts'],timeout:180_000});
