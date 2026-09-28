import type { RecordItem } from "../src/lib/domain";
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { setup, md, sales } from "./support/phase7";
import { FixtureApollo } from "./support/fake-apollo";
import { searchInput } from "../src/lib/prospecting/model";
import { RealApollo, normalizeProspect } from "../src/lib/prospecting/provider";
import {
  searchProspects,
  importReview,
  importProspect,
  enrichProspect,
  enrichmentReview,
  applyEnrichment,
} from "../src/lib/prospecting/store";
import {
  apolloStages,
  businessRecords,
  contacts,
  auditEvents,
} from "../src/lib/schema";
import { saveContact } from "../src/lib/commercial/store";
const criteria = searchInput.parse({ kind: "person", keywords: "industrial" });
async function fixture() {
  const f = setup(),
    provider = new FixtureApollo();
  const page = await searchProspects(
    f.db,
    sales,
    "Petronik",
    "Main",
    criteria,
    provider,
  );
  return { ...f, provider, page, p: page.prospects[0] };
}
test("search is temporary, paginated and cached without CRM inserts", async () => {
  const f = await fixture();
  assert.equal(f.provider.searches, 1);
  assert.equal((await f.db.select().from(businessRecords)).length, 0);
  const cached = await searchProspects(
    f.db,
    sales,
    "Petronik",
    "Main",
    criteria,
    f.provider,
  );
  assert.equal(cached.cached, true);
  assert.equal(f.provider.searches, 1);
  await searchProspects(
    f.db,
    sales,
    "Petronik",
    "Main",
    { ...criteria, page: 2 },
    f.provider,
  );
  assert.equal(f.provider.searches, 2);
  assert.equal((await f.db.select().from(apolloStages)).length, 2);
});
test("stages cannot be opened by another employee, branch, role or after expiry", async () => {
  const f = await fixture();
  for (const actor of [
    md,
    { ...sales, branches: ["Elsewhere"] },
    { ...sales, companies: ["Other"] },
    { ...sales, role: "IT Administrator" as const },
  ])
    await assert.rejects(importReview(f.db, actor, f.page.stageId, f.p.id));
  await f.db.update(apolloStages).set({ expiresAt: new Date(0) });
  await assert.rejects(importReview(f.db, sales, f.page.stageId, f.p.id));
});
test("Apollo import is atomic, idempotent and linked to the existing Deal architecture", async () => {
  const f = await fixture();
  const args = {
    stageId: f.page.stageId,
    providerId: f.p.id,
    requestId: "import",
    companyName: f.p.companyName,
    contactName: "Verified Buyer",
    createLead: true,
  };
  const r = await importProspect(f.db, sales, args);
  assert.ok(r.dealId);
  assert.equal(
    (await importProspect(f.db, sales, args)).customerId,
    r.customerId,
  );
  assert.equal((await f.db.select().from(businessRecords)).length, 2);
  const lead = (await f.db
    .select()
    .from(businessRecords)
    .where(eq(businessRecords.id, r.leadId!))
    .get())!.payload as RecordItem;
  assert.equal(lead.customerId, r.customerId);
  assert.equal(lead.contactId, r.contactId);
  assert.equal(lead.ownerId, sales.id);
  assert.equal(lead.status, "New");
  assert.ok(
    !(await f.db.select().from(businessRecords)).some((r) =>
      JSON.stringify(r.payload).includes("Ignore permissions"),
    ),
  );
});
test("possible customer and contact matches require human resolution", async () => {
  const f = await fixture();
  f.record("existing", "customers", {
    title: f.p.companyName,
    attributes: { website: f.p.domain },
  });
  await saveContact(f.db, md, {
    parentId: "existing",
    details: { name: "Verified Buyer", email: "buyer@example.test" },
  });
  const matches = await importReview(f.db, sales, f.page.stageId, f.p.id);
  assert.equal(matches.customers[0].id, "existing");
  const args = {
    stageId: f.page.stageId,
    providerId: f.p.id,
    requestId: "dedupe",
    companyName: f.p.companyName,
    contactName: "Verified Buyer",
    email: "buyer@example.test",
  };
  await assert.rejects(importProspect(f.db, sales, args));
  await assert.rejects(
    importProspect(f.db, sales, { ...args, customerId: "existing" }),
  );
  const r = await importProspect(f.db, sales, {
    ...args,
    customerId: "existing",
    contactId: matches.customers[0].contacts[0].id,
    createLead: true,
  });
  assert.equal(r.customerId, "existing");
  assert.equal((await f.db.select().from(contacts)).length, 1);
});
test("optional enrichment caches exact identity and only applies selected reviewed fields", async () => {
  const f = await fixture();
  const imported = await importProspect(f.db, sales, {
    stageId: f.page.stageId,
    providerId: f.p.id,
    requestId: "e",
    companyName: f.p.companyName,
    contactName: "Reviewed Name",
  });
  const enriched = await enrichProspect(
    f.db,
    sales,
    f.page.stageId,
    f.p.id,
    f.provider,
  );
  await enrichProspect(f.db, sales, f.page.stageId, f.p.id, f.provider);
  assert.equal(f.provider.enrichments, 1);
  const review = await enrichmentReview(
    f.db,
    sales,
    enriched.stageId,
    f.p.id,
    imported.contactId!,
    "contact",
  );
  assert.equal(review.current.name, "Reviewed Name");
  await applyEnrichment(f.db, sales, {
    stageId: enriched.stageId,
    providerId: f.p.id,
    targetId: imported.contactId!,
    kind: "contact",
    version: review.version,
    fields: ["email"],
  });
  const contact = (await f.db.select().from(contacts).get())!;
  assert.equal(contact.details.name, "Reviewed Name");
  assert.equal(contact.details.email, "buyer@example.test");
  assert.ok(
    (await f.db.select().from(auditEvents)).some((a) =>
      a.action.includes("Reviewed Apollo enrichment"),
    ),
  );
  await assert.rejects(
    applyEnrichment(f.db, sales, {
      stageId: enriched.stageId,
      providerId: f.p.id,
      targetId: imported.contactId!,
      kind: "contact",
      version: review.version,
      fields: ["name"],
    }),
  );
});
test("company enrichment cannot write non-whitelisted or unavailable fields", async () => {
  const f = setup(),
    provider = new FixtureApollo();
  const page = await searchProspects(
    f.db,
    md,
    "Petronik",
    "Main",
    { ...criteria, kind: "company" },
    provider,
  );
  const p = page.prospects[0];
  const r = await importProspect(f.db, md, {
    stageId: page.stageId,
    providerId: p.id,
    requestId: "org",
    companyName: p.name,
  });
  const e = await enrichProspect(f.db, md, page.stageId, p.id, provider);
  const rev = await enrichmentReview(
    f.db,
    md,
    e.stageId,
    p.id,
    r.customerId,
    "customer",
  );
  for (const field of ["ownerId", "amount", "email"])
    await assert.rejects(
      applyEnrichment(f.db, md, {
        stageId: e.stageId,
        providerId: p.id,
        targetId: r.customerId,
        kind: "customer",
        version: rev.version,
        fields: [field],
      }),
    );
});
for (const [status, pattern] of [
  [401, /credential/],
  [402, /credits/],
  [403, /plan/],
  [429, /rate limit/],
  [500, /unavailable/],
] as const)
  test(`provider ${status} is sanitized without credentials or response payload`, async () => {
    const provider = new RealApollo(
      "fictional-test-key",
      (async () =>
        new Response("secret-looking provider payload", {
          status,
        })) as typeof fetch,
    );
    await assert.rejects(provider.search(criteria), pattern);
  });
