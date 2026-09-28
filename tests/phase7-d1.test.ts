import type { RecordItem } from "../src/lib/domain";
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  executionFixture,
  md,
  sales,
  offer,
  scenario,
  rfq,
} from "./support/phase7";
import {
  saveRfq,
  recordOffer,
  saveScenario,
  scenarioStatus,
  prepareQuotation,
  executionView,
  offerStatus,
  executionHistory,
  saveCandidate,
} from "../src/lib/execution/store";
import {
  supplierOffers,
  commercialScenarios,
  businessRecords,
} from "../src/lib/schema";
import { transition } from "../src/lib/workflow";
import {
  addExecutionContext,
  executionSignals,
  searchExecution,
} from "../src/lib/execution/context";
import { AiContext } from "../src/lib/ai/context";
import { CommercialError } from "../src/lib/commercial/model";
const absent = (e: unknown) => e instanceof CommercialError && e.status === 404;
test("RFQ state progression preserves the sent request and follow-up signals", async () => {
  const f = await executionFixture();
  const args = {
    dealId: f.deal.id,
    supplierId: "supplier",
    productId: "product",
    requestId: "rfq",
    status: "Draft",
    details: rfq,
  };
  const id = await saveRfq(f.db, md, args);
  assert.equal(await saveRfq(f.db, md, args), id);
  await saveRfq(f.db, md, { ...args, id, version: 1, status: "Prepared" });
  await saveRfq(f.db, md, {
    ...args,
    id,
    version: 2,
    status: "Sent externally",
  });
  await assert.rejects(
    saveRfq(f.db, md, {
      ...args,
      id,
      version: 3,
      status: "Responded",
      details: { ...rfq, quantity: "30" },
    }),
  );
  assert.equal((await executionSignals(f.db, md, [f.lead])).length, 1);
  assert.equal((await executionHistory(f.db, md, "supplier")).rfqs.length, 1);
  assert.equal((await executionHistory(f.db, sales, "product")).rfqs.length, 0);
  await saveRfq(f.db, md, { ...args, id, version: 3, status: "Responded" });
  assert.equal((await executionSignals(f.db, md, [f.lead])).length, 0);
});
test("offer revisions retain immutable V1, reject stale V2, retry returns same identity", async () => {
  const f = await executionFixture();
  const c = {
    dealId: f.deal.id,
    supplierId: "supplier",
    productId: "product",
    requestId: "v2",
    previousId: f.offerId,
    version: 1,
    details: { ...offer, price: "490" },
  };
  const v2 = await recordOffer(f.db, md, c);
  assert.equal(await recordOffer(f.db, md, c), v2);
  await assert.rejects(recordOffer(f.db, md, { ...c, requestId: "racing-v2" }));
  const rows = await f.db.select().from(supplierOffers);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].details.price, "500");
  assert.equal(rows[0].status, "Superseded");
  assert.equal(rows[1].revision, 2);
  assert.throws(() =>
    f.sqlite
      .prepare("UPDATE SupplierOffer SET details=? WHERE id=?")
      .run(JSON.stringify({ ...offer, price: "1" }), f.offerId),
  );
});
test("reviewed scenario and quotation share authoritative identities and sell-only values", async () => {
  const f = await executionFixture();
  const id = await saveScenario(f.db, md, {
    offerId: f.offerId,
    requestId: "scenario",
    details: scenario,
  });
  await scenarioStatus(f.db, md, { id, version: 1, status: "Reviewed" });
  await assert.rejects(
    saveScenario(f.db, md, {
      id,
      version: 2,
      offerId: f.offerId,
      requestId: "edit",
      details: { ...scenario, sellPrice: "100" },
    }),
  );
  await scenarioStatus(f.db, md, { id, version: 2, status: "Selected" });
  const qid = await prepareQuotation(f.db, md, { id, version: 3 });
  assert.equal(await prepareQuotation(f.db, md, { id, version: 3 }), qid);
  const q = (await f.db
    .select()
    .from(businessRecords)
    .where(eq(businessRecords.id, qid))
    .get())!.payload as RecordItem;
  assert.equal(q.status, "Draft");
  assert.equal(q.amount, 13000);
  assert.equal(q.lines![0].unitPriceCents, 65000);
  assert.equal(q.customerId, "customer");
  assert.equal(q.dealId, f.deal.id);
  assert.equal(q.productId, "product");
  assert.equal(q.parentId, "lead");
  assert.ok(!JSON.stringify(q).includes("Private buying strategy"));
  const accept = transition(
    { records: [{ ...q, status: "Sent" }], audit: [] },
    md,
    q.id,
    "Accepted",
  );
  assert.equal(accept.records.find((r) => r.id === q.id)?.status, "Accepted");
  assert.equal(accept.records.find((r) => r.kind === "orders")?.amount, 13000);
});
test("only one scenario selected, historical inputs survive selection changes", async () => {
  const f = await executionFixture();
  const ids = [];
  for (let n = 0; n < 2; n++) {
    const id = await saveScenario(f.db, md, {
      offerId: f.offerId,
      requestId: `scenario-${n}`,
      details: { ...scenario, name: `Option ${n}` },
    });
    await scenarioStatus(f.db, md, { id, version: 1, status: "Reviewed" });
    await scenarioStatus(f.db, md, { id, version: 2, status: "Selected" });
    ids.push(id);
  }
  const rows = await f.db.select().from(commercialScenarios);
  assert.equal(rows.filter((r) => r.status === "Selected").length, 1);
  assert.equal(rows[0].details.name, "Option 0");
  await assert.rejects(prepareQuotation(f.db, md, { id: ids[0], version: 3 }));
});
test("expired and superseded offers cannot supply a selected scenario or quotation", async () => {
  const f = await executionFixture();
  const expired = await recordOffer(f.db, md, {
    dealId: f.deal.id,
    supplierId: "supplier",
    productId: "product",
    requestId: "expired",
    details: { ...offer, validUntil: "2000-01-01" },
  });
  const id = await saveScenario(f.db, md, {
    offerId: expired,
    requestId: "expired-scenario",
    details: scenario,
  });
  await scenarioStatus(f.db, md, { id, version: 1, status: "Reviewed" });
  await assert.rejects(
    scenarioStatus(f.db, md, { id, version: 2, status: "Selected" }),
  );
});
test("buy costs absent from sales Deal aggregate, history, search and AI", async () => {
  const f = await executionFixture();
  const view = await executionView(f.db, sales, f.deal.id);
  assert.deepEqual(view.offers, []);
  assert.deepEqual(view.scenarios, []);
  assert.equal(view.canSeeCosts, false);
  assert.deepEqual((await executionHistory(f.db, sales, "product")).offers, []);
  assert.deepEqual(await searchExecution(f.db, sales, "supplier"), []);
  const ctx = new AiContext("Sales Deal");
  await addExecutionContext(f.db, sales, f.deal.id, ctx);
  assert.ok(!ctx.render().includes("price=500"));
  assert.ok(!ctx.render().includes("Select this supplier"));
});
for (const role of [
  "HR Manager",
  "IT Administrator",
  "Accounts Manager",
  "Sales Executive",
] as const)
  test(`sourcing mutations reject ${role}`, async () => {
    const f = await executionFixture();
    const actor = { ...sales, role, id: "other" };
    await assert.rejects(
      offerStatus(f.db, actor, {
        id: f.offerId,
        version: 1,
        status: "Selected",
      }),
      absent,
    );
    await assert.rejects(
      saveScenario(f.db, actor, {
        offerId: f.offerId,
        requestId: "forbidden",
        details: scenario,
      }),
      absent,
    );
  });
