import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/d1";
import { d1, migratedDatabase } from "./support/sqlite-d1";
import * as schema from "../src/lib/schema";
import type { Database } from "../src/lib/d1";
import {
  roles,
  companies,
  canRead,
  canWrite,
  canApprove,
  allowedModules,
  type Actor,
  type RecordItem,
} from "../src/lib/domain";
import { initializeLead } from "../src/lib/lead-desk";
import { makePreview, previewActor } from "../src/lib/fixtures";
import { listLeadDeskPage, listRecordsForActor } from "../src/lib/data";
import { readRecords } from "../src/lib/commercial/store";
import { canAssign } from "../src/lib/workflow";
import { operationsAccess } from "../src/lib/operations/model";
import {
  canBuyCosts,
  canExecute,
  canProspect,
} from "../src/lib/execution/model";
import { canEditRule } from "../src/lib/tasks/model";
import { canManageTemplates } from "../src/lib/outbound/model";
import { branchesForRole } from "../src/lib/access-control";
import { workspaceUrl, workspaceParams } from "../src/lib/workspace-url";

const salesperson: Actor = {
  ...previewActor,
  id: "sales",
  role: "Sales Executive",
  companies: ["Petronik", "Enercore"],
};
const template = makePreview().records.find((r) => r.kind === "leads")!;
const lead = initializeLead(
  { ...template, id: "created", ownerId: "assigned", company: "Petronik" },
  salesperson,
);

test("only creator or assignee sees leads, except MD, MD Assistant and IT; scope still applies", () => {
  for (const role of roles) {
    const person = { ...salesperson, id: "unrelated", role };
    const group = ["MD", "MD Assistant", "IT Administrator"].includes(role);
    assert.equal(canRead(person, lead), group, role);
    if (allowedModules(person).includes("leads")) {
      assert.equal(
        canRead({ ...person, id: "sales" }, lead),
        true,
        `${role} creator`,
      );
      assert.equal(
        canRead({ ...person, id: "assigned" }, lead),
        true,
        `${role} assignee`,
      );
    }
    assert.equal(canRead({ ...person, companies: ["Afrilube"] }, lead), false);
    assert.equal(canRead({ ...person, branches: ["Other"] }, lead), false);
    assert.equal(
      canRead({ ...person, moduleAccess: { leads: "none" } }, lead),
      false,
    );
  }
  assert.equal(
    canAssign(salesperson, lead),
    true,
    "Creator can hand over their own lead",
  );
  assert.equal(canAssign({ ...salesperson, id: "unrelated" }, lead), false);
  assert.equal(
    canAssign({ ...salesperson, moduleAccess: { leads: "read" } }, lead),
    false,
  );
  assert.equal(
    canRead(salesperson, { ...lead, attributes: {} }),
    false,
    "Unknown legacy authorship is not guessed",
  );
});

test("SQL lists and related-record scopes include created and assigned leads but exclude team strangers", async () => {
  const sqlite = migratedDatabase();
  const db = drizzle(d1(sqlite) as never, { schema }) as Database;
  for (const id of ["sales", "assigned", "stranger"])
    sqlite
      .prepare(
        "INSERT INTO User(id,email,name,passwordHash,role,companies,branches,moduleAccess,active,createdAt) VALUES(?,?,?,?,?,'[\"Petronik\"]','[]','{}',1,1)",
      )
      .run(id, `${id}@example.invalid`, id, "x", "Sales Executive");
  const rows = [
    lead,
    {
      ...lead,
      id: "assigned-to-me",
      ownerId: "sales",
      attributes: { leadCapturedById: "stranger" },
    },
    {
      ...lead,
      id: "hidden",
      ownerId: "stranger",
      attributes: { leadCapturedById: "stranger" },
    },
  ];
  for (const r of rows)
    sqlite
      .prepare(
        "INSERT INTO BusinessRecord(id,kind,company,branch,ownerId,status,payload,version,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,1,1,1)",
      )
      .run(
        r.id,
        r.kind,
        r.company,
        r.branch,
        r.ownerId,
        r.status,
        JSON.stringify(r),
      );
  for (const role of [
    "Sales Executive",
    "Sales Manager",
    "Marketing Manager",
    "Group Manager",
  ] as const) {
    const actor = { ...salesperson, role };
    for (const listed of [
      await listLeadDeskPage(db, actor),
      await listRecordsForActor(
        db,
        actor.companies,
        actor.branches,
        1000,
        0,
        actor,
      ),
    ])
      assert.deepEqual(listed.map((r) => r.id).sort(), [
        "assigned-to-me",
        "created",
      ]);
    assert.deepEqual((await readRecords(db, actor)).map((r) => r.id).sort(), [
      "assigned-to-me",
      "created",
    ]);
  }
  assert.equal(
    (await listLeadDeskPage(db, { ...salesperson, role: "IT Administrator" }))
      .length,
    3,
  );
  sqlite.close();
});

