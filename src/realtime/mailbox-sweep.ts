import type { MailboxEnv } from "../lib/mail/mailbox";
/** Preview-only mail is fetched by an open tab, never archived by cron. */
export async function runMailboxSweep(_env:MailboxEnv & {APP_MODE?:string},_now=Date.now()){
  return {checked:0,mode:"preview-only"};
}
