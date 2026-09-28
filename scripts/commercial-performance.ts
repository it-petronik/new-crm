/** Fictional, in-memory SQLite benchmark. No bindings, secrets, network or AI. */
import { writeFileSync, mkdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/d1";
import { d1, migratedDatabase } from "../tests/support/sqlite-d1";
import * as schema from "../src/lib/schema";
import {
  commercialView,
  searchCommercial,
  capabilities,
} from "../src/lib/commercial/store";
import type { Database } from "../src/lib/d1";
import type { Actor, RecordItem } from "../src/lib/domain";
import { contactInput, capabilityInput } from "../src/lib/commercial/model";
async function main() {
  const sqlite = migratedDatabase();
  const db = drizzle(d1(sqlite) as never, { schema }) as Database;
  const actor: Actor = {
    id: "bench",
    name: "Fictional manager",
    role: "MD",
    companies: ["Petronik"],
    branches: [],
  };
  const insert = sqlite.prepare(
    "INSERT INTO BusinessRecord(id,kind,company,branch,ownerId,status,payload,version,createdAt,updatedAt) VALUES(?,?,'Petronik','Main','bench',?,?,1,1,1)",
  );
  const records = new Map<string, RecordItem>();
  function record(
    id: string,
    kind: RecordItem["kind"],
    extra: Partial<RecordItem> = {},
  ) {
    const r: RecordItem = {
      id,
      kind,
      company: "Petronik",
      branch: "Main",
      ownerId: "bench",
      owner: "Fictional manager",
      title: `Fictional ${id}`,
      status: "Active",
      contact: "",
      product: "",
      quantity: 500,
      unit: "MT",
      amount: 0,
      currency: "USD",
      due: "",
      source: "Benchmark",
      detail: "",
      createdAt: "2026-09-27T00:00:00.000Z",
      updatedAt: "2026-09-27T00:00:00.000Z",
      ...extra,
    };
    insert.run(id, kind, r.status, JSON.stringify(r));
    records.set(id, r);
  }
  sqlite.exec("BEGIN");
  for (let i = 0; i < 1000; i++) record(`customer-${i}`, "customers");
  for (let i = 0; i < 300; i++) {
    record(`supplier-${i}`, "suppliers");
    record(`product-${i}`, "products");
  }
  const person = sqlite.prepare(
    "INSERT INTO Contact(id,parentId,company,branch,details,active,version,createdAt,updatedAt) VALUES(?,?,'Petronik','Main',?,1,1,1,1)",
  );
  for (let i = 0; i < 3000; i++)
    person.run(
      `contact-${i}`,
      `customer-${i % 1000}`,
      JSON.stringify(contactInput.parse({ name: `Fictional person ${i}` })),
    );
  for (let i = 0; i < 5000; i++)
    record(`lead-${i}`, "leads", {
      customerId: `customer-${i % 1000}`,
      productId: `product-${i % 300}`,
      status: "Qualified",
    });
  const room = sqlite.prepare(
    "INSERT INTO Deal(id,leadId,company,branch,createdAt) VALUES(?,?,'Petronik','Main',1)",
  );
  for (let i = 0; i < 500; i++) room.run(`deal-${i}`, `lead-${i}`);
  const cap = sqlite.prepare(
    "INSERT INTO SupplierProductCapability(id,supplierId,productId,company,branch,details,active,version,createdAt,updatedAt) VALUES(?,?,?,'Petronik','Main',?,1,1,1,1)",
  );
  for (let i = 0; i < 900; i++)
    cap.run(
      `cap-${i}`,
      `supplier-${i % 300}`,
      `product-${i % 300}`,
      JSON.stringify(capabilityInput.parse({ originCountry: "UAE" })),
    );
  for (let i = 0; i < 500; i++)
    record(`quote-${i}`, "quotations", {
      customerId: `customer-${i % 1000}`,
      productId: `product-${i % 300}`,
      parentId: `lead-${i}`,
      status: "Draft",
    });
  sqlite.exec("COMMIT");
  const tasks = {
    customer360: () => commercialView(db, actor, "customer-42"),
    supplier360: () => commercialView(db, actor, "supplier-42"),
    product: () => commercialView(db, actor, "product-42"),
    dealRoom: () => commercialView(db, actor, "deal-42", true),
    supplierMatching: () =>
      capabilities(db, actor, records.get("lead-42")!, true),
    search: () => searchCommercial(db, actor, "Fictional"),
  };
  const timings: Record<string, unknown> = {};
  for (const [name, run] of Object.entries(tasks)) {
    await run();
    const ms: number[] = [];
    for (let i = 0; i < 25; i++) {
      const t = performance.now();
      await run();
      ms.push(performance.now() - t);
    }
    ms.sort((a, b) => a - b);
    timings[name] = { medianMs: +ms[12].toFixed(3), p95Ms: +ms[23].toFixed(3) };
  }
  const plans = Object.fromEntries(
    ["customerId", "productId", "parentId"].map((key) => [
      key,
      sqlite
        .prepare(
          `EXPLAIN QUERY PLAN SELECT * FROM BusinessRecord WHERE json_extract(payload,'$.${key}')=? AND company='Petronik' AND branch='Main'`,
        )
        .all("fictional"),
    ]),
  );
  const out = {
    dataset: {
      customers: 1000,
      contacts: 3000,
      leads: 5000,
      suppliers: 300,
      products: 300,
      capabilities: 900,
      deals: 500,
      quotations: 500,
    },
    environment:
      "In-memory SQLite through the real Drizzle D1 driver adapter; not network or production latency",
    iterations: 25,
    timings,
    plans,
    foreignKeyViolations: sqlite.prepare("PRAGMA foreign_key_check").all()
      .length,
    aiCalls: sqlite.prepare("SELECT count(*) n FROM AiUsage").get()?.n,
    backfill: {
      safeLinks: 0,
      unlinkedLegacyRows: 0,
      ambiguous: 0,
      performed: false,
    },
  };
  mkdirSync("work", { recursive: true });
  writeFileSync(
    "work/commercial-performance.json",
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
  sqlite.close();
}
void main();
