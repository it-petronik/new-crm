import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { writeFileSync } from "node:fs";
import { setup, md, sales } from "./support/phase7";
import { FixtureApollo } from "./support/fake-apollo";
import { searchInput } from "../src/lib/prospecting/model";
import { filters } from "../src/lib/prospecting/filters";
import { RealApollo, ApolloError } from "../src/lib/prospecting/provider";
import * as ops from "../src/lib/prospecting/operations";
import {
  importProspect,
  importReview,
  enrichmentReview,
  applyEnrichment,
} from "../src/lib/prospecting/store";
import { bulkImport, bulkImportReview } from "../src/lib/prospecting/imports";
import { csv, xlsx, report, safeCell } from "../src/lib/prospecting/export";
import { command } from "../src/lib/prospecting/commands";
import {
  apolloOperations,
  apolloStages,
  apolloUsage,
  contacts,
} from "../src/lib/schema";
const criteria = (
  kind: "company" | "person" = "person",
  keywords = "industrial",
) => searchInput.parse({ kind, keywords });
const clearGate = (f: ReturnType<typeof setup>) =>
  f.sqlite.exec("UPDATE ApolloGate SET until=0");
async function fixture(
  kind: "company" | "person" = "person",
  keywords = "industrial",
) {
  const f = setup(),
    provider = new FixtureApollo();
  const op = await ops.prepare(f.db, sales, {
    company: "Petronik",
    branch: "Main",
    requestId: "search",
    type: "search",
    criteria: criteria(kind, keywords),
  });
  const done = await ops.advance(f.db, sales, op.id, true, provider),
    page = await ops.stagedPage(f.db, sales, done.data.resultStageId!);
  clearGate(f);
  return {
    ...f,
    provider,
    page,
    search: done,
    refs: page.prospects.map((p) => ({
      stageId: page.stageId,
      providerId: p.id,
    })),
  };
}
async function enrich(
  f: Awaited<ReturnType<typeof fixture>>,
  refs = f.refs,
  phones = false,
) {
  const p = await ops.prepare(f.db, sales, {
    company: "Petronik",
    branch: "Main",
    requestId: crypto.randomUUID(),
    type: "enrich",
    refs,
    phones,
  });
  return ops.advance(f.db, sales, p.id, true, f.provider);
}
test("documented filters validate bounds, dates, company/person isolation and unknown keys", () => {
  assert.ok(
    searchInput.safeParse({
      kind: "company",
      advanced: {
        companyName: "Fictional",
        revenueMin: "0",
        revenueMax: "1000000",
        growthMonths: "12",
        growthMin: "-10",
      },
    }).success,
  );
  for (const advanced of [
    { industryId: "invented" },
    { personLocations: "Dubai" },
    { revenueMin: "100", revenueMax: "1" },
    { growthMonths: "12" },
    { growthMin: "10" },
    { growthMonths: "9", growthMin: "10" },
    { fundingFrom: "2026-02-31" },
    { employeeRanges: "50,1" },
  ])
    assert.equal(
      searchInput.safeParse({ kind: "company", advanced }).success,
      false,
      JSON.stringify(advanced),
    );
  assert.equal(
    searchInput.safeParse({ kind: "person", advanced: { seniorities: "CEO" } })
      .success,
    false,
  );
  assert.equal(
    searchInput.safeParse({
      kind: "person",
      advanced: { emailStatuses: "verified,unavailable" },
    }).success,
    true,
  );
});
test("every filter maps to the documented provider field; page/count controls are bounded", async () => {
  let args: any;
  const real = new RealApollo("fictional-key", async (_u, init) => {
    args = JSON.parse(String(init?.body));
    return Response.json({
      organizations: [],
      pagination: { total_entries: 120 },
    });
  });
  const s = searchInput.parse({
    kind: "company",
    keywords: "base oil,industrial",
    location: "Dubai,India",
    domain: "www.example.test",
    perPage: 100,
    advanced: {
      companyName: "Fictional",
      employeeRanges: "1,10;11,50",
      fundingMin: "20",
      technologiesAny: "salesforce",
      growthMonths: "12",
      growthMin: "0",
    },
  });
  const p = await real.search(s);
  assert.deepEqual(args.q_organization_keyword_tags, [
    "base oil",
    "industrial",
  ]);
  assert.deepEqual(args.organization_locations, ["Dubai", "India"]);
  assert.deepEqual(args.organization_num_employees_ranges, ["1,10", "11,50"]);
  assert.equal(args["latest_funding_amount_range[min]"], 20);
  assert.equal(args.per_page, 100);
  assert.equal(p.total, 120);
  assert.equal(p.hasMore, true);
  assert.equal(searchInput.safeParse({ ...s, page: 501 }).success, false);
  assert.ok(filters.length >= 30);
});
test("prepare is free; free search and paid company page record distinct estimates and observed credits", async () => {
  for (const kind of ["company", "person"] as const) {
    const f = setup(),
      p = new FixtureApollo();
    const prepared = await ops.prepare(f.db, sales, {
      company: "Petronik",
      branch: "Main",
      requestId: kind,
      type: "search",
      criteria: criteria(kind),
    });
    assert.equal(p.searches, 0);
    assert.equal(prepared.data.estimate, kind === "company" ? 1 : 0);
    await assert.rejects(ops.advance(f.db, sales, prepared.id, false, p));
    assert.equal(p.searches, 0);
    await ops.advance(f.db, sales, prepared.id, true, p);
    assert.equal(p.searches, 1);
    const log = await f.db.select().from(apolloUsage);
    assert.equal(log[0].actualCredits, kind === "company" ? 1 : 0);
    assert.equal(
      f.sqlite.prepare("SELECT count(*) n FROM BusinessRecord").get()!.n,
      0,
    );
  }
});
test("same paid request identity cannot run twice, including concurrent confirmation and changed payload", async () => {
  const f = setup(),
    p = new FixtureApollo();
  const input = {
    company: "Petronik",
    branch: "Main",
    requestId: "same",
    type: "search" as const,
    criteria: criteria("company"),
  };
  const a = await ops.prepare(f.db, sales, input);
  const results = await Promise.allSettled([
    ops.advance(f.db, sales, a.id, true, p),
    ops.advance(f.db, sales, a.id, true, p),
  ]);
  assert.equal(p.searches, 1);
  assert.ok(results.some((r) => r.status === "fulfilled"));
  await ops.advance(f.db, sales, a.id, true, p);
  assert.equal(p.searches, 1);
  await assert.rejects(
    ops.prepare(f.db, sales, {
      ...input,
      criteria: criteria("company", "changed"),
    }),
  );
});
test("single company and person enrichment stage returned data with field provenance", async () => {
  for (const kind of ["company", "person"] as const) {
    const f = await fixture(kind);
    const o = await enrich(f, [f.refs[0]]);
    assert.equal(o.status, "completed");
    assert.equal(o.data.items[0].status, "succeeded");
    assert.ok(o.data.items[0].prospect.enrichedAt);
    assert.equal(o.data.items[0].prospect.provenance?.name.source, "Apollo");
    assert.equal(f.provider.enrichments, 1);
    assert.equal(
      f.sqlite.prepare("SELECT count(*) n FROM BusinessRecord").get()!.n,
      0,
    );
  }
});
test("bulk people and companies use 10-item serial chunks with deterministic progress", async () => {
  for (const kind of ["person", "company"] as const) {
    const f = await fixture(kind, "large");
    let o = await enrich(f);
    assert.equal(o.status, "paused");
    assert.equal(
      o.data.items.filter((i) => i.status === "succeeded").length,
      10,
    );
    clearGate(f);
    o = await ops.advance(f.db, sales, o.id, true, f.provider);
    assert.equal(
      o.data.items.filter((i) => i.status === "succeeded").length,
      20,
    );
    clearGate(f);
    o = await ops.advance(f.db, sales, o.id, true, f.provider);
    assert.equal(o.status, "completed");
    assert.equal(f.provider.enrichments, 3);
    await ops.advance(f.db, sales, o.id, true, f.provider);
    assert.equal(f.provider.enrichments, 3);
  }
});
test("successful, no-data and failed items survive together; retry includes failures only", async () => {
  const f = await fixture();
  const p = f.page.prospects;
  const old = f.provider.bulk.bind(f.provider);
  f.provider.bulk = async (ps, ph) => {
    const r = await old(ps, ph);
    r.items[1] = { id: ps[1].id, prospect: null, status: "no_data" };
    r.items[2] = { id: ps[2].id, prospect: null, status: "failed" };
    return r;
  };
  const o = await enrich(f);
  assert.deepEqual(
    o.data.items.map((i) => i.status),
    ["succeeded", "no_data", "failed"],
  );
  assert.equal(o.data.items[1].prospect.enrichmentStatus, "No additional data");
  const retry = await ops.retryFailed(f.db, sales, o.id, "retry");
  assert.equal(retry.data.items.length, 1);
  assert.equal(retry.data.items[0].prospect.id, p[2].id);
});
test("unknown charge after timeout is not retried; durable receipt survives snapshot expiry", async () => {
  const f = await fixture();
  f.provider.bulk = async () => {
    f.provider.enrichments++;
    throw new ApolloError(503, "Timeout", 0, true);
  };
  const o = await enrich(f);
  assert.equal(o.status, "unknown");
  await ops.advance(f.db, sales, o.id, true, f.provider);
  assert.equal(f.provider.enrichments, 1);
  await assert.rejects(ops.retryFailed(f.db, sales, o.id, "retry"));
  await f.db
    .update(apolloOperations)
    .set({ expiresAt: new Date(0) })
    .where(eq(apolloOperations.id, o.id));
  await ops.purgeApollo(f.db);
  const receipt = await f.db
    .select()
    .from(apolloOperations)
    .where(eq(apolloOperations.id, o.id))
    .get();
  assert.equal(receipt?.data, null);
  await assert.rejects(ops.advance(f.db, sales, o.id, true, f.provider));
  assert.equal(f.provider.enrichments, 1);
});
test("429 exposes provider retry time, pauses all batches and makes no automatic retries", async () => {
  const f = await fixture();
  f.provider.bulk = async () => {
    f.provider.enrichments++;
    throw new ApolloError(429, "Rate limited", 45);
  };
  const o = await enrich(f);
  assert.equal(o.status, "failed");
  assert.ok(o.data.retryAt! > Date.now() + 40000);
  assert.equal(f.provider.enrichments, 1);
  await assert.rejects(ops.retryFailed(f.db, sales, o.id, "retry"));
});
test("zero known balance blocks confirmed paid action, unknown balance remains explicit", async () => {
  const f = await fixture("company");
  const account = await f.provider.account();
  account.available = 0;
  f.sqlite
    .prepare("INSERT INTO ApolloAccountCache VALUES(?,?,?)")
    .run("apollo", JSON.stringify(account), Date.now());
  const o = await ops.prepare(f.db, sales, {
    company: "Petronik",
    branch: "Main",
    type: "enrich",
    refs: f.refs,
    requestId: "zero",
  });
  assert.equal(o.data.available, 0);
  await assert.rejects(
    ops.advance(f.db, sales, o.id, true, f.provider),
    /exhausted/,
  );
  assert.equal(f.provider.enrichments, 0);
});
test("credit center caches explicit refresh and passive pages, saved searches and report need no provider", async () => {
  const f = await fixture();
  let calls = 0;
  const original = f.provider.account.bind(f.provider);
  f.provider.account = async () => {
    calls++;
    return original();
  };
  await ops.workspace(f.db, sales, "Petronik", "Main");
  assert.equal(calls, 0);
  await ops.refreshAccount(f.db, sales, "Petronik", "Main", f.provider);
  await ops.refreshAccount(f.db, sales, "Petronik", "Main", f.provider);
  assert.equal(calls, 1);
  await ops.saveSearch(f.db, sales, {
    company: "Petronik",
    branch: "Main",
    name: "Buyers",
    market: "UAE",
    criteria: criteria(),
  });
  const w = await ops.workspace(f.db, sales, "Petronik", "Main");
  assert.equal(w.saved.length, 1);
  assert.equal(calls, 1);
  assert.equal(f.provider.searches, 1);
  const data = await ops.dataset(f.db, sales, f.refs);
  assert.equal(report(data).count, 3);
  assert.equal(f.provider.enrichments, 0);
});
test("roles, actor, branch, company and expired stages are enforced for export and operations", async () => {
  const f = await fixture();
  for (const actor of [
    md,
    { ...sales, role: "IT Administrator" as const },
    { ...sales, companies: ["Other"] },
    { ...sales, branches: ["Other"] },
  ]) {
    await assert.rejects(ops.dataset(f.db, actor, f.refs));
    await assert.rejects(ops.readOperation(f.db, actor, f.search.id));
  }
  await f.db.update(apolloStages).set({ expiresAt: new Date(0) });
  await assert.rejects(ops.dataset(f.db, sales, f.refs));
});
test("reserved bulk snapshot survives original search expiry and has a bounded 30-minute TTL", async () => {
  const f = await fixture();
  const o = await ops.prepare(f.db, sales, {
    company: "Petronik",
    branch: "Main",
    requestId: "reserved",
    type: "enrich",
    refs: f.refs,
  });
  await f.db.update(apolloStages).set({ expiresAt: new Date(0) });
  const done = await ops.advance(f.db, sales, o.id, true, f.provider);
  assert.equal(done.status, "completed");
  assert.ok(new Date(done.expiresAt).getTime() <= Date.now() + 30 * 60000);
  assert.equal(
    (await ops.stagedPage(f.db, sales, done.data.resultStageId!)).prospects
      .length,
    3,
  );
});
test("native provider batches use approved identities, no personal email or waterfall and preserve 64-bit phone IDs", async () => {
  const f = await fixture();
  let body: any;
  const real = new RealApollo("not-real", async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(
      '{"status":"success","credits_consumed":1.5,"request_id":-1039995589705121900,"matches":[{"id":"' +
        f.page.prospects[0].id +
        '","name":"Fictional Person","email":"work@example.test"}]}',
    );
  });
  const r = await real.bulk([f.page.prospects[0]], true);
  assert.equal(r.phoneRequestId, "-1039995589705121900");
  assert.equal(body.reveal_personal_emails, false);
  assert.equal(body.run_waterfall_email, false);
  assert.equal(body.poll_only, true);
  assert.equal(r.actualCredits, 1.5);
  assert.equal(r.items[0].status, "succeeded");
  await assert.rejects(real.bulk(Array(11).fill(f.page.prospects[0]), false));
});
test("phone polling is explicit and filters unclassified/mobile numbers out of business fields", async () => {
  const real = new RealApollo("fake", async () =>
    Response.json({
      webhook_status: "success",
      webhook_result: {
        credits_consumed: 8,
        people: [
          {
            id: "p",
            phone_numbers: [
              { type_cd: "mobile", raw_number: "secret-personal" },
              { type_cd: "work", sanitized_number: "+15555550123" },
            ],
          },
        ],
      },
    }),
  );
  const r = await real.phoneResult("-1039995589705121900");
  assert.equal(r.phones[0].phone, "+15555550123");
  assert.equal(r.actualCredits, 8);
});
test("credit API extracts lead/shared counter only; unrelated phone buckets never become available credits", async () => {
  const real = new RealApollo("fake", async (url) =>
    String(url).includes("credit_usage")
      ? Response.json({
          credit_usage_stats: {
            lead_credit: { limit: 3000, consumed: 110, left_over: 2890 },
            mobile_credit: { limit: 0, left_over: 999999 },
          },
          current_credit_cycle: { end_date: "2026-10-01" },
        })
      : Response.json({
          '["api/v1/people","bulk_match"]': {
            minute: { limit: 20, left_over: 10 },
          },
        }),
  );
  const a = await real.account();
  assert.equal(a.available, 2890);
  assert.equal(a.limits[0].remaining, 10);
  assert.equal(JSON.stringify(a).includes("999999"), false);
});
test("bulk import reviews existing and ambiguous customers; one invalid item does not roll back successes", async () => {
  const f = await fixture();
  f.record("known", "customers", {
    title: f.page.prospects[0].companyName,
    attributes: { apolloCompanyId: f.page.prospects[0].companyId },
  });
  f.record("ambiguous", "customers", {
    title: f.page.prospects[1].companyName,
  });
  const review = await bulkImportReview(f.db, sales, f.refs);
  assert.equal(review.items[0].match, "Existing Customer");
  assert.equal(review.items[1].needsReview, true);
  const input = review.items.map((r, i) => ({
    ...r.ref,
    requestId: `import${i}`,
    companyName: r.companyName,
    contactName: i === 2 ? "" : r.contactName,
    customerId: r.customerId,
    createLead: true,
    createDeal: false,
  }));
  const result = await bulkImport(f.db, sales, input);
  assert.equal(result.counts.matched, 1);
  assert.equal(result.counts.needsReview, 1);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.contacts, 1);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM Deal").get()!.n, 0);
  const retry = await bulkImport(f.db, sales, input);
  assert.equal(retry.counts.contacts, 0);
  assert.equal(retry.counts.leads, 0);
});
test("bulk imports share only explicitly confirmed exact Apollo company identities", async () => {
  const f = await fixture();
  const ps = f.page.prospects.map((p) => ({
    ...p,
    companyId: "shared-apollo",
    companyName: "Shared fictional company",
  }));
  await f.db
    .update(apolloStages)
    .set({ data: { ...f.page, prospects: ps } })
    .where(eq(apolloStages.id, f.page.stageId));
  const r = await bulkImport(
    f.db,
    sales,
    ps.map((p, i) => ({
      ...f.refs[i],
      requestId: `sameorg${i}`,
      companyName: p.companyName,
      contactName: p.name,
      groupCompany: true,
      createDeal: false,
    })),
  );
  assert.equal(r.counts.customers, 1);
  assert.equal(r.counts.contacts, 3);
  assert.equal(r.counts.failed, 0);
});
test("Customer-only import does not force a Contact, Lead or Deal", async () => {
  const f = await fixture();
  const r = await importProspect(f.db, sales, {
    ...f.refs[0],
    requestId: "customer-only",
    companyName: "Reviewed fictional",
    createContact: false,
    createLead: false,
    createDeal: false,
  });
  assert.equal(r.contactId, null);
  assert.equal(r.leadId, null);
  assert.equal(r.dealId, null);
});
test("existing Contact match and selected enrichment keep unselected authoritative fields", async () => {
  const f = await fixture();
  f.record("known", "customers", {
    title: "Known",
    attributes: { apolloCompanyId: f.page.prospects[0].companyId },
  });
  const imported = await importProspect(f.db, sales, {
    ...f.refs[0],
    requestId: "contact",
    customerId: "known",
    companyName: "Known",
    contactName: "Original Person",
    email: "old@example.test",
  });
  clearGate(f);
  const o = await enrich(f, [f.refs[0]]);
  const ref = o.data.items[0].resultRef!;
  const rev = await enrichmentReview(
    f.db,
    sales,
    ref.stageId,
    ref.providerId,
    imported.contactId!,
    "contact",
  );
  await applyEnrichment(f.db, sales, {
    ...ref,
    targetId: imported.contactId!,
    kind: "contact",
    version: rev.version,
    fields: ["email"],
  });
  const c = await f.db
    .select()
    .from(contacts)
    .where(eq(contacts.id, imported.contactId!))
    .get();
  assert.equal(c?.details.name, "Original Person");
  assert.match(c!.details.email, /@example.test/);
  const d = await ops.dataset(f.db, sales, [ref]);
  assert.equal(d[0].match, "Existing Contact");
});
test("crafted export cannot recover CRM-linked prospect after Lead ownership changes", async () => {
  const f = await fixture();
  const r = await importProspect(f.db, sales, {
    ...f.refs[0],
    requestId: "private",
    companyName: "Fictional",
    contactName: "Person",
    createLead: true,
  });
  const row = f.sqlite
    .prepare("SELECT payload FROM BusinessRecord WHERE id=?")
    .get(r.leadId!)!;
  const p = JSON.parse(String(row.payload));
  p.ownerId = "other";
  f.sqlite
    .prepare("UPDATE BusinessRecord SET ownerId=?,payload=? WHERE id=?")
    .run("other", JSON.stringify(p), r.leadId!);
  await assert.rejects(ops.dataset(f.db, sales, [f.refs[0]]));
});
test("CSV and XLSX retain Unicode, newlines, commas and text; formulas and markup cannot execute", async () => {
  const f = await fixture();
  const rows = await ops.dataset(f.db, sales, f.refs);
  rows[0].prospect.companyName = '=HYPERLINK("https://bad.test")';
  rows[0].prospect.description =
    '中文 العربية\nlong, quote " description ' + "x".repeat(4000);
  rows[1].prospect.name = "@SUM(1,1)";
  const c = csv(rows);
  assert.ok(c.startsWith("\ufeff"));
  assert.ok(c.includes("中文 العربية"));
  assert.ok(c.includes("'=HYPERLINK"));
  assert.ok(c.includes('""https://bad.test""'));
  for (const s of ["=1", " +1", "\t@cmd", "\r-2", "\ufeff=3"])
    assert.equal(safeCell(s)[0], "'");
  const r = report(rows, [
    {
      operation: "person_enrichment",
      estimatedCredits: 3,
      actualCredits: null,
      status: "unknown",
    },
  ]);
  assert.equal(r.count, 3);
  assert.equal(r.people, 3);
  assert.equal(r.unknownCreditOperations, 1);
  const bytes = xlsx(rows, r);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  const raw = new TextDecoder().decode(bytes);
  for (const name of ["Prospects", "Companies", "People", "Summary"])
    assert.ok(raw.includes(`name="${name}"`));
  assert.ok(raw.includes('state="frozen"'));
  assert.ok(raw.includes("autoFilter"));
  assert.equal(raw.includes("<f>"), false);
  assert.equal(raw.includes("APOLLO_API_KEY"), false);
  writeFileSync("/tmp/enercore-apollo-export.xlsx", bytes);
  writeFileSync("/tmp/enercore-apollo-export.csv", c);
});
test("100-row exports and deterministic report totals stay bounded and do not invoke enrichment", async () => {
  const f = await fixture("person", "large");
  const rows = await ops.dataset(f.db, sales, f.refs);
  const big = Array.from({ length: 100 }, (_, i) => ({
    ...rows[i % rows.length],
    prospect: { ...rows[i % rows.length].prospect, id: `p${i}` },
  }));
  const r = report(big);
  assert.equal(r.count, 100);
  assert.equal(
    r.countries.reduce((n, [_c, v]) => n + v, 0),
    100,
  );
  assert.ok(xlsx(big, r).length < 1000000);
  assert.equal(f.provider.enrichments, 0);
});
test("legacy unconfirmed paid routes and malformed bulk permissions are rejected by command contract", () => {
  assert.equal(
    command.safeParse({ action: "enrich", stageId: "s", providerId: "p" })
      .success,
    false,
  );
  assert.equal(
    command.safeParse({
      action: "search",
      company: "Petronik",
      branch: "Main",
      criteria: criteria(),
    }).success,
    false,
  );
  assert.equal(
    command.safeParse({ action: "advance", id: "x", confirmed: false }).success,
    false,
  );
  assert.equal(
    command.safeParse({
      action: "export",
      format: "csv",
      refs: Array(101).fill({ stageId: "s", providerId: "p" }),
    }).success,
    false,
  );
});

