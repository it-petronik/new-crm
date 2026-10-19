import { getCloudflareContext } from "@opennextjs/cloudflare";
import {currentActor,checkOrigin} from "@/lib/auth";
import {isPreview} from "@/lib/db";
import {mailboxPage} from "@/lib/mail/transient";
import type {MailboxEnv} from "@/lib/mail/mailbox";
import {MailboxError} from "@/lib/mail/credentials";
import {ZodError} from "zod";
export async function POST(request:Request){
 const headers={"Cache-Control":"private, no-store"};
 try{
  try{checkOrigin(request);}catch{throw new MailboxError(403,"Invalid origin.");}
  const actor=await currentActor();if(!actor)throw new MailboxError(401,"Sign in required.");
  if(isPreview())throw new MailboxError(409,"Use the full workspace.");
  const raw=await request.text();if(raw.length>4096)throw new MailboxError(413,"Invalid page request.");
  let input:unknown;try{input=JSON.parse(raw);}catch{throw new MailboxError(400,"Invalid page request.");}
  const {env}=await getCloudflareContext({async:true});
  return Response.json(await mailboxPage(env as unknown as MailboxEnv,actor.id,input),{headers});
 }catch(e){return Response.json({error:e instanceof MailboxError?e.message:e instanceof ZodError?"Invalid page request.":"Could not load older messages. Please retry."},{status:e instanceof MailboxError?e.status:e instanceof ZodError?400:502,headers});}
}
