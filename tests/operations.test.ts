import test from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { d1, migratedDatabase } from "./support/sqlite-d1";
import type { Database } from "../src/lib/d1";
import type { Actor, RecordItem } from "../src/lib/domain";
import * as schema from "../src/lib/schema";
import {
  operationsCommand as act,
  operationsView,
  operationsFailure,
} from "../src/lib/operations/store";
import {
  extendedCents,
  fixedNumber,
  operationsAccess,
} from "../src/lib/operations/model";
import { purchases } from "../src/lib/operations/tables";
import { hasCommercialHistory } from "../src/lib/commercial/store";
const md: Actor = {
  id: "buyer",
  name: "Buyer",
  role: "MD",
  companies: ["Petronik"],
  branches: [],
};
const approver: Actor = { ...md, id: "approver", name: "Approver" };
const stock: Actor = {
  ...md,
  id: "logistics",
  name: "Logistics",
  role: "Logistics Manager",
};
const accounts: Actor = {
  ...md,
  id: "accounts",
  name: "Accounts",
  role: "Accountant",
};
const seller: Actor = {
  ...md,
  id: "seller",
  name: "Seller",
  role: "Sales Executive",
};
function setup() {
  const sqlite = migratedDatabase(),
    db = drizzle(d1(sqlite) as never, { schema }) as Database;
  for (const a of [md, approver, stock, accounts, seller])
    sqlite
      .prepare(
        "INSERT INTO User(id,email,name,passwordHash,role,companies,branches,active,createdAt) VALUES(?,?,?,?,?,?,?,1,1)",
      )
      .run(
        a.id,
        `${a.id}@test.invalid`,
        a.name,
        "fictional",
        a.role,
        JSON.stringify(a.companies),
        JSON.stringify(a.branches),
      );
  const insert = (
    id: string,
    kind: RecordItem["kind"],
    extra: Partial<RecordItem> = {},
  ) => {
    const r = {
      id,
      kind,
      title: id,
      company: "Petronik",
      branch: "Main",
      ownerId: md.id,
      owner: md.name,
      status: "Active",
      unit: "MT",
      quantity: 10,
      ...extra,
    };
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
    return r;
  };
  insert("product", "products");
  insert("supplier", "suppliers");
  insert("order", "orders", { status: "Confirmed", productId: "product" });
  insert("shipment", "logistics", {
    parentId: "order",
    status: "Pending Planning",
  });
  return { sqlite, db, insert };
}
const create = (requestId = crypto.randomUUID(), values = {}) => ({
  action: "purchase",
  requestId,
  values: {
    orderId: "order",
    supplierId: "supplier",
    productId: "product",
    warehouse: "Dubai",
    quantity: "10",
    price: "100.25",
    currency: "USD",
    unit: "MT",
    expectedDate: "2026-11-01",
    notes: "",
    ...values,
  },
});
async function approved(db: Database) {
  const p = await act(db, md, create());
  await act(db, approver, {
    action: "status",
    id: p.id,
    version: 1,
    status: "Approved",
  });
  return p.id;
}
const move = (id: string, kind = "Receipt", quantity = "4", extra = {}) => ({
  action: "movement",
  requestId: crypto.randomUUID(),
  purchaseId: id,
  kind,
  quantity,
  reference: "Delivery reference",
  date: "2026-11-02",
  ...extra,
});
const invoice = (
  id: string,
  amount = "400",
  reference = crypto.randomUUID(),
) => ({
  action: "invoice",
  requestId: crypto.randomUUID(),
  purchaseId: id,
  reference,
  amount,
  date: "2026-11-02",
  dueDate: "2026-11-30",
});
const payment = (id: string, amount = "200") => ({
  action: "payment",
  requestId: crypto.randomUUID(),
  invoiceId: id,
  amount,
  reference: "Bank transaction",
  date: "2026-11-03",
});
const reject = async (p: Promise<unknown>, pattern: RegExp) =>
  assert.rejects(p, (e) => pattern.test(operationsFailure(e).message));