test("oversized HTTP success remains an uncertain paid outcome", async () => {
  const p = new RealApollo(
    "fictional",
    async () => new Response("x".repeat(2000001)),
  );
  await assert.rejects(
    p.search(criteria("company")),
    (e: unknown) => e instanceof ApolloError && e.uncertain,
  );
});
test("known low API limit blocks new work before spend and retains confirmation", async () => {
  const f = await fixture();
  const a = await f.provider.account();
  a.limits = [
    {
      endpoint: '["api/v1/people","bulk_match"]',
      window: "hour",
      limit: 10,
      remaining: 0,
    },
  ];
  f.sqlite
    .prepare("INSERT INTO ApolloAccountCache VALUES(?,?,?)")
    .run("apollo", JSON.stringify(a), Date.now());
  const o = await ops.prepare(f.db, sales, {
    company: "Petronik",
    branch: "Main",
    requestId: "limited",
    type: "enrich",
    refs: f.refs,
  });
  await assert.rejects(
    ops.advance(f.db, sales, o.id, true, f.provider),
    /limit is exhausted/,
  );
  assert.equal(f.provider.enrichments, 0);
  assert.equal((await ops.readOperation(f.db, sales, o.id)).status, "prepared");
});
test("same request identity remains blocked after crash while successful other chunks stay staged", async () => {
  const f = await fixture("person", "large");
  const first = await enrich(f);
  await f.db
    .update(apolloOperations)
    .set({ status: "running", updatedAt: new Date(Date.now() - 120000) })
    .where(eq(apolloOperations.id, first.id));
  const r = await ops.readOperation(f.db, sales, first.id);
  assert.equal(r.status, "unknown");
  await ops.advance(f.db, sales, first.id, true, f.provider);
  assert.equal(f.provider.enrichments, 1);
  assert.equal(
    (
      await ops.stagedPage(f.db, sales, first.data.resultStageId!)
    ).prospects.filter((p) => p.enrichedAt).length,
    10,
  );
});
test("bulk per-item schema failure does not prevent valid peer import", async () => {
  const f = await fixture();
  const result = await bulkImport(
    f.db,
    sales,
    f.refs.map((r, i) => ({
      ...r,
      requestId: `valid${i}`,
      companyName: "Fictional " + i,
      contactName: "Fictional person " + i,
      email: i === 1 ? "not-an-email" : "",
    })),
  );
  assert.equal(result.counts.created, 2);
  assert.equal(result.counts.failed, 1);
});
test("failed enrichment is visible while staged search data remains readable", async () => {
  const f = await fixture();
  f.provider.bulk = async () => {
    throw new ApolloError(403, "Plan or key scope restricted");
  };
  const o = await enrich(f);
  assert.equal(o.status, "failed");
  const page = await ops.stagedPage(f.db, sales, o.data.resultStageId!);
  assert.equal(page.prospects[0].enrichmentStatus, "Failed");
  assert.equal(page.prospects[0].name, f.page.prospects[0].name);
  await assert.rejects(
    enrichmentReview(
      f.db,
      sales,
      page.stageId,
      page.prospects[0].id,
      "not-a-record",
      "contact",
    ),
    /Explicitly enrich/,
  );
});