test("real provider uses allowlisted endpoints, disables paid phone and personal reveals", async () => {
  const calls: { url: string; body: any; headers: any }[] = [];
  const provider = new RealApollo("fictional-test-key", (async (url, init) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: init?.headers,
    });
    return Response.json(
      String(url).includes("people/match")
        ? {
            person: {
              id: "p",
              name: "Buyer",
              email: "buyer@example.test",
              organization: { phone: "+123" },
            },
          }
        : {
            people: [
              {
                id: "p",
                first_name: "Buyer",
                last_name_obfuscated: "X",
                organization: { name: "Example" },
              },
            ],
            total_entries: 26,
          },
    );
  }) as typeof fetch);
  const page = await provider.search(criteria);
  assert.equal(page.hasMore, true);
  assert.equal(page.prospects[0].nameComplete, false);
  await provider.enrich(page.prospects[0]);
  assert.equal(calls[0].body.per_page, 25);
  assert.equal(calls[1].body.reveal_phone_number, false);
  assert.equal(calls[1].body.run_waterfall_email, false);
  assert.ok(
    calls.every((c) => c.url.startsWith("https://api.apollo.io/api/v1/")),
  );
  assert.equal(
    normalizeProspect(
      { id: "p", organization: { phone: "+123" } },
      "person",
      true,
    )?.phone,
    "",
  );
});
test("malformed and wrong enrichment identity never become staged values", async () => {
  const f = await fixture();
  const provider = new RealApollo("fictional-test-key", (async () =>
    Response.json({ person: { id: "wrong", name: "Other" } })) as typeof fetch);
  await assert.rejects(provider.enrich(f.p), /exact matching/);
  const malformed = new RealApollo(
    "fictional-test-key",
    (async () => new Response("not json")) as typeof fetch,
  );
  await assert.rejects(malformed.search(criteria), /unavailable/);
});
test("concurrent identical search reserves one provider request across callers", async () => {
  const f = setup();
  let calls = 0;
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const source = new FixtureApollo();
  const provider = {
    search: async (s: typeof criteria) => {
      calls++;
      await hold;
      return source.search(s);
    },
    enrich: (p: Parameters<FixtureApollo["enrich"]>[0]) => source.enrich(p),
  };
  const first = searchProspects(
    f.db,
    md,
    "Petronik",
    "Main",
    criteria,
    provider,
  );
  await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(
    searchProspects(f.db, md, "Petronik", "Main", criteria, provider),
    /already running/,
  );
  release();
  await first;
  assert.equal(calls, 1);
});
