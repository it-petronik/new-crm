/** Runs only against the separately seeded review Worker on port 8789. */
import assert from "node:assert/strict";
const origin = "http://localhost:8788";
const base = "http://127.0.0.1:8789";
type Result = { status: number; body: any };
async function request(
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Result> {
  const res = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function login(key: string) {
  const res = await fetch(base + "/api/auth", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `${key}@collab.test`,
      password: "Collab-Test-Password-1",
    }),
  });
  assert.equal(res.status, 200, `Fictional ${key} login`);
  return res.headers.get("set-cookie")!.split(";")[0];
}
async function main() {
  const accounts = await login("release9"),
    md = await login("cmmd"),
    sales = await login("cmsales");
  const stamp = crypto.randomUUID();
  const date = "2026-10-19";
  const customerInput = {
    kind: "customers",
    company: "Petronik",
    branch: "Main",
    title: "Fictional proforma API customer",
    contact: "Test Buyer",
    product: "",
    quantity: 0,
    unit: "MT",
    amount: 0,
    currency: "USD",
    due: date,
    detail: "Fictional test only",
    source: "Local review",
    requestId: `customer-${stamp}`,
  };
  const customer = await request(md, "POST", "/api/records", customerInput);
  assert.equal(customer.status, 201, JSON.stringify(customer.body));
  const values = {
    ...customerInput,
    kind: "accounts",
    customerId: customer.body.record.id,
    amount: 0.01,
    lines: [
      {
        description: "Fictional SN500",
        quantity: 80,
        unitPriceCents: 161000,
        packaging: "Flexi bags",
      },
    ],
    requestId: `proforma-${stamp}`,
    attributes: {
      documentType: "proforma",
      issuedDate: date,
      quoteReference: "CLIENT-CANNOT-CHOOSE-REFERENCE",
    },
  };
  assert.equal(
    (await request(md, "POST", "/api/records", values)).status,
    403,
    "MD cannot create a customer proforma",
  );
  assert.equal(
    (await request(sales, "POST", "/api/records", values)).status,
    403,
    "Sales cannot create a customer proforma",
  );
  assert.equal(
    (
      await request(accounts, "POST", "/api/records", {
        ...values,
        company: "Afrilube",
      })
    ).status,
    403,
    "Company boundary enforced",
  );
  const created = await Promise.all([
    request(accounts, "POST", "/api/records", values),
    request(accounts, "POST", "/api/records", values),
  ]);
  for (const result of created)
    assert.ok([200, 201].includes(result.status), JSON.stringify(result.body));
  const record = created[0].body.record;
  assert.equal(
    created[1].body.record.id,
    record.id,
    "Concurrent retry creates one document",
  );
  assert.equal(
    record.amount,
    128800,
    "Server calculates totals from line items",
  );
  assert.match(record.attributes.quoteReference, /^PI-2026-10-/);
  assert.notEqual(
    record.attributes.quoteReference,
    values.attributes.quoteReference,
  );
  const issue = await request(accounts, "PATCH", "/api/records", {
    action: "status",
    id: record.id,
    status: "Issued",
  });
  assert.equal(issue.status, 200, JSON.stringify(issue.body));
  const loaded = await request(accounts, "GET", `/api/records?id=${record.id}`);
  assert.equal(
    loaded.body.record.attributes.issuedById,
    "collab-user-release9",
  );
  assert.equal(loaded.body.record.status, "Issued");
  assert.equal(
    (
      await request(accounts, "PATCH", "/api/records", {
        action: "payment",
        id: record.id,
        amountCents: 100,
        reference: "DO-NOT-RECORD",
      })
    ).status,
    400,
    "Proforma cannot receive payment",
  );
  assert.equal(
    (
      await request(accounts, "PATCH", "/api/records", {
        action: "status",
        id: record.id,
        status: "Draft",
      })
    ).status,
    400,
    "Issued document cannot be reopened",
  );
  assert.equal(
    (
      await request(accounts, "PATCH", "/api/records", {
        action: "edit",
        id: record.id,
        expectedUpdatedAt: loaded.body.record.updatedAt,
        values,
      })
    ).status,
    400,
    "Issued document cannot be edited",
  );
  const records = (await request(accounts, "GET", "/api/records")).body.records;
  assert.equal(records.filter((r: any) => r.id === record.id).length, 1);
  assert.equal(
    records.filter((r: any) => r.parentId === record.id).length,
    0,
    "No order, shipment or ledger child created",
  );
  console.log(
    "PASS: local D1 proforma creation, company/role boundaries, concurrent idempotency, server totals, unique reference, issue audit, immutable issued document and payment rejection.",
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
