import test from "node:test";
import assert from "node:assert/strict";
import type { D1Database } from "@cloudflare/workers-types";
import { d1, migratedDatabase } from "./support/sqlite-d1";
import {
  sealPassword,
  openPassword,
  permittedHost,
  MailboxError,
} from "../src/lib/mail/credentials";
import {
  connectMailbox,
  syncMailbox,
  mailboxView,
  mailboxAction,
  saveMailboxDraft,
  readMailboxMessage,
  syncMailboxFolders,
} from "../src/lib/mail/mailbox";
import { parseIncoming, mailParts,safeMailText,chooseMailFolder,type MailTransport } from "../src/lib/mail/imap";
import {compactMailText} from "../src/lib/mail/display";
import {mailboxPage} from "../src/lib/mail/transient";
test("older header pages require an owned signed cursor, preserve folder identity and never store messages",async()=>{
 const {sqlite,env}=fixture(),t=transport(),fetch=t.fetch;t.fetch=async(...args)=>{const data=await fetch(...args);return {...data,messages:data.messages.map(m=>({...m,uid:501}))};};await connectMailbox(env,"one",input,t);const snapshot=await preview(env,"one",t),first=snapshot.messages[0] as unknown as {id:string};let pages=0;
 t.page=async(_a,path,before,validity)=>{pages++;assert.equal(path,"INBOX");return {validity,total:456,hasMore:false,messages:[{uid:before-1,uidValidity:validity,sender:"older@example.invalid",recipient:input.address,subject:"Older message",body:"",receivedAt:1,isRead:false,truncated:false}]};};
 const result=await mailboxPage(env,"one",{cursor:first.id,folder:"inbox"},t);assert.equal(result.messages.length,1);assert.equal(result.total,456);
 await assert.rejects(mailboxPage(env,"two",{cursor:first.id,folder:"inbox"},t));await assert.rejects(mailboxPage(env,"one",{cursor:first.id,folder:"drafts"},t));await assert.rejects(mailboxPage(env,"one",{cursor:first.id+"x",folder:"inbox"},t));assert.equal(pages,1);
 assert.equal((sqlite.prepare("SELECT count(*) AS n FROM MailboxMessage").get() as {n:number}).n,0);sqlite.close();
});
const secret = Buffer.alloc(32, 7).toString("base64");
test("new-tab bootstrap reads return private headers without taking another tab's lease",async()=>{
 const {sqlite,env}=fixture(),t=transport();await connectMailbox(env,"one",input,t);
 sqlite.prepare("UPDATE MailboxConnection SET syncLease='other-tab',syncLeaseAt=?,lastAttemptAt=?,folderLeaseAt=?").run(Date.now(),Date.now(),Date.now());
 assert.equal((await syncMailbox(env,"one",t)).synced,false);
 const inbox=await syncMailbox(env,"one",t,true);assert.equal(inbox.synced,true);assert.equal(inbox.messages?.length,1);
 assert.equal((sqlite.prepare("SELECT syncLease FROM MailboxConnection").get() as {syncLease:string}).syncLease,"other-tab");
 t.folders=async()=>[{kind:"sent",path:"INBOX.Sent",total:1,validity:"1",messages:(await t.fetch({host:input.host,address:input.address,password})).messages}];
 const folders=await syncMailboxFolders(env,"one",t);assert.equal(folders.synced,true);assert.equal(folders.messages?.length,1);
 assert.equal((sqlite.prepare("SELECT count(*) AS n FROM MailboxMessage").get() as {n:number}).n,0);sqlite.close();
});
test("transient errors recover after five seconds but authentication failures stop automatic polling",async()=>{
 const {sqlite,env}=fixture(),t=transport(),normal=t.fetch;await connectMailbox(env,"one",input,t);let calls=0;
 t.fetch=async()=>{calls++;throw new MailboxError(502,"Network interruption");};await assert.rejects(syncMailbox(env,"one",t));
 sqlite.prepare("UPDATE MailboxConnection SET lastAttemptAt=?").run(Date.now()-6000);t.fetch=async(...args)=>{calls++;return normal(...args);};assert.equal((await syncMailbox(env,"one",t)).synced,true);assert.equal(calls,2);
 sqlite.prepare("UPDATE MailboxConnection SET lastAttemptAt=0").run();t.fetch=async()=>{calls++;throw new MailboxError(403,"Mailbox sign-in failed");};await assert.rejects(syncMailbox(env,"one",t));
 sqlite.prepare("UPDATE MailboxConnection SET lastAttemptAt=0").run();assert.equal((await syncMailbox(env,"one",t)).synced,false);assert.equal(calls,3);sqlite.close();
});
async function preview(env:ReturnType<typeof fixture>["env"],owner:string,t:MailTransport){
 await env.DB.prepare("UPDATE MailboxConnection SET lastAttemptAt=0 WHERE ownerId=?").bind(owner).run();
 const inbox=await syncMailbox(env,owner,t,true),folders=t.folders?await syncMailboxFolders(env,owner,t):null,view=await mailboxView(env,owner);
 return {...view,messages:[...view.messages,...(inbox.messages||[]),...(folders?.messages||[])]};
}
test("attachment metadata is owner checked and does not download message bodies",async()=>{
  const {sqlite,env}=fixture(),t=transport();let bodies=0,metadata=0;
  t.detail=async()=>{bodies++;return {body:"private",truncated:false,attachments:[]};};
  t.metadata=async()=>{metadata++;return [{part:"2",name:"example.png",type:"image/png",size:68}];};
  await connectMailbox(env,"one",input,t);await syncMailbox(env,"one",t);
  const view=await preview(env,"one",t),id=String((view.messages![0] as Record<string,unknown>).id);
  const result=await readMailboxMessage(env,"one",id,undefined,t,true);
  assert.ok("attachments" in result);assert.equal(result.attachments.length,1);assert.equal(bodies,0);assert.equal(metadata,1);
  await assert.rejects(readMailboxMessage(env,"two",id,undefined,t,true));assert.equal(metadata,1);sqlite.close();
});
const password = "Fictional-Mailbox-Test-Only";
const input = {
  action: "connect",
  address: "one@example.invalid",
  password,
  host: "mail.petronik.ae",
};
function fixture() {
  const sqlite = migratedDatabase();
  for (const id of ["one", "two"])
    sqlite
      .prepare(
        "INSERT INTO User(id,email,name,passwordHash,role,companies,branches,active,createdAt) VALUES(?,?,?,'fictional','MD','[]','[]',1,1)",
      )
      .run(id, `${id}@example.invalid`, id);
  return {
    sqlite,
    env: {
      DB: d1(sqlite) as unknown as D1Database,
      MAILBOX_ENCRYPTION_KEY: secret,
    },
  };
}
function transport(): MailTransport {
  return {
    verify: async () => {},
    fetch: async () => ({
      validity: "1",
      total:108,
      messages: [
        {
          uid: 1,
          uidValidity: "1",
          sender: "buyer@example.invalid",
          recipient: input.address,
          subject: "Quotation enquiry",
          body: "Please quote SN500",
          receivedAt: 1,
          isRead: false,
          truncated: false,
        },
      ],
    }),
    seen: async () => {},
    send: async () => ({ status: "captured" }),
  };
}
test("mailbox passwords are encrypted and bound to the specific user and connection", async () => {
  const sealed = await sealPassword(password, secret, "one", "c");
  assert.ok(!sealed.includes(password));
  assert.equal(await openPassword(sealed, secret, "one", "c"), password);
  await assert.rejects(openPassword(sealed, secret, "two", "c"));
  await assert.rejects(openPassword(sealed, secret, "one", "other"));
  await assert.rejects(sealPassword(password, undefined, "one", "c"));
  assert.notEqual(sealed, await sealPassword(password, secret, "one", "c"));
});
test("only approved TLS mail hosts are accepted", () => {
  assert.equal(permittedHost("mail.petronik.ae"), "mail.petronik.ae");
  for (const h of ["127.0.0.1", "localhost", "evil.example", "169.254.169.254"])
    assert.throws(() => permittedHost(h));
});
test("private inbox sync deduplicates without creating CRM leads; other MD sees no messages", async () => {
  const { sqlite, env } = fixture(),
    t = transport();
  await connectMailbox(env, "one", input, t);
  await syncMailbox(env, "one", t);
  sqlite.prepare("UPDATE MailboxConnection SET lastAttemptAt=0").run();
  await syncMailbox(env, "one", t);
  const view = await preview(env, "one", t);
  assert.equal(view.messages?.length, 1);
  assert.equal((view.messages?.[0] as any).candidate, 1);
  assert.equal(view.folders.inbox.total,108);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM MailboxMessage").get()!.n,0);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM MailboxRemoteMessage").get()!.n,0);
  assert.equal((await mailboxView(env,"one")).messages.length,0);
  assert.ok(!JSON.stringify(view).includes("passwordSeal"));
  assert.equal((await mailboxView(env, "two")).connected, false);
  assert.equal(
    sqlite.prepare("SELECT count(*) AS n FROM BusinessRecord").get()!.n,
    0,
  );
  await assert.rejects(
    mailboxAction(
      env,
      "two",
      { action: "seen", id: (view.messages?.[0] as any).id, read: true },
      t,
    ),
  );
  sqlite.close();
});
test("failed sign-in never saves credentials and connection attempts are limited", async () => {
  const { sqlite, env } = fixture(),
    t = transport();
  let calls = 0;
  t.verify = async () => {
    calls++;
    throw new Error("Provider unavailable");
  };
  for (let n = 0; n < 6; n++)
    await assert.rejects(connectMailbox(env, "one", input, t));
  assert.equal(calls, 5);
  assert.equal(
    sqlite.prepare("SELECT count(*) AS n FROM MailboxConnection").get()!.n,
    0,
  );
  sqlite.close();
});
test("draft version and submission locks prevent resending; disconnect clears private data", async () => {
  const { sqlite, env } = fixture(),
    t = transport();
  await connectMailbox(env, "one", input, t);
  await syncMailbox(env, "one", t);
  const draft = {
    id: crypto.randomUUID(),
    to: "buyer@example.invalid",
    subject: "Reply",
    body: "Please confirm quantity.",
  };
  await saveMailboxDraft(env, "one", { ...draft, action: "save" }, t);
  await assert.rejects(
    saveMailboxDraft(env, "two", { ...draft, action: "save", version: 1 }, t),
  );
  await assert.rejects(
    saveMailboxDraft(env, "one", { ...draft, action: "send", version: 1 }, t),
  );
  let sent = 0;
  t.send = async () => {
    sent++;
    return { status: "captured" };
  };
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      saveMailboxDraft(
        env,
        "one",
        { ...draft, action: "send", version: 1, confirmed: true },
        t,
      ),
    ),
  );
  assert.equal(sent, 1);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(
    saveMailboxDraft(env, "one", { ...draft, action: "save", version: 2 }, t),
  );
  await mailboxAction(env, "one", { action: "disconnect", confirmed: true }, t);
  for (const table of ["MailboxConnection", "MailboxMessage", "MailboxDraft"])
    assert.equal(
      sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n,
      0,
    );
  sqlite.close();
});
test("ambiguous send outcomes are locked against automatic retries", async () => {
  const { sqlite, env } = fixture(),
    t = transport();
  await connectMailbox(env, "one", input, t);
  t.send = async () => {
    throw Error("Connection lost");
  };
  const draft = {
    id: crypto.randomUUID(),
    to: "buyer@example.invalid",
    subject: "Reply",
    body: "Hello",
    action: "send",
    confirmed: true,
  };
  assert.equal(
    (await saveMailboxDraft(env, "one", draft, t)).delivery,
    "uncertain",
  );
  await assert.rejects(saveMailboxDraft(env, "one", draft, t));
  sqlite.close();
});
test("email HTML becomes inert text; reply-to cannot replace the actual sender", async () => {
  const source = new TextEncoder().encode(
    'From: sender@example.invalid\r\nReply-To: different@example.invalid\r\nTo: one@example.invalid\r\nSubject: Test\r\nContent-Type: text/html\r\n\r\n<script>alert(1)</script><p>Hello</p><img src="https://tracker.invalid/pixel">',
  );
  const m = await parseIncoming(source, {
    uid: 1,
    uidValidity: "1",
    receivedAt: 1,
    isRead: false,
    truncated: false,
  });
  assert.equal(m.sender, "sender@example.invalid");
  assert.ok(m.body.includes("Hello"));
  assert.ok(!m.body.includes("<img"));
  assert.ok(!m.body.includes("alert"));
});
test("UID validity resets change references; explicit header enquiries still require review", async () => {
  const { sqlite, env } = fixture(),
    t = transport();
  await connectMailbox(env, "one", input, t);
  await syncMailbox(env, "one", t);
  const before = ((await preview(env, "one", t)).messages![0] as any).id;
  sqlite.prepare("UPDATE MailboxConnection SET lastAttemptAt=0").run();
  t.fetch = async () => ({
    validity: "new",
    messages: [
      {
        uid: 1,
        uidValidity: "new",
        sender: "buyer@example.invalid",
        recipient: input.address,
        subject: "Quotation enquiry",
        body: "Not fully downloaded",
        receivedAt: 2,
        isRead: true,
        truncated: true,
      },
    ],
  });
  await syncMailbox(env, "one", t);
  const after = await preview(env, "one", t);
  assert.equal(after.messages!.length, 1);
  assert.notEqual((after.messages![0] as any).id, before);
  assert.equal((after.messages![0] as any).candidate, 1);
  assert.equal((after.messages![0] as any).isRead, 1);
  sqlite.close();
});
test("large attachments do not block independent text-body selection",()=>{
 const parts=mailParts({type:"multipart/mixed",childNodes:[{part:"1",type:"multipart/alternative",childNodes:[{part:"1.1",type:"text/plain",size:80},{part:"1.2",type:"text/html",size:100}]},{part:"2",type:"application/pdf",size:20_000_000,disposition:"attachment",dispositionParameters:{filename:"Specification.pdf"}},{part:"3",type:"text/plain",disposition:"attachment",dispositionParameters:{filename:"notes.txt"},size:1000}]});
 assert.equal(parts.text?.part,"1.1");assert.equal(parts.attachments.length,2);assert.equal(parts.attachments[0].name,"Specification.pdf");assert.equal(parts.attachments[1].name,"notes.txt");assert.equal(safeMailText("<script>bad()</script><p>Hello&nbsp;buyer</p>",true).trim(),"Hello buyer");
});
test("MIME structure discovery includes unnamed inline images and normalizes case",()=>{const parts=mailParts({type:"MULTIPART/MIXED",childNodes:[{part:"1",type:"TEXT/PLAIN"},{part:"2",type:"IMAGE/PNG",disposition:"inline",id:"<signature-image>",size:2000}]});assert.equal(parts.text?.part,"1");assert.equal(parts.attachments.length,1);assert.equal(parts.attachments[0].type,"image/png");assert.equal(parts.attachments[0].contentId,"signature-image");assert.equal(mailParts({type:"image/jpeg",size:100}).attachments[0].part,"TEXT");});
test("provider folder discovery prefers special-use and supports cPanel paths",()=>{assert.equal(chooseMailFolder([{path:"Localized",specialUse:"\\Sent"},{path:"INBOX.Sent"}],"sent"),"Localized");assert.equal(chooseMailFolder([{path:"INBOX.Drafts"}],"drafts"),"INBOX.Drafts");assert.equal(chooseMailFolder([{path:"INBOX"}],"sent"),undefined);});
test("plain mail collapses excessive blank lines without changing values",()=>{assert.equal(compactMailText("\r\nHello\r\n\r\n\r\n\r\nPrice: $1,430\r\n\r\n"),"Hello\n\nPrice: $1,430");});
test("Sent and Drafts are provider-backed, private, and resolve their real folder path",async()=>{
 const {sqlite,env}=fixture(),t=transport();await connectMailbox(env,"one",input,t);const sample=(await t.fetch({host:input.host,address:input.address,password})).messages[0];t.folders=async()=>[{kind:"sent",path:"INBOX.Sent",total:19,validity:"sent1",messages:[{...sample,subject:"Real sent metadata"}]},{kind:"drafts",path:"INBOX.Drafts",total:3,validity:"draft1",messages:[{...sample,subject:"Remote draft"}]}];
 await syncMailboxFolders(env,"one",t);const view=await preview(env,"one",t);assert.equal(view.folders.sent.total,19);assert.equal(view.folders.drafts.total,3);assert.equal(view.messages?.filter((m:any)=>m.remote).length,2);const sent=view.messages!.find((m:any)=>m.subject==="Real sent metadata") as any;await assert.rejects(readMailboxMessage(env,"two",sent.id,undefined,t));let pathSeen="";t.detail=async(_a,_uid,_validity,path)=>{pathSeen=path||"";return {body:"Sent text",attachments:[],truncated:false};};await readMailboxMessage(env,"one",sent.id,undefined,t);assert.equal(pathSeen,"INBOX.Sent");await mailboxAction(env,"one",{action:"disconnect",confirmed:true},t);assert.equal(sqlite.prepare("SELECT count(*) AS n FROM MailboxRemoteMessage").get()!.n,0);sqlite.close();
});
test("private body and attachment requests re-check the owner before accessing IMAP",async()=>{
 const {sqlite,env}=fixture(),t=transport();await connectMailbox(env,"one",input,t);await syncMailbox(env,"one",t);const id=((await preview(env,"one",t)).messages![0] as any).id as string;let requested=0;
 t.detail=async()=>{requested++;return {body:"Please quote SN500: the full email is available",truncated:false,attachments:[{part:"2",name:"spec.pdf",type:"application/pdf",size:300000}]};};t.attachment=async()=>{requested++;return {bytes:new Uint8Array([1,2]),file:{part:"2",name:"spec.pdf",type:"application/pdf",size:2}};};
 await assert.rejects(readMailboxMessage(env,"two",id,undefined,t));await assert.rejects(readMailboxMessage(env,"two",id,"2",t));assert.equal(requested,0);const detail=await readMailboxMessage(env,"one",id,undefined,t);assert.ok("attachments" in detail);assert.equal((await readMailboxMessage(env,"one",id,"2",t) as any).bytes.length,2);assert.equal(requested,2);sqlite.close();
});
test("sync returns fresh transient previews without persisting downloaded emails",async()=>{
 const {sqlite,env}=fixture(),t=transport();await connectMailbox(env,"one",input,t);await syncMailbox(env,"one",t);sqlite.prepare("UPDATE MailboxMessage SET truncated=1,body='Old size warning',candidate=0").run();sqlite.prepare("UPDATE MailboxConnection SET lastAttemptAt=0").run();await syncMailbox(env,"one",t);const m=(await preview(env,"one",t)).messages![0] as any;assert.equal(m.body,"Please quote SN500");assert.equal(m.truncated,0);assert.equal(m.candidate,1);sqlite.close();
});
