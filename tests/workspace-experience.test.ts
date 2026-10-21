import test from "node:test";
import assert from "node:assert/strict";
import { makePreview, previewActor } from "../src/lib/fixtures";
import { roles, canWrite, type Actor, type RecordItem } from "../src/lib/domain";
import { quickCreateKinds, quickKinds } from "../src/lib/workspace-experience";
import { availableStatuses, transition } from "../src/lib/workflow";
import { dailyRoutine } from "../src/lib/role-home";
import { drizzle } from "drizzle-orm/d1";
import { d1, migratedDatabase } from "./support/sqlite-d1";
import * as schema from "../src/lib/schema";
import type { Database } from "../src/lib/d1";
import { listRecordsForActor } from "../src/lib/data";

test("quick creation is hidden for readable but non-writable modules and respects brand/branch", () => {
  for (const role of roles) {
    const actor: Actor = { ...previewActor, role };
    for (const kind of quickKinds) assert.equal(quickCreateKinds(actor).includes(kind), canWrite(actor, { kind, company: actor.companies[0], branch: actor.branches[0] || "Main", ownerId: actor.id } as RecordItem), `${role}: ${kind}`);
    assert.equal(dailyRoutine(actor).length, 3);
  }
  assert.deepEqual(quickCreateKinds({ ...previewActor, role: "MD Assistant" }), quickCreateKinds(previewActor));
  assert.deepEqual(quickCreateKinds({ ...previewActor, role: "Accounts Manager" }), []);
  assert.deepEqual(quickCreateKinds({ ...previewActor, moduleAccess: { leads:"read",customers:"read",suppliers:"read",products:"read" } }), []);
  assert.deepEqual(quickCreateKinds({ ...previewActor, branches:["Dubai"] }, "Petronik", "Other"), []);
  assert.deepEqual(quickCreateKinds(previewActor, "Unknown company"), []);
});

test("status menus expose only transitions accepted by the actual workflow", () => {
  const workspace = makePreview();
  for (const role of roles) {
    const actor = { ...previewActor, role };
    for (const record of workspace.records) {
      for (const status of availableStatuses(actor, record)) assert.doesNotThrow(() => transition(workspace, actor, record.id, status), `${role}: ${record.kind} ${record.status} -> ${status}`);
    }
  }
  const quote = { ...workspace.records.find(r => r.kind === "quotations")!, ownerId:previewActor.id, status:"Pending Approval" };
  const sales: Actor = { ...previewActor, role:"Sales Executive" };
  assert.ok(!availableStatuses(sales, quote).includes("Approved"));
  assert.ok(!availableStatuses(sales, quote).includes("Sent"));
  assert.deepEqual(availableStatuses({ ...sales, role:"MD Assistant" }, quote), availableStatuses(previewActor,quote));
  const invoice = workspace.records.find(r => r.kind === "accounts")!;
  const statuses = availableStatuses({ ...previewActor, role:"Accountant" }, { ...invoice, status:"Sent" });
  assert.ok(!statuses.includes("Paid"));
  assert.ok(!statuses.includes("Partially Paid"));
});

test("page-specific windows preserve older quotations, HR and leave when leads fill the shared window", async () => {
  const sqlite=migratedDatabase(),db=drizzle(d1(sqlite) as never,{schema}) as Database;
  sqlite.prepare("INSERT INTO User(id,email,name,passwordHash,role,companies,branches,moduleAccess,active,createdAt) VALUES(?,?,?,?,?,'[\"Petronik\"]','[]','{}',1,1)").run(previewActor.id,"fictional@example.invalid","Fictional","x","MD");
  const base=makePreview().records.find(r=>r.kind==="leads")!;
  const insert=sqlite.prepare("INSERT INTO BusinessRecord(id,kind,company,branch,ownerId,status,payload,version,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,1,?,?)");
  for(let i=0;i<1005;i++){
    const record={...base,id:`new-lead-${i}`,company:"Petronik",ownerId:previewActor.id};
    insert.run(record.id,record.kind,record.company,record.branch,record.ownerId,record.status,JSON.stringify(record),2000+i,2000+i);
  }
  for(const [id,kind,company,branch] of [["old-quote","quotations","Petronik","Main"],["other-quote","quotations","Afrilube","Main"],["other-branch","quotations","Petronik","Other"],["person","hr","Petronik","Main"],["request","leave","Petronik","Main"]]){
    const record={...base,id,kind,company,branch,ownerId:previewActor.id};
    insert.run(id,kind,company,branch,record.ownerId,record.status,JSON.stringify(record),1,1);
  }
  const actor={...previewActor,companies:["Petronik"],branches:["Main"]};
  assert.ok(!(await listRecordsForActor(db,actor.companies,actor.branches,1000,0,actor)).some(row=>row.id==="old-quote"));
  assert.deepEqual((await listRecordsForActor(db,actor.companies,actor.branches,1000,0,actor,"quotations")).map(row=>row.id),["old-quote"]);
  assert.deepEqual((await listRecordsForActor(db,actor.companies,actor.branches,1000,0,actor,"hr")).map(row=>row.id).sort(),["person","request"]);
  assert.equal((await listRecordsForActor(db,actor.companies,actor.branches,1000,0,{...actor,moduleAccess:{quotations:"none"}},"leads")).length,1000);
  sqlite.close();
});
