import { getCloudflareContext } from "@opennextjs/cloudflare";
import { currentActor,checkOrigin } from "@/lib/auth";
import { isPreview } from "@/lib/db";
import { findConnection,type MailboxEnv } from "@/lib/mail/mailbox";
import { resolveMailReference } from "@/lib/mail/reference";
import { MailboxError } from "@/lib/mail/credentials";
import type { HTMLRewriter as Rewriter } from "@cloudflare/workers-types";
declare const HTMLRewriter:{new():Rewriter};
const allowed=new Set("html head body title style div p span br hr table thead tbody tfoot tr td th caption colgroup col img a font center b strong i em u s small sub sup blockquote pre code ul ol li h1 h2 h3 h4 h5 h6".split(" "));
const baseHeaders={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"SAMEORIGIN","Referrer-Policy":"no-referrer","Cross-Origin-Resource-Policy":"same-origin","Permissions-Policy":"camera=(), microphone=(), display-capture=(), geolocation=()"};
const policy=(images:boolean)=>`default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:${images?" https: http:":""}; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-same-origin`;
/** Authenticated, transient rendering only. Never stores HTML or fetches remote URLs. */
export async function POST(request:Request){
 try{
  try{checkOrigin(request);}catch{throw new MailboxError(403,"Invalid render origin.");}
  const actor=await currentActor();if(!actor)throw new MailboxError(401,"Sign in required.");if(isPreview())throw new MailboxError(409,"Use the full workspace.");
  const text=await request.text();if(text.length>1200000)throw new MailboxError(413,"Email preview too large.");
  const form=new URLSearchParams(text),id=form.get("id")||"",html=form.get("html")||"",images=form.get("images")==="1";
  if(!html||html.length>300000||id.length>2048)throw new MailboxError(400,"Invalid email preview.");
  const {env}=await getCloudflareContext({async:true}),config=env as unknown as MailboxEnv,c=await findConnection(config.DB,actor.id);if(!c)throw new MailboxError(404,"Mailbox unavailable.");
  await resolveMailReference(config.MAILBOX_ENCRYPTION_KEY,actor.id,c.id,id);
  const response=new Response(html,{headers:{...baseHeaders,"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":policy(images)}});
  // Second sanitization boundary; the client has already sanitized sender HTML.
  const rewritten=new HTMLRewriter().on("*",{element(element){
    const tag=element.tagName.toLowerCase();if(!allowed.has(tag)){element.remove();return;}
    if(tag==="body")element.setAttribute("data-mail-render","ready");
    for(const [name,value] of [...element.attributes]){
      if(/^on/i.test(name)||["srcset","background","srcdoc","action","formaction","download"].includes(name))element.removeAttribute(name);
      if(name==="src"&&(tag!=="img"||!(/^(?:blob:|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(value)||(images&&/^https?:\/\//i.test(value)))))element.removeAttribute(name);
      if(name==="href"&&(tag!=="a"||! /^(?:https?:\/\/|mailto:)/i.test(value)))element.removeAttribute(name);
    }
    if(tag==="a"){element.setAttribute("target","_blank");element.setAttribute("rel","noopener noreferrer");}
  }}).transform(response as never);
  return new Response(rewritten.body as unknown as BodyInit,{headers:response.headers});
 }catch(error){return new Response(error instanceof MailboxError?error.message:"Email preview unavailable. Please retry.",{status:error instanceof MailboxError?error.status:502,headers:{...baseHeaders,"Content-Type":"text/plain; charset=utf-8","Content-Security-Policy":policy(false)}});}
}
