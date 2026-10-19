"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import type { MailAttachment } from "@/lib/mail/imap";
import { Button } from "./ui/controls";
import { mailBytes } from "@/lib/mail/request";

/** Sender CSS is confined to a no-script frame, never injected into the app. */
export default function MailOriginal({ html, id, files }: { html: string; id: string; files: MailAttachment[] }) {
  const frame=useRef<HTMLIFrameElement>(null);
  const frameName=`mail-original-${useId().replace(/[^a-z0-9-]/gi,"")}`;
  const [remote,setRemote]=useState(false),[height,setHeight]=useState(320);
  const [inline,setInline]=useState<Record<string,string>>({});
  const [inlineRetry,setInlineRetry]=useState(0),[imageEpoch,setImageEpoch]=useState(0),[inlineFailures,setInlineFailures]=useState(0),[externalFailures,setExternalFailures]=useState(0);
  const [renderReady,setRenderReady]=useState(false),[renderError,setRenderError]=useState("");
  const ready=useRef(false),renderAttempts=useRef(0);
  useEffect(()=>{const recover=()=>{if(!ready.current){renderAttempts.current=0;setImageEpoch(n=>n+1);}};window.addEventListener("online",recover);return()=>window.removeEventListener("online",recover);},[]);
  useEffect(()=>{
    const controller=new AbortController(),urls:string[]=[];
    setInline({});setInlineFailures(0);
    const images=files.filter(f=>f.contentId&&/^image\/(png|jpeg|gif|webp)$/.test(f.type)&&f.size<=2*1024*1024).slice(0,6);
    void Promise.all(images.map(async file=>{
      try{const bytes=await mailBytes(`/api/mail/message?id=${encodeURIComponent(id)}&part=${encodeURIComponent(file.part)}`,{signal:controller.signal},2);if(controller.signal.aborted)return;if(bytes.byteLength>2*1024*1024)throw Error("Image too large");
        const url=URL.createObjectURL(new Blob([bytes],{type:file.type}));urls.push(url);setInline(old=>({...old,[file.contentId!.replace(/[<>]/g,"").toLowerCase()]:url}));
      }catch{if(!controller.signal.aborted)setInlineFailures(n=>n+1);}
    }));
    return()=>{controller.abort();urls.forEach(url=>URL.revokeObjectURL(url));};
  },[id,files,inlineRetry]);
  useEffect(()=>{const recover=()=>{if(inlineFailures)setInlineRetry(n=>n+1);if(externalFailures)setImageEpoch(n=>n+1);};window.addEventListener("online",recover);return()=>window.removeEventListener("online",recover);},[inlineFailures,externalFailures]);
  const document=useMemo(()=>{
    if(typeof window==="undefined")return "";
    const purifier=DOMPurify(window);
    purifier.addHook("uponSanitizeElement",node=>{if(node.nodeName==="IMG"){const image=node as Element;const source=image.getAttribute("src")||image.getAttribute("data-src")||image.getAttribute("srcset")?.trim().split(/\s+/)[0]?.replace(/,$/,"");if(source)image.setAttribute("src",source.startsWith("//")?`https:${source}`:source);}});
    purifier.addHook("uponSanitizeAttribute",(node,data)=>{
      if(node.nodeName!=="IMG")return;
      if(data.attrName==="src"){
        let cid="";try{cid=decodeURIComponent(data.attrValue.replace(/^cid:/i,"")).replace(/[<>]/g,"").toLowerCase();}catch{}
        if(/^cid:/i.test(data.attrValue)&&inline[cid])data.attrValue=inline[cid];
        else if(!((remote&&/^https?:\/\//i.test(data.attrValue))||/^data:image\/(png|jpeg|gif|webp);base64,/i.test(data.attrValue)))data.keepAttr=false;
      }
    });
    purifier.addHook("afterSanitizeAttributes",node=>{
      if(node.nodeName==="A"){node.setAttribute("target","_blank");node.setAttribute("rel","noopener noreferrer");}
    });
    const clean=purifier.sanitize(html,{
      FORCE_BODY:true,
      ALLOWED_TAGS:["style","div","p","span","br","hr","table","thead","tbody","tfoot","tr","td","th","caption","colgroup","col","img","a","font","center","b","strong","i","em","u","s","small","sub","sup","blockquote","pre","code","ul","ol","li","h1","h2","h3","h4","h5","h6"],
      ALLOWED_ATTR:["style","class","id","href","target","rel","src","alt","title","width","height","align","valign","bgcolor","color","face","size","border","cellpadding","cellspacing","colspan","rowspan","dir","lang","role","aria-label"],
      ALLOWED_URI_REGEXP:/^(?:https?:\/\/|mailto:|blob:|data:image\/(?:png|jpeg|gif|webp);base64,)/i,
      FORBID_TAGS:["script","iframe","object","embed","form","input","button","textarea","select","svg","math","video","audio","link","meta","base"],
      FORBID_ATTR:["srcset","background","action","formaction","srcdoc","download"],ALLOW_DATA_ATTR:false,
    });
    const policy=`default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:${remote?" https: http:":""}; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
    return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:light;background:#fff}body{margin:0;padding:16px;color:#202124;font:14px/1.5 Arial,sans-serif;overflow-wrap:break-word}img{max-width:100%;height:auto}img:not([src]){display:none}a{color:#1559a3}table{max-width:100%}</style></head><body>${clean}</body></html>`;
  },[html,remote,inline,imageEpoch]);
  useEffect(()=>{
    const element=frame.current;if(!element)return;
    let observer:ResizeObserver|undefined;
    let retry:ReturnType<typeof setTimeout>|undefined;
    let cleanupClick=()=>{};
    const setup=()=>{
      observer?.disconnect();cleanupClick();
      const doc=element.contentDocument;if(!doc?.body)return;
      if(doc.URL==="about:blank")return;
      if(doc.body.getAttribute("data-mail-render")!=="ready"){setRenderError("Preview connection interrupted. Retrying automatically.");setRenderReady(false);ready.current=false;if(renderAttempts.current<3)retry=setTimeout(()=>setImageEpoch(n=>n+1),1000*2**renderAttempts.current++);return;}
      ready.current=true;setRenderReady(true);setRenderError("");renderAttempts.current=0;
      const measure=()=>setHeight(Math.min(24000,Math.max(240,Math.ceil(doc.body.getBoundingClientRect().height)+8)));
      const imageStatus=()=>setExternalFailures([...doc.images].filter(image=>Boolean(image.getAttribute("src"))&&image.complete&&!image.naturalWidth).length);
      const click=(event:MouseEvent)=>{const anchor=(event.target as Element).closest?.("a");if(anchor){event.preventDefault();const href=anchor.getAttribute("href")||"";if(/^(https?:\/\/|mailto:)/i.test(href))window.open(href,"_blank","noopener,noreferrer");}};
      doc.addEventListener("click",click);doc.addEventListener("error",imageStatus,true);doc.addEventListener("load",imageStatus,true);cleanupClick=()=>{doc.removeEventListener("click",click);doc.removeEventListener("error",imageStatus,true);doc.removeEventListener("load",imageStatus,true);};
      observer=new ResizeObserver(measure);observer.observe(doc.body);measure();imageStatus();
    };
    element.addEventListener("load",setup);if(element.contentDocument?.readyState==="complete")setup();
    return()=>{clearTimeout(retry);element.removeEventListener("load",setup);observer?.disconnect();cleanupClick();};
  },[document,imageEpoch]);
  useEffect(()=>{
    if(!document)return;
    ready.current=false;setRenderReady(false);
    const form=window.document.createElement("form");form.method="POST";form.action="/api/mail/render";form.target=frameName;form.hidden=true;
    for(const [name,value] of Object.entries({id,html:document,images:remote?"1":"0"})){const input=window.document.createElement("input");input.type="hidden";input.name=name;input.value=value;form.appendChild(input);}
    window.document.body.appendChild(form);form.submit();setTimeout(()=>form.remove(),0);
    const timeout=setTimeout(()=>{if(!ready.current){setRenderError("Preview connection interrupted. Please retry.");if(renderAttempts.current<3){renderAttempts.current++;setImageEpoch(n=>n+1);}}},20000);
    return()=>clearTimeout(timeout);
  },[document,imageEpoch,frameName,id,remote]);
  return <section className="mail-original">
    <div className="mail-original-tools"><span>Original email · sender formatting</span><Button className="secondary" aria-pressed={remote} onClick={()=>setRemote(v=>!v)}>{remote?"Block external images":"Load external images"}</Button></div>
    <small className="mail-original-privacy">{remote?"External images enabled for this message; they may notify the sender that you opened it.":"External images blocked for privacy. Embedded images load from your private mailbox."}</small>
    {(inlineFailures>0||externalFailures>0)&&<p className="mail-image-status" role="status">Some images could not load. <Button className="secondary" onClick={()=>{setInlineRetry(n=>n+1);setImageEpoch(n=>n+1);}}>Retry images</Button></p>}
    {renderError&&<p className="mail-image-status" role="status">{renderError}<Button className="secondary" onClick={()=>{renderAttempts.current=0;setImageEpoch(n=>n+1);}}>Retry preview</Button></p>}
    {!renderReady&&<div className="mail-loading-skeleton" aria-label="Rendering original email" role="status"><i/><i/><i/><i/></div>}
    <div className="mail-body mail-formatted"><iframe key={imageEpoch} name={frameName} ref={frame} title="Original email" sandbox="allow-same-origin" referrerPolicy="no-referrer" style={{height,visibility:renderReady?"visible":"hidden",position:renderReady?"relative":"absolute",pointerEvents:renderReady?"auto":"none"}}/></div>
  </section>;
}
