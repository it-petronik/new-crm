import { test } from "node:test";
import assert from "node:assert/strict";
import { cashTotals, cashEntryError } from "../src/lib/cashbook";
import { makePreview, previewActor } from "../src/lib/fixtures";
import { mutateRecord } from "../src/lib/record-mutations";
import { transition } from "../src/lib/workflow";
test("cashbook totals exclude invoices, cancelled entries and other currencies", () => {
  const invoice = makePreview().records.find(r => r.kind === "accounts")!;
  const entry = { ...invoice, id:"cash", parentId:undefined, lines:undefined, payments:undefined, amount:10.25, status:"Recorded", attributes:{entryType:"Income", category:"Other income", paymentMethod:"Cash"} };
  assert.deepEqual(cashTotals([invoice, entry, {...entry, amount:2.1, attributes:{...entry.attributes, entryType:"Expense"}}, {...entry,currency:"AED"}, {...entry,status:"Cancelled"}], "USD"), {income:10.25,expense:2.1,net:8.15});
  assert.equal(cashEntryError(entry), "");
  assert.ok(cashEntryError({...entry,amount:-1}));
  assert.ok(cashEntryError({...entry,parentId:"invoice"}));
  const workspace = { records:[entry],audit:[] };
  assert.throws(() => mutateRecord(workspace,previewActor,entry.id,entry.updatedAt), /retained/);
  const cancelled = transition(workspace,previewActor,entry.id,"Cancelled");
  assert.equal(cashTotals(cancelled.records,"USD").income,0);
  assert.throws(() => transition(workspace,previewActor,entry.id,"Sent"), /Invalid/);
});
