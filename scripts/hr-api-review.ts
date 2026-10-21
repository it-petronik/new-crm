import assert from "node:assert/strict";
const base = "http://localhost:8789";
let checks = 0;
async function login(i: number) {
  const r = await fetch(`${base}/api/auth`, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `hr${i}@example.test`,
      password: "Hr-Local-Test-Only-2026",
    }),
  });
  assert.equal(r.status, 200, await r.text());
  return r.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; ");
}
async function get(cookie: string, path = "/api/hr") {
  const r = await fetch(base + path, { headers: { Cookie: cookie } });
  return { r, data: (await r.json()) as any };
}
async function post(cookie: string, body: unknown, status = 200) {
  const r = await fetch(base + "/api/hr", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: base,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const d = (await r.json()) as any;
  assert.equal(r.status, status, JSON.stringify(d));
  checks++;
  return d.entry;
}
async function main() {
  const [md, hr, it, assistant, accountant, sales] = await Promise.all(
    [0, 10, 14, 1, 9, 5].map(login),
  );
  const unauth = await fetch(base + "/api/hr");
  assert.equal(unauth.status, 401);
  checks++;
  assert.equal((await get(sales)).r.status, 403);
  checks++;
  const save = (cookie: string, values: unknown, status = 200) =>
    post(
      cookie,
      { action: "save", requestId: crypto.randomUUID(), values },
      status,
    );
  const change = (cookie: string, e: any, action: string, extra = {}) =>
    post(cookie, {
      action,
      id: e.id,
      version: e.version,
      reason: "Fictional reviewer checked",
      ...extra,
    });
  const employeeId = "hr-employee-1";
  await save(
    sales,
    {
      kind: "attendance",
      employeeId,
      payload: { date: "2026-01-02", status: "Present", reason: "HR entry" },
    },
    403,
  );
  const d = await save(hr, {
    kind: "document",
    employeeId,
    company: "Petronik",
    branch: "Main",
    payload: {
      title: "Fictional private employee PDF",
      category: "Passport",
      expiryDate: "2026-11-01",
    },
  });
  const companyDoc = await save(assistant, {
    kind: "document",
    employeeId: null,
    company: "Petronik",
    branch: "Main",
    payload: { title: "Fictional trade licence", category: "Trade licence" },
  });
  for (const who of [it, accountant]) {
    const v = (await get(who)).data;
    assert.ok(!v.entries.some((e: any) => e.id === d.id));
    assert.ok(!v.history.some((e: any) => e.entryId === d.id));
    checks++;
  }
  const upload = async (
    cookie: string,
    id: string,
    bytes: Uint8Array,
    name = "review.pdf",
    expected = 200,
  ) => {
    const f = new FormData();
    f.append(
      "file",
      new Blob([new Uint8Array(bytes).buffer], { type: "application/pdf" }),
      name,
    );
    const r = await fetch(`${base}/api/hr/files?entry=${id}`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: base },
      body: f,
    });
    const data = (await r.json()) as any;
    assert.equal(r.status, expected, JSON.stringify(data));
    checks++;
    return data.file;
  };
  const pdf = new TextEncoder().encode(
      "%PDF-1.4\n% Fictional test only\n%%EOF\n",
    ),
    f = await upload(hr, d.id, pdf);
  assert.ok(f.id);
  assert.ok(!JSON.stringify(f).includes("storageKey"));
  await upload(assistant, d.id, pdf, "assistant-review.pdf");
  await upload(it, d.id, pdf, "review.pdf", 404);
  await upload(
    hr,
    d.id,
    new TextEncoder().encode("<script>bad</script>"),
    "bad.pdf",
    400,
  );
  await upload(hr, d.id, new Uint8Array(10485761), "oversized.pdf", 400);
  const f2 = await upload(hr, d.id, pdf, "second.pdf");
  assert.notEqual(f.id, f2.id);
  const down = await fetch(`${base}/api/hr/files/${f.id}`, {
    headers: { Cookie: md },
  });
  assert.equal(down.status, 200);
  assert.match(down.headers.get("Content-Disposition")!, /^attachment/);
  assert.match(down.headers.get("Cache-Control")!, /no-store/);
  assert.match(down.headers.get("Content-Security-Policy")!, /sandbox/);
  assert.deepEqual(new Uint8Array(await down.arrayBuffer()), pdf);
  checks++;
  for (const who of [it, accountant, sales]) {
    assert.equal(
      (
        await fetch(`${base}/api/hr/files/${f.id}`, {
          headers: { Cookie: who },
        })
      ).status,
      404,
    );
    checks++;
  }
  assert.equal((await fetch(`${base}/api/hr/files/${f.id}`)).status, 401);
  checks++;
  const fileView = (await get(hr)).data;
  assert.equal(fileView.files.filter((a: any) => a.entryId === d.id).length, 3);
  checks++;
  let salary = await save(hr, {
    kind: "compensation",
    employeeId,
    payload: {
      change: "Starting salary",
      effectiveDate: "2026-01-01",
      basicCents: 500000,
      allowanceCents: 50000,
      currency: "AED",
      reason: "Fictional agreement",
    },
  });
  salary = await change(hr, salary, "submit");
  await post(
    hr,
    { action: "approve", id: salary.id, version: salary.version },
    403,
  );
  salary = await change(md, salary, "approve");
  let pay = await save(hr, {
    kind: "payroll",
    employeeId,
    payload: {
      period: "2026-01",
      deductionCents: 1000,
      adjustmentCents: 10000,
      note: "Fictional partial month reviewed",
      reviewed: true,
    },
  });
  assert.equal(pay.payload.netCents, 559000);
  pay = await change(hr, pay, "submit");
  assert.equal((await get(accountant)).data.entries.length, 0);
  pay = await change(md, pay, "approve");
  const accountView = (await get(accountant)).data;
  assert.equal(accountView.entries.length, 1);
  assert.equal(accountView.entries[0].kind, "payroll");
  checks++;
  await change(accountant, pay, "paid", {
    reference: "FICTIONAL-BANK-REFERENCE",
  });
  await save(
    hr,
    {
      kind: "document",
      employeeId: "hr-employee-2",
      company: "Afrilube",
      branch: "Main",
      payload: { title: "Other company", category: "Passport" },
    },
    404,
  );
  const csrf = await fetch(base + "/api/hr", {
    method: "POST",
    headers: {
      Cookie: hr,
      Origin: "https://other.invalid",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(csrf.status, 403);
  checks++;
  const attendanceCommand = (requestId: string) => ({
    action: "save",
    requestId,
    values: {
      kind: "attendance",
      employeeId,
      payload: {
        date: "2026-01-02",
        status: "Present",
        reason: "Concurrent local regression",
      },
    },
  });
  const duplicate = await Promise.all(
    [crypto.randomUUID(), crypto.randomUUID()].map((requestId) =>
      fetch(base + "/api/hr", {
        method: "POST",
        headers: {
          Cookie: hr,
          Origin: base,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(attendanceCommand(requestId)),
      }),
    ),
  );
  assert.deepEqual(duplicate.map((r) => r.status).sort(), [200, 409]);
  checks++;
  const attendanceView = (await get(hr)).data;
  assert.equal(
    attendanceView.entries.filter(
      (e: any) =>
        e.kind === "attendance" &&
        e.employeeId === employeeId &&
        e.payload.date === "2026-01-02",
    ).length,
    1,
  );
  checks++;
  const archive = await change(hr, d, "archive");
  assert.equal(archive.status, "Archived");
  await upload(hr, d.id, pdf, "review.pdf", 403);
  assert.equal(
    (await fetch(`${base}/api/hr/files/${f.id}`, { headers: { Cookie: hr } }))
      .status,
    200,
  );
  checks++;
  assert.ok(
    (await get(assistant)).data.entries.some(
      (e: any) => e.id === companyDoc.id,
    ),
  );
  checks++;
  console.log(
    `${checks} authenticated HR API and local protected-file checks passed. Production unchanged.`,
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