test("enriched report lineage includes the original search and avoids repeated operation IDs", async () => {
  const f = await fixture("company");
  const o = await enrich(f);
  const page = await ops.stagedPage(f.db, sales, o.data.resultStageId!);
  assert.deepEqual(new Set(page.operationIds), new Set([f.search.id, o.id]));
  const log = await f.db.select().from(apolloUsage);
  const rows = await ops.dataset(
    f.db,
    sales,
    o.data.items.map((i) => i.resultRef!),
  );
  assert.equal(report(rows, log).observedCredits, 4);
});
test("completed phone observations are logged once and separated from overlapping totals", async () => {
  const f = await fixture();
  const o = await enrich(f, [f.refs[0]], true);
  o.data.phoneJobs![0].retryAt = 0;
  await f.db
    .update(apolloOperations)
    .set({ data: o.data })
    .where(eq(apolloOperations.id, o.id));
  let polls = 0;
  f.provider.phoneResult = async () => {
    polls++;
    return { pending: false, retryAfter: 0, phones: [], actualCredits: 8 };
  };
  clearGate(f);
  await ops.pollPhones(f.db, sales, o.id, f.provider);
  await ops.pollPhones(f.db, sales, o.id, f.provider);
  assert.equal(polls, 1);
  const log = await f.db.select().from(apolloUsage);
  const r = report(
    await ops.dataset(f.db, sales, [o.data.items[0].resultRef!]),
    log,
  );
  assert.deepEqual(r.phoneObservations, [8]);
  assert.equal(r.observedCredits, 1);
});