test("legacy creator backfill uses only trusted matching creation audits and is idempotent", () => {
  const sqlite = migratedDatabase();
  sqlite
    .prepare(
      "INSERT INTO User(id,email,name,passwordHash,role,companies,branches,active,createdAt) VALUES('creator','creator@example.invalid','Creator','x','Sales Executive','[\"Petronik\"]','[]',1,1)",
    )
    .run();
  for (const [id, attrs] of [
    ["trusted", {}],
    ["unknown", {}],
    ["protected", { leadCapturedById: "existing" }],
  ] as const) {
    const r = { ...lead, id, ownerId: "creator", attributes: attrs };
    sqlite
      .prepare(
        "INSERT INTO BusinessRecord(id,kind,company,branch,ownerId,status,payload,version,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,1,1,1)",
      )
      .run(
        id,
        r.kind,
        r.company,
        r.branch,
        r.ownerId,
        r.status,
        JSON.stringify(r),
      );
    sqlite
      .prepare(
        "INSERT INTO AuditEvent(id,company,actorId,actor,action,recordId,at) VALUES(?,?,?,?,?,?,1)",
      )
      .run(
        id,
        "Petronik",
        "creator",
        "Creator",
        id === "unknown" ? "Updated leads" : "Created leads",
        id,
      );
  }
  const migration = readFileSync(
    "drizzle/0024_lead_creator_visibility.sql",
    "utf8",
  );
  sqlite.exec(migration);
  sqlite.exec(migration);
  const result = sqlite
    .prepare(
      "SELECT id,json_extract(payload,'$.attributes.leadCapturedById') creator FROM BusinessRecord ORDER BY id",
    )
    .all();
  assert.deepEqual(
    result.map((r) => [r.id, r.creator]),
    [
      ["protected", "existing"],
      ["trusted", "creator"],
      ["unknown", null],
    ],
  );
  const customer = {
    ...lead,
    id: "customer",
    kind: "customers",
    attributes: {},
  };
  sqlite
    .prepare(
      "INSERT INTO BusinessRecord(id,kind,company,branch,ownerId,status,payload,version,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,1,1,1)",
    )
    .run(
      customer.id,
      customer.kind,
      customer.company,
      customer.branch,
      "creator",
      customer.status,
      JSON.stringify(customer),
    );
  const apolloMigration = readFileSync(
    "drizzle/0026_apollo_lead_creator.sql",
    "utf8",
  );
  sqlite
    .prepare(
      "UPDATE BusinessRecord SET payload=json_set(payload,'$.customerId','customer') WHERE id='unknown'",
    )
    .run();
  assert.throws(
    () =>
      sqlite
        .prepare(
          "INSERT INTO ApolloImport(id,actorId,company,branch,providerId,providerKind,customerId,leadId,createdAt) VALUES('wrong','creator','Afrilube','Main','fake','company','customer','unknown',1)",
        )
        .run(),
    /relationship/,
  );
  sqlite.exec(apolloMigration);
  assert.equal(
    sqlite
      .prepare(
        "SELECT json_extract(payload,'$.attributes.leadCapturedById') creator FROM BusinessRecord WHERE id='unknown'",
      )
      .get()!.creator,
    null,
  );
  sqlite
    .prepare(
      "INSERT INTO ApolloImport(id,actorId,company,branch,providerId,providerKind,customerId,leadId,createdAt) VALUES('right','creator','Petronik','Main','fake','company','customer','unknown',2)",
    )
    .run();
  sqlite.exec(apolloMigration);
  sqlite.exec(apolloMigration);
  assert.equal(
    sqlite
      .prepare(
        "SELECT json_extract(payload,'$.attributes.leadCapturedById') creator FROM BusinessRecord WHERE id='unknown'",
      )
      .get()!.creator,
    "creator",
  );
  sqlite.close();
});

