/** Local-only acceptance checks against the fictional review Worker on 8789. */
import assert from "node:assert/strict";
const base = "http://127.0.0.1:8789";
async function call(
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
  origin = "http://localhost:8788",
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function login(who: string) {
  const response = await fetch(base + "/api/auth", {
    method: "POST",
    headers: {
      Origin: "http://localhost:8788",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: `${who}@collab.test`,
      password: "Collab-Test-Password-1",
    }),
  });
  assert.equal(response.status, 200, `Fictional ${who} login`);
  return response.headers.get("set-cookie")!.split(";")[0];
}
async function main() {
  const accounts = await login("release9"),
    sales = await login("cmsales"),
    readonly = await login("bankreadonly"),
    other = await login("aiacc");
  const input = {
    id: crypto.randomUUID(),
    company: "Petronik",
    label: "Fictional Bank Review",
    currency: "USD",
    details: {
      bankName: "Fictional Bank",
      bankAccountName: "Fictional Holder",
      bankAccountNumber: "TEST-ONLY-1234",
      bankIban: "",
      bankSwift: "",
      bankBranch: "",
    },
  };
  const path = "/api/bank-accounts";
  assert.equal((await call("", "GET", `${path}?company=Petronik`)).status, 401);
  assert.equal(
    (await call(sales, "GET", `${path}?company=Petronik`)).status,
    403,
  );
  assert.equal((await call(sales, "POST", path, input)).status, 403);
  assert.equal(
    (await call(accounts, "POST", path, input, "https://wrong.invalid")).status,
    403,
  );
  assert.equal(
    (await call(accounts, "POST", path, { ...input, company: "Afrilube" }))
      .status,
    403,
  );
  assert.equal((await call(readonly, "POST", path, input)).status, 403);
  assert.equal(
    (
      await call(accounts, "POST", path, {
        ...input,
        details: { ...input.details, bankName: "" },
      })
    ).status,
    400,
  );
  const created = await call(accounts, "POST", path, input);
  assert.equal(created.status, 201);
  assert.equal(created.body.account.version, 1);
  assert.equal(
    (await call(accounts, "POST", path, input)).status,
    200,
    "same request is idempotent",
  );
  assert.equal(
    (await call(readonly, "GET", `${path}?company=Petronik`)).status,
    200,
  );
  assert.equal(
    (await call(other, "GET", `${path}?company=Petronik`)).status,
    403,
  );
  assert.equal(
    (
      await call(other, "PATCH", path, {
        ...input,
        company: "Istanegry",
        version: 1,
      })
    ).status,
    409,
    "a different company's identifier grants no access",
  );
  const changed = {
    ...input,
    version: 1,
    details: { ...input.details, bankAccountNumber: "TEST-ONLY-5678" },
  };
  assert.equal((await call(readonly, "PATCH", path, changed)).status, 403);
  const edits = await Promise.all([
    call(accounts, "PATCH", path, changed),
    call(accounts, "PATCH", path, {
      ...changed,
      label: "Concurrent Fictional Edit",
    }),
  ]);
  assert.deepEqual(edits.map((e) => e.status).sort(), [200, 409]);
  assert.equal(
    (await call(accounts, "PATCH", path, changed)).status,
    409,
    "stale update is refused",
  );
  const listed = await call(accounts, "GET", `${path}?company=Petronik`);
  const matches = listed.body.accounts.filter(
    (a: { id: string }) => a.id === input.id,
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].version, 2);
  assert.equal(matches[0].details.bankAccountNumber, "TEST-ONLY-5678");
  console.log(
    "Saved-bank local API checks passed: authentication, finance/company/read-only boundaries, origin, validation, retry and concurrent editing.",
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