test("operations prevents deletion or scope changes of linked CRM records", async () => {
  const { db, sqlite } = setup();
  await approved(db);
  assert.equal(await hasCommercialHistory(db, "supplier"), true);
  assert.throws(
    () =>
      sqlite.exec(
        "UPDATE BusinessRecord SET payload=json_set(payload,'$.deletedAt','2026-11-01') WHERE id='supplier'",
      ),
    /operations_history/,
  );
  assert.throws(
    () =>
      sqlite.exec(
        "UPDATE BusinessRecord SET company='Afrilube' WHERE id='supplier'",
      ),
    /operations_history/,
  );
});

test("reused request IDs cannot silently apply changed financial or quantity details", async () => {
  const { db } = setup();
  const input = create();
  await act(db, md, input);
  await reject(
    act(db, md, { ...input, values: { ...input.values, price: "101" } }),
    /different details/,
  );
  const p = await approved(db),
    receipt = move(p, "Receipt", "4");
  await act(db, stock, receipt);
  await reject(
    act(db, stock, { ...receipt, quantity: "5" }),
    /different details/,
  );
  const inv = invoice(p),
    i = await act(db, accounts, inv);
  await reject(
    act(db, accounts, { ...inv, amount: "401" }),
    /different details/,
  );
  const pay = payment(i.id);
  await act(db, accounts, pay);
  await reject(
    act(db, accounts, { ...pay, amount: "201" }),
    /different details/,
  );
});

