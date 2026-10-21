/** Local-only acceptance. All writes target the isolated fictional test
 * database/Worker on 8789, never production or the saved workspace on 8788. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { chromium } from "@playwright/test";
import { makePreview } from "../src/lib/fixtures";
import { initializeLead, businessToday } from "../src/lib/lead-desk";
import type { RecordItem } from "../src/lib/domain";

async function main() {
  const base = "http://127.0.0.1:8789",
    origin = "http://localhost:8788";
  const state = realpathSync(".wrangler/proforma-review.ykckwl");
  assert.equal(state, resolve(".wrangler/proforma-review.ykckwl"));
  const q = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;
  const stamp = crypto.randomUUID().slice(0, 8),
    now = new Date().toISOString();
  const salesId = `lead-review-sales-${stamp}`,
    marketingId = `lead-review-marketing-${stamp}`,
    readonlyId = `lead-review-readonly-${stamp}`,
    otherId = `lead-review-other-${stamp}`,
    itId = `lead-review-it-${stamp}`,
    assistantId = `lead-review-assistant-${stamp}`;
  const statements: string[] = [];
  for (const [id, role, company, access] of [
    [salesId, "Sales Executive", "Petronik", {}],
    [marketingId, "Marketing Manager", "Petronik", {}],
    [readonlyId, "Sales Manager", "Petronik", { leads: "read" }],
    [otherId, "Sales Executive", "Afrilube", {}],
    [itId, "IT Administrator", "Petronik", {}],
    [assistantId, "MD Assistant", "Petronik", {}],
  ] as const)
    statements.push(
      `INSERT INTO User(id,email,name,passwordHash,role,companies,branches,moduleAccess,active,createdAt) SELECT ${q(id)},${q(`${id}@collab.test`)},${q(`Fictional ${role} ${stamp}`)},passwordHash,${q(role)},${q(JSON.stringify([company]))},'["Main"]',${q(JSON.stringify(access))},1,${Date.now()} FROM User WHERE id='collab-user-cmmd';`,
    );
  const creator = {
    id: marketingId,
    name: "Fictional Marketing",
    role: "Marketing Manager",
  };
  const template = makePreview().records.find((r) => r.kind === "leads")!;
  const fixtureIds = new Set<string>();
  for (let i = 0; i < 1005; i++) {
    const r = initializeLead(
      {
        ...template,
        id: `lead-desk-${stamp}-${String(i).padStart(4, "0")}`,
        title: `Fictional bulk inquiry ${stamp} ${i}`,
        ownerId: salesId,
        owner: "Fictional Sales",
        company: "Petronik",
        branch: "Main",
        status: "New",
        createdAt: now,
        updatedAt: now,
        due: businessToday(),
        attributes: { leadType: "Buyer inquiry", grade: "SN500" },
      },
      creator,
    );
    r.attributes = { ...r.attributes, leadOwnerRole: "Sales Executive" };
    fixtureIds.add(r.id);
    statements.push(
      `INSERT INTO BusinessRecord(id,kind,company,branch,ownerId,status,payload,version,createdAt,updatedAt) VALUES (${q(r.id)},'leads','Petronik','Main',${q(salesId)},'New',${q(JSON.stringify(r))},1,${Date.parse(now)},${Date.parse(now)});`,
    );
  }
  const fixture = join(
    mkdtempSync(join(tmpdir(), "enercore-lead-qa-")),
    "fixture.sql",
  );
  writeFileSync(fixture, statements.join("\n"), { mode: 0o600 });
  execFileSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "enercore-crm",
      "--local",
      "--config",
      join(state, "wrangler.test.json"),
      "--persist-to",
      join(state, "state"),
      "--file",
      fixture,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );

  async function call(
    cookie: string,
    method: string,
    path: string,
    body?: unknown,
    requestOrigin = origin,
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Cookie: cookie,
        Origin: requestOrigin,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: (await response.json()) as any };
  }
  async function login(id: string) {
    const response = await fetch(base + "/api/auth", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${id}@collab.test`,
        password: "Collab-Test-Password-1",
      }),
    });
    assert.equal(response.status, 200, `Fictional ${id} sign-in`);
    return response.headers.get("set-cookie")!.split(";")[0];
  }
  const sales = await login(salesId),
    marketing = await login(marketingId),
    readonly = await login(readonlyId),
    other = await login(otherId),
    hr = await login("release10"),
    it = await login(itId),
    assistant = await login(assistantId);
  assert.equal((await call("", "GET", "/api/lead-desk")).status, 401);
  assert.equal((await call(hr, "GET", "/api/lead-desk")).status, 403);
  const seen = new Set<string>();
  let next: string | null = "",
    asOf = "",
    pages = 0;
  do {
    const query = new URLSearchParams({ after: next || "" });
    if (asOf) query.set("asOf", asOf);
    const result = await call(sales, "GET", `/api/lead-desk?${query}`);
    assert.equal(result.status, 200);
    asOf = result.body.asOf;
    next = result.body.next;
    pages++;
    for (const r of result.body.records as RecordItem[]) {
      assert.equal(r.company, "Petronik");
      assert.equal(r.ownerId, salesId);
      assert.ok(!seen.has(r.id));
      seen.add(r.id);
    }
  } while (next);
  assert.ok(pages >= 3);
  for (const id of fixtureIds) assert.ok(seen.has(id), `No truncation: ${id}`);
  assert.equal(
    (await call(other, "GET", "/api/lead-desk")).body.records.some(
      (r: RecordItem) => fixtureIds.has(r.id),
    ),
    false,
  );

  const input = {
    kind: "leads",
    company: "Petronik",
    branch: "Main",
    title: `Fictional handoff ${stamp}`,
    contact: "Fictional Buyer",
    product: "Base Oil",
    quantity: 80,
    unit: "MT",
    amount: 0,
    currency: "USD",
    due: businessToday(),
    detail: "Local acceptance only",
    source: "Marketing",
    attributes: { leadType: "Buyer inquiry", grade: "SN500" },
    email: "buyer@example.invalid",
    destination: "Test port",
  };
  const created = await call(marketing, "POST", "/api/records", input);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  let r: RecordItem = created.body.record;
  assert.equal(r.attributes?.leadCapturedById, marketingId);
  assert.equal(r.attributes?.leadReceivedAt, undefined);
  const assignees = await call(
    marketing,
    "GET",
    `/api/records/assignees?id=${r.id}`,
  );
  assert.equal(assignees.status, 200);
  assert.ok(
    assignees.body.people.some((p: { id: string }) => p.id === salesId),
  );
  assert.ok(
    !assignees.body.people.some((p: { id: string }) =>
      [marketingId, readonlyId, otherId].includes(p.id),
    ),
  );
  assert.notEqual(
    (
      await call(marketing, "PATCH", "/api/records", {
        action: "assign",
        id: r.id,
        assigneeId: readonlyId,
      })
    ).status,
    200,
  );
  const assignment = await call(marketing, "PATCH", "/api/records", {
    action: "assign",
    id: r.id,
    assigneeId: salesId,
  });
  assert.equal(assignment.status, 200);
  r = assignment.body.record;
  assert.equal(r.attributes?.leadOwnerRole, "Sales Executive");
  const directlyAssigned = await call(marketing, "POST", "/api/records", {
    ...input,
    title: `Directly assigned ${stamp}`,
    assigneeId: salesId,
  });
  assert.equal(
    directlyAssigned.status,
    201,
    JSON.stringify(directlyAssigned.body),
  );
  assert.equal(directlyAssigned.body.record.ownerId, salesId);
  assert.equal(
    directlyAssigned.body.record.attributes.leadCapturedById,
    marketingId,
  );
  for (const cookie of [marketing, sales, it, assistant])
    assert.equal(
      (
        await call(
          cookie,
          "GET",
          `/api/records?id=${directlyAssigned.body.record.id}`,
        )
      ).status,
      200,
    );
  assert.equal(
    (
      await call(
        readonly,
        "GET",
        `/api/records?id=${directlyAssigned.body.record.id}`,
      )
    ).status,
    404,
    "Unrelated Sales Manager cannot see a colleague's lead",
  );
  assert.equal(
    (
      await call(
        other,
        "GET",
        `/api/records?id=${directlyAssigned.body.record.id}`,
      )
    ).status,
    404,
  );
  assert.notEqual(
    (
      await call(assistant, "PATCH", "/api/records", {
        action: "assign",
        id: r.id,
        assigneeId: salesId,
      })
    ).status,
    200,
  );
  assert.equal((await call(it, "GET", "/api/users")).status, 200);
  const action = (outcome: string) => ({
    action: "lead-feedback",
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
    outcome,
    note: "",
    due: businessToday(),
  });
  assert.notEqual(
    (await call(marketing, "PATCH", "/api/records", action("Contacted")))
      .status,
    200,
  );
  assert.notEqual(
    (await call(readonly, "PATCH", "/api/records", action("Contacted"))).status,
    200,
  );
  assert.notEqual(
    (await call(other, "PATCH", "/api/records", action("Contacted"))).status,
    200,
  );
  assert.notEqual(
    (
      await call(
        sales,
        "PATCH",
        "/api/records",
        action("Contacted"),
        "https://wrong.invalid",
      )
    ).status,
    200,
  );
  const ack = await call(
    sales,
    "PATCH",
    "/api/records",
    action("Acknowledged"),
  );
  assert.equal(ack.status, 200);
  const stale = action("Interested");
  r = ack.body.record;
  assert.equal(r.attributes?.leadFirstResponseAt, undefined);
  assert.equal(r.attributes?.leadAcknowledgedOwnerId, salesId);
  const acknowledgedInbox = await call(marketing, "GET", "/api/notifications");
  assert.equal(acknowledgedInbox.status, 200);
  assert.ok(!acknowledgedInbox.body.items.some((n: { type: string }) => n.type === "lead.feedback"), "Acknowledgement is not a feedback notification");
  assert.notEqual(
    (await call(sales, "PATCH", "/api/records", stale)).status,
    200,
  );
  const contact = await call(
    sales,
    "PATCH",
    "/api/records",
    action("Contacted"),
  );
  assert.equal(contact.status, 200);
  r = contact.body.record;
  assert.ok(r.attributes?.leadFirstResponseAt);
  const visibleToMarketing = await call(
    marketing,
    "GET",
    `/api/records?id=${r.id}`,
  );
  assert.equal(
    visibleToMarketing.body.record.attributes.leadOutcome,
    "Contacted",
  );
  let creatorNotification: { type: string; body: string; target: { recordId?: string } } | undefined;
  for (let attempt = 0; attempt < 15; attempt++) {
    const result = await call(marketing, "GET", "/api/notifications");
    assert.equal(result.status, 200);
    creatorNotification = result.body.items.find((n: { type: string; target?: { recordId?: string } }) => n.type === "lead.feedback" && n.target?.recordId === r.id);
    if (creatorNotification) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(creatorNotification, "The original Marketing creator receives the authorised internal feedback alert");
  assert.match(creatorNotification.body, /Contacted/);
  assert.equal((await call(sales, "GET", "/api/notifications")).body.items.filter((n: { type: string }) => n.type === "lead.feedback").length, 0, "No notification for the actor's own feedback");
  assert.notEqual(
    (
      await call(sales, "PATCH", "/api/records", {
        ...action("Interested"),
        leadFirstResponseAt: "2000-01-01",
      })
    ).status,
    200,
  );
  assert.notEqual(
    (
      await call(sales, "POST", "/api/records", {
        ...input,
        attributes: { leadFirstResponseAt: now },
      })
    ).status,
    201,
  );

  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const [name, ...value] = sales.split("=");
    await context.addCookies([{ name, value: value.join("="), url: base }]);
    const page = await context.newPage();
    page.on("pageerror", (error) =>
      console.error("Browser error:", error.message),
    );
    await page.goto(base + "/workspace/all-companies/sales-pipeline");
    // The isolated Worker trusts the saved review origin, not this test port.
    await page.route("**/api/records", async (route) => {
      const response = await route.fetch({
        headers: { ...route.request().headers(), origin },
      });
      await route.fulfill({ response });
    });
    const desk = page.getByRole("region", { name: "Lead Desk", exact: true });
    await desk.getByRole("combobox", { name: "Show leads", exact: true }).click();
    await page.getByRole("option", { name: /^All leads$/i }).click();
    await desk.getByRole("searchbox").fill(`Fictional handoff ${stamp}`);
    await desk
      .getByRole("button", { name: input.title, exact: true })
      .waitFor({ timeout: 60000 });
    await desk.getByRole("button", { name: "Update / feedback" }).click();
    const update = page.getByRole("dialog", { name: "Lead update", exact: true });
    await update.getByRole("combobox", { name: "Conversation outcome", exact: true }).click();
    await page.getByRole("option", { name: "Interested", exact: true }).click();
    await update.getByRole("button", { name: "Save outcome" }).click();
    await update
      .locator("strong")
      .filter({ hasText: "Interested" })
      .waitFor({ timeout: 30000 });
    const verify = await call(marketing, "GET", `/api/records?id=${r.id}`);
    assert.equal(verify.body.record.attributes.leadOutcome, "Interested");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: "test-results-lead-desk/authenticated-lead-desk.png",
      fullPage: true,
    });
    console.log(
      JSON.stringify({
        ok: true,
        cursorPages: pages,
        fixtureLeads: fixtureIds.size,
        checks: [
          "anonymous/HR denied",
          "company/owner scope",
          "all 1005 rows loaded",
          "read-only/marketing feedback denied",
          "sales-only assignment",
          "origin check",
          "stale update denied",
          "server timestamps",
          "marketing feedback visibility",
          "Marketing creator receives internal feedback alert; acknowledgement and self-action stay quiet",
          "authenticated browser save",
          "direct create-and-assign with creator visibility",
          "unrelated Sales Manager denied",
          "MD Assistant read-only and IT administration",
        ],
        fixtureDirectory: fixture,
      }),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
