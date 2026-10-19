import test from "node:test";
import assert from "node:assert/strict";
import { mailJson } from "../src/lib/mail/request";
import { sortMail,mergeMailPreviews } from "../src/lib/mail/list";
import type { MailMessage } from "../src/lib/mail/model";
test("progressive header pages merge without duplicates or losing old messages on refresh",()=>{
 const m=(uid:number,id=String(uid))=>({id,uid,folder:"inbox",updatedAt:uid,subject:"example",sender:"sender@example.invalid",to:"user@example.invalid",body:""}) as MailMessage;
 const initial=Array.from({length:40},(_,i)=>m(i+417)),older=Array.from({length:100},(_,i)=>m(i+317));
 const merged=mergeMailPreviews(initial,older);assert.equal(merged.length,140);assert.equal(mergeMailPreviews(merged,initial).length,140);
 assert.equal(sortMail(merged)[0].uid,456);assert.equal(sortMail(merged,"oldest")[0].uid,317);
 assert.deepEqual(mergeMailPreviews(merged,[m(456,"changed-connection-reference")]).map(m=>m.id),["changed-connection-reference"]);
});
test("mail reads recover transient failures without retrying authorization errors or writes", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) throw Error("offline");
      return Response.json({ ok: true });
    };
    assert.deepEqual(await mailJson("/mail", {}, 1), { ok: true });
    assert.equal(calls, 2);
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ error: "Sign in required" }, { status: 401 });
    };
    await assert.rejects(mailJson("/mail", {}, 2));
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw Error("offline");
    };
    await assert.rejects(mailJson("/send", { method: "POST" }));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("hung mailbox requests release their timeout rather than locking sync forever", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Error("timeout")), {
        once: true,
      });
    });
  try {
    await assert.rejects(mailJson("/mail", {}, 0, 5), /Connection interrupted/);
  } finally {
    globalThis.fetch = original;
  }
});
test("newest first is deterministic after filtering, refresh and new arrivals", () => {
  const rows = [
    { id: "middle", updatedAt: 2 },
    { id: "old", updatedAt: 1 },
    { id: "new", updatedAt: 3 },
  ] as MailMessage[];
  assert.deepEqual(
    sortMail(rows).map((m) => m.id),
    ["new", "middle", "old"],
  );
  assert.deepEqual(
    sortMail(rows, "oldest").map((m) => m.id),
    ["old", "middle", "new"],
  );
  assert.equal(rows[0].id, "middle");
  assert.equal(
    sortMail([...rows, { id: "arrival", updatedAt: 4 } as MailMessage])[0].id,
    "arrival",
  );
});
