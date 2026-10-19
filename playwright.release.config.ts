import {defineConfig} from "@playwright/test";
import base from "./playwright.mail.config";
import {readFileSync} from "node:fs";
import {join} from "node:path";
if(process.env.MAIL_REVIEW_SERVER==="1"&&!process.env.TASKS_CONTROL_FILE){
  process.env.TASKS_CONTROL_FILE=join(readFileSync(".wrangler/local-review-current","utf8").trim(),"control-token");
}
export default defineConfig({...base,testMatch:["production-readiness.spec.ts","authorization.spec.ts","tasks.spec.ts","operations.spec.ts","outbound.spec.ts","mailbox.spec.ts","mail-recovery.spec.ts","mail-all.spec.ts"],workers:1,timeout:180000});