test("IT equals MD capabilities across records, operations and internal automation while keeping scope", () => {
  const md = { ...previewActor, id: "admin", companies: ["Petronik"] },
    it = { ...md, role: "IT Administrator" as const };
  assert.deepEqual(allowedModules(it), allowedModules(md));
  for (const r of makePreview().records) {
    assert.equal(canRead(it, r), canRead(md, r));
    assert.equal(canWrite(it, r), canWrite(md, r));
    assert.equal(canApprove(it, r), canApprove(md, r));
    assert.equal(canAssign(it, r), canAssign(md, r));
  }
  assert.deepEqual(operationsAccess(it), operationsAccess(md));
  for (const actor of [it, md]) {
    assert.equal(canProspect(actor), true);
    assert.equal(canBuyCosts(actor, lead), true);
    assert.equal(canExecute(actor, lead), true);
    assert.equal(canEditRule(actor, "Petronik", "lead_follow_up"), true);
    assert.equal(canManageTemplates(actor, "Petronik"), true);
    assert.equal(
      canBuyCosts({ ...actor, companies: ["Afrilube"] }, lead),
      false,
    );
  }
  assert.deepEqual(branchesForRole(md, "IT Administrator"), []);
});

test("Enercore is a first-class fifth brand with a stable readable route", () => {
  assert.equal(companies.length, 5);
  assert.ok(companies.includes("Enercore"));
  assert.equal(
    workspaceUrl("leads", "Enercore"),
    "/workspace/enercore/lead-desk",
  );
  assert.equal(
    workspaceParams("/workspace/enercore/sales-pipeline", "").get("company"),
    "Enercore",
  );
});

test("Enercore migration updates only already-all-brand group accounts and is idempotent", () => {
  const sqlite = migratedDatabase();
  const old = ["Petronik", "Afrilube", "Petronex", "Istanegry"];
  for (const [id, role, scope] of [
    ["md", "MD", old],
    ["it", "IT Administrator", old],
    ["assistant", "MD Assistant", old],
    ["sales", "Sales Executive", old],
    ["partial", "MD", ["Petronik"]],
  ] as const) {
    sqlite
      .prepare(
        "INSERT INTO User(id,email,name,passwordHash,role,companies,branches,active,createdAt) VALUES(?,?,?,?,?,?,'[]',1,1)",
      )
      .run(id, `${id}@example.invalid`, id, "x", role, JSON.stringify(scope));
    sqlite
      .prepare(
        "INSERT INTO Session(id,userId,expiresAt) VALUES(?,?,9999999999999)",
      )
      .run(`session-${id}`, id);
  }
  const migration = readFileSync("drizzle/0025_enercore_brand.sql", "utf8");
  sqlite.exec(migration);
  sqlite.exec(migration);
  for (const row of sqlite.prepare("SELECT id,companies FROM User").all()) {
    const has = JSON.parse(row.companies as string).includes("Enercore");
    assert.equal(has, ["md", "it", "assistant"].includes(row.id as string));
    assert.equal(
      Number(
        sqlite
          .prepare("SELECT count(*) n FROM Session WHERE userId=?")
          .get(row.id)!.n,
      ),
      has ? 0 : 1,
    );
  }
  assert.equal(
    Number(
      sqlite
        .prepare("SELECT count(*) n FROM AuditEvent WHERE subject='account'")
        .get()!.n,
    ),
    3,
  );
  sqlite.close();
});
