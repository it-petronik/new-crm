import { performance } from "node:perf_hooks";
import { writeFileSync, mkdirSync } from "node:fs";
import { setup, md, offer, scenario } from "../tests/support/phase7";
import { FixtureApollo } from "../tests/support/fake-apollo";
import { searchInput } from "../src/lib/prospecting/model";
import {
  searchProspects,
  importReview,
  importProspect,
} from "../src/lib/prospecting/store";
import { executionView, sourcingCandidates } from "../src/lib/execution/store";
import { calculateScenario, comparisonKey } from "../src/lib/execution/model";
async function main() {
  const f = setup(),
    provider = new FixtureApollo();
  f.sqlite.exec("BEGIN");
  f.record("perf-product", "products");
  for (let i = 0; i < 1000; i++) {
    f.record(`perf-customer-${i}`, "customers", {
      title: `Fictional petroleum customer ${i}`,
      attributes: { website: `customer-${i}.example` },
    });
    f.record(`perf-supplier-${i}`, "suppliers", {
      title: `Fictional industrial supplier ${i}`,
    });
    f.record(`perf-lead-${i}`, "leads", {
      customerId: `perf-customer-${i}`,
      productId: "perf-product",
    });
    f.sqlite
      .prepare(
        "INSERT INTO Contact(id,parentId,company,branch,details,active,version,createdAt,updatedAt) VALUES(?,?,?,?,?,1,1,1,1)",
      )
      .run(
        `perf-contact-${i}`,
        `perf-customer-${i}`,
        "Petronik",
        "Main",
        JSON.stringify({
          name: `Buyer ${i}`,
          email: `buyer${i}@example.test`,
          phone: "",
          country: "UAE",
          active: true,
        }),
      );
    f.sqlite
      .prepare(
        "INSERT INTO Deal(id,leadId,company,branch,createdAt) VALUES(?,?,?,?,1)",
      )
      .run(`perf-deal-${i}`, `perf-lead-${i}`, "Petronik", "Main");
    f.sqlite
      .prepare(
        "INSERT INTO SupplierProductCapability(id,supplierId,productId,company,branch,details,active,version,createdAt,updatedAt) VALUES(?,?,?,?,?,?,1,1,1,1)",
      )
      .run(
        `perf-cap-${i}`,
        `perf-supplier-${i}`,
        "perf-product",
        "Petronik",
        "Main",
        JSON.stringify({ grade: "SN500", originCountry: "UAE", active: true }),
      );
    const base = [
      `perf-candidate-${i}`,
      `perf-deal-${i}`,
      `perf-supplier-${i}`,
      "perf-product",
      "Petronik",
      "Main",
      "Candidate",
      md.id,
    ];
    f.sqlite
      .prepare(
        "INSERT INTO DealSupplier(id,dealId,supplierId,productId,company,branch,status,version,createdBy,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,1,?,1,1)",
      )
      .run(...base);
    f.sqlite
      .prepare(
        "INSERT INTO SupplierRFQ(id,dealId,supplierId,productId,company,branch,status,version,createdBy,createdAt,updatedAt,details) VALUES(?,?,?,?,?,?,?,1,?,1,1,?)",
      )
      .run(
        `perf-rfq-${i}`,
        `perf-deal-${i}`,
        `perf-supplier-${i}`,
        "perf-product",
        "Petronik",
        "Main",
        "Draft",
        md.id,
        JSON.stringify({ quantity: "20", unit: "MT" }),
      );
    for (let rev = 1; rev <= 2; rev++) {
      if (rev === 2)
        f.sqlite
          .prepare("UPDATE SupplierOffer SET status='Superseded' WHERE id=?")
          .run(`perf-offer-${i}-1`);
      f.sqlite
        .prepare(
          "INSERT INTO SupplierOffer(id,dealId,supplierId,productId,company,branch,status,version,createdBy,createdAt,updatedAt,details,seriesId,revision,previousId,rfqId) VALUES(?,?,?,?,?,?,?,1,?,1,1,?,?,?,?,?)",
        )
        .run(
          `perf-offer-${i}-${rev}`,
          `perf-deal-${i}`,
          `perf-supplier-${i}`,
          "perf-product",
          "Petronik",
          "Main",
          "Received",
          md.id,
          JSON.stringify(offer),
          `perf-offer-${i}-1`,
          rev,
          rev === 1 ? null : `perf-offer-${i}-1`,
          `perf-rfq-${i}`,
        );
    }
    f.sqlite
      .prepare(
        "INSERT INTO CommercialScenario(id,dealId,supplierId,productId,company,branch,status,version,createdBy,createdAt,updatedAt,offerId,details) VALUES(?,?,?,?,?,?,?,1,?,1,1,?,?)",
      )
      .run(
        `perf-scenario-${i}`,
        `perf-deal-${i}`,
        `perf-supplier-${i}`,
        "perf-product",
        "Petronik",
        "Main",
        "Draft",
        md.id,
        `perf-offer-${i}-2`,
        JSON.stringify({
          ...scenario,
          fxActor: md.id,
          fxEnteredAt: new Date().toISOString(),
        }),
      );
  }
  f.sqlite.exec("COMMIT");
  const times: Record<string, number> = {};
  async function timed<T>(name: string, fn: () => Promise<T> | T) {
    const t = performance.now();
    const v = await fn();
    times[name] = Number((performance.now() - t).toFixed(2));
    return v;
  }
  const input = searchInput.parse({ kind: "company", keywords: "performance" });
  const page = await timed("prospecting_fake_search_ms", () =>
    searchProspects(f.db, md, "Petronik", "Main", input, provider),
  );
  await timed("prospecting_cached_search_ms", () =>
    searchProspects(f.db, md, "Petronik", "Main", input, provider),
  );
  await timed("prospect_dedupe_review_ms", () =>
    importReview(f.db, md, page.stageId, page.prospects[0].id),
  );
  const lead = JSON.parse(
    String(
      f.sqlite
        .prepare("SELECT payload FROM BusinessRecord WHERE id='perf-lead-0'")
        .get()!.payload,
    ),
  );
  await timed("supplier_matching_ms", () => sourcingCandidates(f.db, md, lead));
  const view = await timed("deal_sourcing_ms", () =>
    executionView(f.db, md, "perf-deal-0"),
  );
  await timed("offer_comparison_2000_ms", () => {
    const groups = new Map<string, number>();
    for (let i = 0; i < 2000; i++) {
      const k = comparisonKey(offer);
      groups.set(k, (groups.get(k) || 0) + 1);
    }
    return groups;
  });
  await timed("scenario_calculation_1000_ms", () => {
    for (let i = 0; i < 1000; i++) calculateScenario(scenario, offer);
  });
  await importProspect(f.db, md, {
    stageId: page.stageId,
    providerId: page.prospects[0].id,
    requestId: "perf-import",
    companyName: page.prospects[0].name,
    createAnyway: true,
  });
  const counts = Object.fromEntries(
    [
      "BusinessRecord",
      "Contact",
      "Deal",
      "SupplierProductCapability",
      "DealSupplier",
      "SupplierRFQ",
      "SupplierOffer",
      "CommercialScenario",
      "ApolloStage",
      "ApolloImport",
    ].map((t) => [
      t,
      Number(f.sqlite.prepare(`SELECT count(*) n FROM ${t}`).get()!.n),
    ]),
  );
  const result = {
    runtime:
      "node:sqlite through Drizzle D1 adapter; fictional local data; not network latency",
    counts,
    times,
    visibleOffers: view.offers.length,
    integrity: f.sqlite.prepare("PRAGMA integrity_check").all(),
    foreignKeys: f.sqlite.prepare("PRAGMA foreign_key_check").all(),
  };
  mkdirSync("work/phase7", { recursive: true });
  writeFileSync(
    "work/phase7/performance.json",
    JSON.stringify(result, null, 2),
  );
  // Fixture export used only by the targeted Phase 7 recovery test.
  const sqlRows = [];
  for (const table of [
    "BusinessRecord",
    "Contact",
    "Deal",
    "SupplierProductCapability",
    "DealSupplier",
    "SupplierRFQ",
    "SupplierOffer",
    "CommercialScenario",
    "ApolloStage",
    "ApolloImport",
  ]) {
    const cols = f.sqlite
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((r) => String(r.name));
    for (const row of f.sqlite.prepare(`SELECT * FROM ${table}`).all()) {
      const quote = (v: unknown) =>
        v == null
          ? "NULL"
          : typeof v === "number"
            ? String(v)
            : `'${String(v).replaceAll("'", "''")}'`;
      sqlRows.push(
        `INSERT INTO "${table}"(${cols.map((c) => `"${c}"`).join(",")}) VALUES(${cols.map((c) => quote(row[c])).join(",")});`,
      );
    }
  }
  writeFileSync("work/phase7/fictional-data.sql", sqlRows.join("\n"));
  console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