test("other company, branch and made-up ids are not found; blocked child excluded independently", async () => {
  const f = await executionFixture();
  for (const a of [
    { ...md, companies: ["Other"] },
    { ...md, role: "Branch Manager" as const, branches: ["Elsewhere"] },
  ]) {
    await assert.rejects(executionView(f.db, a, f.deal.id), absent);
    await assert.rejects(
      saveScenario(f.db, a, {
        offerId: f.offerId,
        requestId: "x",
        details: scenario,
      }),
      absent,
    );
  }
  await assert.rejects(executionView(f.db, md, "made-up"), absent);
  const restricted = { ...md, moduleAccess: { suppliers: "none" as const } };
  const v = await executionView(f.db, restricted, f.deal.id);
  assert.deepEqual(v.offers, []);
  assert.deepEqual(v.candidates, []);
});
test("prompt injection stays untrusted, commercial math comes only from code", async () => {
  const f = await executionFixture();
  await saveScenario(f.db, md, {
    offerId: f.offerId,
    requestId: "ai-scenario",
    details: scenario,
  });
  const ctx = new AiContext("Commercial explanation");
  await addExecutionContext(f.db, md, f.deal.id, ctx);
  assert.ok(ctx.flagged > 0);
  assert.ok(ctx.render().includes("UNTRUSTED"));
  assert.ok(ctx.figures().some((x) => x.value === "11000.00 USD"));
  assert.equal(ctx.suggestionTargets.size, 0);
});
test("FK integrity and rollback preserve history on invalid relationship writes", async () => {
  const f = await executionFixture();
  assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(
    Object.values(f.sqlite.prepare("PRAGMA integrity_check").get()!)[0],
    "ok",
  );
  assert.throws(() =>
    f.sqlite.prepare("DELETE FROM SupplierOffer WHERE id=?").run(f.offerId),
  );
  assert.throws(() =>
    f.sqlite
      .prepare("UPDATE SupplierOffer SET supplierId='missing' WHERE id=?")
      .run(f.offerId),
  );
  assert.equal((await executionView(f.db, md, f.deal.id)).offers.length, 1);
});
test("RFQ, Offer and Scenario guessed IDs are denied across the full restricted-role matrix", async () => {
  const f = await executionFixture();
  const rfqId = await saveRfq(f.db, md, {
    dealId: f.deal.id,
    supplierId: "supplier",
    productId: "product",
    requestId: "idor-rfq",
    status: "Draft",
    details: rfq,
  });
  const scenarioId = await saveScenario(f.db, md, {
    offerId: f.offerId,
    requestId: "idor-scenario",
    details: scenario,
  });
  const actors = [
    { ...sales, id: "other" },
    { ...md, companies: ["Other"] },
    { ...md, role: "Branch Manager" as const, branches: ["Other"] },
    ...(["HR Manager", "IT Administrator", "Accounts Manager"] as const).map(
      (role) => ({ ...md, role }),
    ),
  ];
  for (const actor of actors) {
    await assert.rejects(
      saveRfq(f.db, actor, {
        id: rfqId,
        version: 1,
        dealId: f.deal.id,
        supplierId: "supplier",
        productId: "product",
        requestId: "guess",
        status: "Prepared",
        details: rfq,
      }),
      absent,
    );
    await assert.rejects(
      offerStatus(f.db, actor, {
        id: f.offerId,
        version: 1,
        status: "Selected",
      }),
      absent,
    );
    await assert.rejects(
      scenarioStatus(f.db, actor, {
        id: scenarioId,
        version: 1,
        status: "Reviewed",
      }),
      absent,
    );
  }
});