test("operations fixed-point values and half-cent extension stay exact", () => {
  assert.equal(fixedNumber("0.000001", 6, 1e12), 1);
  assert.equal(extendedCents(1000005, 100000), 100001);
  assert.throws(() => fixedNumber("1.001", 2, 1e9));
  assert.throws(() => fixedNumber("0", 6, 1e12));
});
test("purchases need independent approval and have atomic stale-edit guards", async () => {
  const { db, sqlite } = setup();
  const input = create(),
    p = await act(db, md, input);
  assert.equal((await act(db, md, input)).duplicate, true);
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM PurchaseOrder").get()!.n,
    1,
  );
  await reject(
    act(db, md, { action: "status", id: p.id, version: 1, status: "Approved" }),
    /different authorized/,
  );
  const results = await Promise.allSettled([
    act(db, approver, {
      action: "status",
      id: p.id,
      version: 1,
      status: "Approved",
    }),
    act(db, approver, {
      action: "status",
      id: p.id,
      version: 1,
      status: "Approved",
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    sqlite
      .prepare("SELECT count(*) n FROM AuditEvent WHERE subject='operations'")
      .get()!.n,
    2,
  );
  await reject(act(db, md, move(p.id, "Receipt", "11")), /Receipt exceeds/);
});
test("scope, role, module access and authoritative links are checked independently", async () => {
  const { db, insert } = setup();
  const p = await approved(db);
  await reject(operationsView(db, seller), /cannot perform/);
  await reject(
    act(db, { ...md, companies: ["Afrilube"] }, move(p)),
    /available/,
  );
  await reject(act(db, { ...md, branches: ["Other"] }, move(p)), /available/);
  await reject(
    act(db, { ...md, moduleAccess: { orders: "read" } }, create()),
    /cannot perform/,
  );
  insert("other", "suppliers", { company: "Afrilube" });
  await reject(
    act(db, md, create(crypto.randomUUID(), { supplierId: "other" })),
    /available/,
  );
  await reject(
    act(db, md, create(crypto.randomUUID(), { unit: "KG" })),
    /unit must match/,
  );
  const safe = await operationsView(db, stock);
  assert.equal(safe.access.costs, false);
  assert.equal("priceCents" in safe.purchases[0], false);
  assert.equal("totalCents" in safe.purchases[0], false);
  assert.deepEqual(safe.invoices, []);
  assert.equal(safe.purchases[0].names.supplierId, "Restricted record");
});
test("partial receipts and concurrent receipt limits never overfill a purchase", async () => {
  const { db, sqlite } = setup(),
    p = await approved(db);
  const request = move(p, "Receipt", "6");
  await act(db, stock, request);
  assert.equal((await act(db, stock, request)).duplicate, true);
  const results = await Promise.allSettled([
    act(db, stock, move(p, "Receipt", "4")),
    act(db, stock, move(p, "Receipt", "4")),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const v = await operationsView(db, stock);
  assert.equal(v.purchases[0].received, 10e6);
  assert.equal(v.purchases[0].balance, 10e6);
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM StockMovement").get()!.n,
    2,
  );
});
test("stock dispatch needs the matching shipment and cannot go negative", async () => {
  const { db, insert } = setup(),
    p = await approved(db);
  await act(db, stock, move(p, "Receipt", "4"));
  await reject(act(db, stock, move(p, "Dispatch", "1")), /Choose a shipment/);
  insert("unrelated", "orders", { status: "Confirmed" });
  insert("wrong-shipment", "logistics", { parentId: "unrelated" });
  await reject(
    act(db, stock, move(p, "Dispatch", "1", { shipmentId: "wrong-shipment" })),
    /active shipment/,
  );
  const results = await Promise.allSettled([
    act(db, stock, move(p, "Dispatch", "3", { shipmentId: "shipment" })),
    act(db, stock, move(p, "Dispatch", "3", { shipmentId: "shipment" })),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await operationsView(db, stock)).purchases[0].balance, 1e6);
});
test("stock corrections preserve original entries and cannot erase consumed stock", async () => {
  const { db, sqlite } = setup(),
    p = await approved(db);
  const receipt = await act(db, stock, move(p, "Receipt", "4")),
    dispatch = await act(
      db,
      stock,
      move(p, "Dispatch", "2", { shipmentId: "shipment" }),
    );
  const reverse = (id: string) => ({
    action: "reverse",
    requestId: crypto.randomUUID(),
    movementId: id,
    date: "2026-11-04",
    reference: "Correction",
  });
  await reject(act(db, stock, reverse(receipt.id)), /Not enough stock/);
  await act(db, stock, reverse(dispatch.id));
  await act(db, stock, reverse(receipt.id));
  assert.equal((await operationsView(db, stock)).purchases[0].balance, 0);
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM StockMovement").get()!.n,
    4,
  );
  await assert.rejects(act(db, stock, reverse(receipt.id)));
  assert.throws(
    () => sqlite.exec("DELETE FROM StockMovement"),
    /operations_history/,
  );
});
test("supplier invoices are scoped, unique and capped by purchase value", async () => {
  const { db, sqlite } = setup(),
    p = await approved(db);
  await reject(act(db, stock, invoice(p)), /cannot perform/);
  const request = invoice(p, "400", " INV-123 ");
  await act(db, accounts, request);
  assert.equal((await act(db, accounts, request)).duplicate, true);
  await assert.rejects(act(db, accounts, invoice(p, "1", "inv-123")));
  const results = await Promise.allSettled([
    act(db, accounts, invoice(p, "600")),
    act(db, accounts, invoice(p, "600")),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    sqlite.prepare("SELECT sum(amountCents) n FROM SupplierInvoice").get()!.n,
    100000,
  );
  assert.throws(
    () => sqlite.exec("UPDATE SupplierInvoice SET amountCents=1"),
    /operations_immutable/,
  );
});
test("partial and concurrent supplier payments never exceed the outstanding balance", async () => {
  const { db, sqlite } = setup(),
    p = await approved(db),
    i = await act(db, accounts, invoice(p));
  const request = payment(i.id, "200");
  await act(db, accounts, request);
  assert.equal((await act(db, accounts, request)).duplicate, true);
  const results = await Promise.allSettled([
    act(db, accounts, payment(i.id, "200")),
    act(db, accounts, payment(i.id, "200")),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const v = await operationsView(db, accounts);
  assert.equal(v.invoices[0].paidCents, 40000);
  await reject(act(db, accounts, payment(i.id, "0.01")), /remaining invoice/);
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM SupplierPayment").get()!.n,
    2,
  );
});
test("purchase closure retains ledger; cancelling purchases with history is refused", async () => {
  const { db, sqlite } = setup(),
    p = await approved(db);
  await act(db, stock, move(p));
  await reject(
    act(db, md, { action: "status", id: p, version: 2, status: "Cancelled" }),
    /ledger history/,
  );
  await act(db, md, { action: "status", id: p, version: 2, status: "Closed" });
  await reject(act(db, stock, move(p)), /Approve the purchase/);
  await act(db, accounts, invoice(p, "50"));
  assert.equal(
    (await db.select().from(purchases).where(eq(purchases.id, p)).get())
      ?.status,
    "Closed",
  );
  assert.throws(
    () => sqlite.exec("DELETE FROM PurchaseOrder"),
    /operations_history/,
  );
});