test("Workers native fetch is called without a provider receiver", async () => {
  const transport = async function (this: unknown) {
    assert.equal(
      this,
      undefined,
      "Workers fetch rejects a class instance as its receiver",
    );
    return Response.json({
      organizations: [],
      pagination: { total_entries: 0 },
    });
  } as typeof fetch;
  const provider = new RealApollo("fictional", transport);
  assert.equal(
    (await provider.search(criteria("company"))).prospects.length,
    0,
  );
});

test("new search identities repeat freely after success or unknown charge; replay never spends twice", async () => {
  const f = setup();
  let calls = 0;
  const provider = {
    search: async (input: ReturnType<typeof criteria>) => {
      calls++;
      if (calls === 1)
        throw new ApolloError(503, "Apollo unavailable", 0, true);
      return {
        prospects: [],
        page: 1,
        hasMore: false,
        criteria: input,
        source: "Apollo" as const,
      };
    },
    enrich: async () => {
      throw Error("Unexpected enrichment");
    },
  };
  const create = (requestId: string) =>
    ops.prepare(f.db, sales, {
      company: "Petronik",
      branch: "Main",
      type: "search",
      requestId,
      criteria: criteria("company"),
    });
  const first = await create("first-search");
  assert.equal(
    (await ops.advance(f.db, sales, first.id, true, provider)).status,
    "unknown",
  );
  await ops.advance(f.db, sales, first.id, true, provider);
  assert.equal(calls, 1);
  const second = await create("second-search");
  assert.notEqual(first.id, second.id);
  assert.equal(
    (await ops.advance(f.db, sales, second.id, true, provider)).status,
    "completed",
  );
  const third = await create("third-search");
  assert.equal(
    (await ops.advance(f.db, sales, third.id, true, provider)).status,
    "completed",
  );
  await ops.advance(f.db, sales, third.id, true, provider);
  assert.equal(calls, 3);
  assert.equal(
    f.sqlite.prepare("SELECT count(*) n FROM ApolloUsage").get()!.n,
    3,
  );
  assert.equal(
    f.sqlite.prepare("SELECT count(*) n FROM ApolloImport").get()!.n,
    0,
  );
  f.sqlite.close();
});

test("search honors actual Retry-After across identities without imposing extra cooldown", async () => {
  const f = setup();
  let calls = 0;
  const provider = {
    search: async (input: ReturnType<typeof criteria>) => {
      calls++;
      if (calls === 1)
        throw new ApolloError(429, "Apollo rate limit reached.", 2);
      return {
        prospects: [],
        page: 1,
        hasMore: false,
        criteria: input,
        source: "Apollo" as const,
      };
    },
    enrich: async () => {
      throw Error("Unexpected");
    },
  };
  const make = (requestId: string) =>
    ops.prepare(f.db, sales, {
      company: "Petronik",
      branch: "Main",
      type: "search",
      requestId,
      criteria: criteria("company"),
    });
  const a = await make("rate-first");
  await ops.advance(f.db, sales, a.id, true, provider);
  const b = await make("rate-second");
  await assert.rejects(
    () => ops.advance(f.db, sales, b.id, true, provider),
    /rate limit/,
  );
  assert.equal(calls, 1);
  f.sqlite.exec("UPDATE ApolloGate SET until=0");
  await ops.advance(f.db, sales, b.id, true, provider);
  assert.equal(calls, 2);
  f.sqlite.close();
});
