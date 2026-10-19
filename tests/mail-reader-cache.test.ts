import test from "node:test";
import assert from "node:assert/strict";
import { createReaderCache } from "../src/lib/mail/reader-cache";
test("reader cache deduplicates requests and reuses messages without browser storage",async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({body:"Fictional cached message",truncated:false,attachments:[]});};
  try{const cache=createReaderCache();await Promise.all([cache.load("a"),cache.load("a")]);assert.equal(calls,1);await cache.load("a");assert.equal(calls,1);assert.equal(cache.get("a")?.body,"Fictional cached message");await cache.load("a",true);assert.equal(calls,2);cache.clear();assert.equal(cache.get("a"),null);assert.equal(createReaderCache().get("a"),null);}finally{globalThis.fetch=original;}
});
test("disconnect cannot repopulate reader cache from a late request",async()=>{
  const original=globalThis.fetch;let release!:()=>void;const wait=new Promise<void>(r=>release=r);
  globalThis.fetch=async()=>{await wait;return Response.json({body:"Private old message",truncated:false,attachments:[]});};
  try{const cache=createReaderCache();const request=cache.load("a");cache.clear();release();await request;assert.equal(cache.get("a"),null);}finally{globalThis.fetch=original;}
});
