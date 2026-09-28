import { and, eq, gt, lt, desc, sql } from "drizzle-orm";
import type { Database } from "../d1";
import type { Actor } from "../domain";
import { CommercialError, unavailable } from "../commercial/model";
import { parent } from "../commercial/store";
import { requestIdentity } from "../execution/store";
import {
  apolloOperations as ops,
  apolloUsage as usage,
  apolloStages as stages,
  apolloSavedSearches as saved,
  apolloAccountCache as accounts,
  apolloGate as gates,
  apolloImports,
  contacts,
} from "../schema";
import {
  prospectScope,
  staged,
  importReview,
  reviewContext,
  importProspect,
  type ImportInput,
} from "./store";
import {
  searchInput,
  type SearchInput,
  type Prospect,
  type ProspectPage,
} from "./model";
import { ApolloError, type ApolloProvider } from "./provider";
import {
  creditPolicy,
  refsInput,
  type OperationData,
  type OperationView,
  type ProspectRef,
  type DatasetItem,
  type AccountUsage,
  type BulkResult,
} from "./operations-model";
const TEN = 10 * 60000,
  THIRTY = 30 * 60000;
const fail = (status: number, message: string): never => {
  throw new CommercialError(status, message);
};
export async function purgeApollo(db: Database) {
  await db.batch([
    db.delete(stages).where(lt(stages.expiresAt, new Date())),
    db
      .update(ops)
      .set({ data: null, status: "expired" })
      .where(and(lt(ops.expiresAt, new Date()), sql`${ops.data} IS NOT NULL`)),
    db
      .delete(usage)
      .where(lt(usage.createdAt, new Date(Date.now() - 90 * 86400000))),
  ]);
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    );
  return value;
}
async function hash(s: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function operation(db: Database, actor: Actor, id: string) {
  const row = await db
    .select()
    .from(ops)
    .where(and(eq(ops.id, id), eq(ops.actorId, actor.id)))
    .get();
  if (!row) throw unavailable();
  prospectScope(actor, row.company, row.branch);
  if (!row.data || row.expiresAt.getTime() <= Date.now())
    fail(
      410,
      "This request has expired. Start a new search or review the enrichment again.",
    );
  return { ...row, data: row.data! };
}
export async function readOperation(
  db: Database,
  actor: Actor,
  id: string,
): Promise<OperationView> {
  const r = await operation(db, actor, id);
  // A crashed in-flight request is NEVER reset to pending. Operator must reconcile provider usage.
  return {
    id: r.id,
    status:
      r.status === "running" && r.updatedAt.getTime() < Date.now() - 60000
        ? "unknown"
        : r.status,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    data: r.data,
  };
}
async function gate(db: Database) {
  const token = crypto.randomUUID(),
    now = Date.now();
  await db
    .insert(gates)
    .values({ id: "apollo", token: "", until: 0 })
    .onConflictDoNothing();
  const claimed = await db
    .update(gates)
    .set({ token, until: now + 60000 })
    .where(and(eq(gates.id, "apollo"), lt(gates.until, now)))
    .returning();
  if (!claimed.length) {
    const r = await db.select().from(gates).where(eq(gates.id, "apollo")).get();
    throw new ApolloError(
      429,
      "Another Apollo request is running or cooling down. Continue when ready.",
      Math.max(1, Math.ceil(((r?.until || now) - now) / 1000)),
    );
  }
  return token;
}
async function release(db: Database, token: string, seconds = 3) {
  await db
    .update(gates)
    .set({ until: Date.now() + Math.max(3, seconds) * 1000 })
    .where(and(eq(gates.id, "apollo"), eq(gates.token, token)));
}
export async function workspace(
  db: Database,
  actor: Actor,
  company: string,
  branch: string,
) {
  prospectScope(actor, company, branch);
  await purgeApollo(db);
  const scope = and(
    eq(saved.actorId, actor.id),
    eq(saved.company, company),
    eq(saved.branch, branch),
  );
  const searches = await db
    .select()
    .from(saved)
    .where(scope)
    .orderBy(desc(saved.updatedAt))
    .limit(30);
  const available = [];
  for (const s of searches) {
    if (s.productId) {
      try {
        await parent(db, actor, s.productId, ["products"]);
      } catch {
        continue;
      }
    }
    available.push(s);
  }
  const recent = await db
    .select({
      id: ops.id,
      status: ops.status,
      createdAt: ops.createdAt,
      expiresAt: ops.expiresAt,
      query: sql<
        string | null
      >`json_extract(${ops.data}, '$.criteria.discovery.query')`,
    })
    .from(ops)
    .where(
      and(
        eq(ops.actorId, actor.id),
        eq(ops.company, company),
        eq(ops.branch, branch),
        gt(ops.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(ops.createdAt))
    .limit(20);
  const log = await db
    .select()
    .from(usage)
    .where(
      and(
        eq(usage.actorId, actor.id),
        eq(usage.company, company),
        eq(usage.branch, branch),
      ),
    )
    .orderBy(desc(usage.createdAt))
    .limit(100);
  const account = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, "apollo"))
    .get();
  return {
    policy: creditPolicy,
    account: account?.data || null,
    saved: available,
    recent,
    usage: log,
  };
}
export async function refreshAccount(
  db: Database,
  actor: Actor,
  company: string,
  branch: string,
  provider: ApolloProvider,
) {
  prospectScope(actor, company, branch);
  const prior = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, "apollo"))
    .get();
  if (prior && prior.updatedAt.getTime() > Date.now() - 60000)
    return prior.data;
  if (!provider.account) fail(503, "Apollo usage access is unavailable.");
  const token = await gate(db);
  try {
    const data = await provider.account!();
    await db
      .insert(accounts)
      .values({ id: "apollo", data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: accounts.id,
        set: { data, updatedAt: new Date() },
      });
    return data;
  } finally {
    await release(db, token);
  }
}
export async function saveSearch(
  db: Database,
  actor: Actor,
  c: {
    company: string;
    branch: string;
    name: string;
    criteria: SearchInput;
    productId?: string;
    market: string;
  },
) {
  prospectScope(actor, c.company, c.branch);
  const criteria = searchInput.parse(c.criteria);
  if (c.productId) {
    const p = await parent(db, actor, c.productId, ["products"]);
    if (p.record.company !== c.company || p.record.branch !== c.branch)
      throw unavailable();
  }
  const count = await db
    .select({ n: sql<number>`count(*)` })
    .from(saved)
    .where(eq(saved.actorId, actor.id))
    .get();
  if ((count?.n || 0) >= 30)
    fail(400, "Keep up to 30 saved searches. Remove an old search first.");
  const id = crypto.randomUUID();
  await db
    .insert(saved)
    .values({ id, actorId: actor.id, ...c, criteria, updatedAt: new Date() });
  return { id };
}
export async function deleteSearch(db: Database, actor: Actor, id: string) {
  const r = await db
    .select()
    .from(saved)
    .where(and(eq(saved.id, id), eq(saved.actorId, actor.id)))
    .get();
  if (!r) throw unavailable();
  prospectScope(actor, r.company, r.branch);
  await db.delete(saved).where(eq(saved.id, id));
  return { ok: true };
}
export type PrepareInput = {
  requestId: string;
  company: string;
  branch: string;
  type: "search" | "enrich";
  criteria?: SearchInput;
  refs?: ProspectRef[];
  phones?: boolean;
};
export async function prepare(
  db: Database,
  actor: Actor,
  c: PrepareInput,
): Promise<OperationView> {
  prospectScope(actor, c.company, c.branch);
  const id = await requestIdentity(actor, "apollo-spend", c.requestId);
  const identity = JSON.stringify(
    stable({
      company: c.company,
      branch: c.branch,
      type: c.type,
      criteria: c.criteria ? searchInput.parse(c.criteria) : null,
      refs: c.refs || [],
      phones: !!c.phones,
    }),
  );
  const fingerprint = await hash(identity);
  const prior = await db.select().from(ops).where(eq(ops.id, id)).get();
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      fail(
        409,
        "This request identity belongs to different filters or prospects.",
      );
    return readOperation(db, actor, id);
  }
  const duplicate =
    c.type === "enrich"
      ? await db
          .select()
          .from(ops)
          .where(
            and(
              eq(ops.actorId, actor.id),
              eq(ops.company, c.company),
              eq(ops.branch, c.branch),
              eq(ops.fingerprint, fingerprint),
              sql`${ops.status} != 'failed'`,
              gt(ops.createdAt, new Date(Date.now() - THIRTY)),
              gt(ops.expiresAt, new Date()),
            ),
          )
          .get()
      : undefined;
  if (duplicate) return readOperation(db, actor, duplicate.id);
  const items: OperationData["items"] = [];
  const sourceOperationIds = new Set<string>();
  let criteria: SearchInput;
  if (c.type === "search") {
    criteria = searchInput.parse(c.criteria);
    if (
      !criteria.keywords &&
      !criteria.location &&
      !criteria.domain &&
      !criteria.titles &&
      !criteria.companySize &&
      !Object.values(criteria.advanced).some(Boolean)
    )
      fail(400, "Add filters before searching Apollo.");
  } else {
    const refs = refsInput.parse(c.refs);
    const seen = new Set<string>();
    let first: SearchInput | undefined;
    for (const ref of refs) {
      const { stage, prospect } = await staged(
        db,
        actor,
        ref.stageId,
        ref.providerId,
      );
      if (stage.company !== c.company || stage.branch !== c.branch)
        throw unavailable();
      for (const sourceId of stage.data.operationIds ||
        (stage.fingerprint.startsWith("operation:")
          ? [stage.fingerprint.slice(10)]
          : []))
        sourceOperationIds.add(sourceId);
      const key = `${prospect.kind}:${prospect.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (prospect.kind === "company" && !prospect.domain)
        fail(
          400,
          "Company enrichment requires a known domain. Review your selection.",
        );
      if (first && first.kind !== prospect.kind)
        fail(400, "Enrich companies and people separately.");
      first = stage.data.criteria;
      items.push({ ref, prospect, status: "pending" });
    }
    criteria = first!;
  }
  const account = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, "apollo"))
    .get();
  const data: OperationData = {
    type: c.type,
    kind: criteria.kind,
    criteria,
    items,
    phones: criteria.kind === "person" && !!c.phones,
    policy: creditPolicy,
    sourceOperationIds: [...sourceOperationIds],
    estimate:
      c.type === "search"
        ? criteria.kind === "company"
          ? creditPolicy.companySearch
          : 0
        : items.length *
          (criteria.kind === "company"
            ? creditPolicy.companyEnrich
            : creditPolicy.personEnrich +
              (c.phones ? creditPolicy.phoneAdditional : 0)),
    available:
      account && account.updatedAt.getTime() > Date.now() - TEN
        ? account.data.available
        : null,
  };
  const now = new Date(),
    expiresAt = new Date(Date.now() + THIRTY);
  await db
    .insert(ops)
    .values({
      id,
      actorId: actor.id,
      company: c.company,
      branch: c.branch,
      fingerprint,
      status: "prepared",
      data,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    })
    .onConflictDoNothing();
  return readOperation(db, actor, id);
}
function mergeEnrichment(
  original: Prospect,
  result: Prospect | null,
): Prospect {
  const at = new Date().toISOString();
  if (!result)
    return {
      ...original,
      enrichedAt: at,
      enrichmentStatus: "No additional data",
    };
  const next = { ...original };
  const provenance = { ...original.provenance };
  let changed = false;
  for (const [k, v] of Object.entries(result)) {
    if (
      k === "id" ||
      k === "kind" ||
      k === "enrichmentStatus" ||
      k === "provenance" ||
      k === "enrichedAt"
    )
      continue;
    if (v !== "" && v !== null && v !== undefined) {
      (next as unknown as Record<string, unknown>)[k] = v;
      if (v !== (original as unknown as Record<string, unknown>)[k])
        changed = true;
      if (typeof v === "string" && v)
        provenance[k] = { source: "Apollo", enrichedAt: at };
    }
  }
  next.enrichedAt = at;
  next.provenance = provenance;
  // 'Enriched' means a completed response with the selected useful fields, never entire Apollo completeness.
  next.enrichmentStatus = !changed
    ? "No additional data"
    : next.kind === "person" && (!next.email || !next.nameComplete)
      ? "Partially enriched"
      : next.kind === "company" && (!next.domain || !next.country)
        ? "Partially enriched"
        : "Enriched";
  return next;
}
export async function advance(
  db: Database,
  actor: Actor,
  id: string,
  confirmed: boolean,
  provider: ApolloProvider,
) {
  let r = await operation(db, actor, id);
  if (!confirmed)
    fail(400, "Review and confirm Apollo credit cost before continuing.");
  if (!["prepared", "paused"].includes(r.status))
    return readOperation(db, actor, id);
  if (r.data.retryAt && r.data.retryAt > Date.now())
    throw new ApolloError(
      429,
      "Wait until Apollo's retry time before continuing.",
      Math.ceil((r.data.retryAt - Date.now()) / 1000),
    );
  if (r.data.type === "enrich" && r.data.available === 0 && r.data.estimate > 0)
    fail(402, "Apollo credits exhausted. Normal CRM remains available.");
  const cache = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, "apollo"))
    .get();
  const isSearch = r.data.type === "search";
  const searchGateId = `apollo-search:${r.data.kind}`;
  if (isSearch) {
    const limit = await db
      .select()
      .from(gates)
      .where(eq(gates.id, searchGateId))
      .get();
    if (limit && limit.until > Date.now())
      throw new ApolloError(
        429,
        "Apollo rate limit reached.",
        Math.ceil((limit.until - Date.now()) / 1000),
      );
  }
  let cooldown = isSearch ? 0 : 3;
  if (!isSearch && cache && cache.updatedAt.getTime() > Date.now() - TEN) {
    const endpoint =
      r.data.type === "search"
        ? r.data.kind === "company"
          ? "mixed_companies"
          : "mixed_people"
        : r.data.kind === "company"
          ? "organizations"
          : "people";
    const action =
      r.data.type === "search"
        ? r.data.kind === "company"
          ? "search"
          : "api_search"
        : r.data.kind === "company"
          ? "bulk_enrich"
          : "bulk_match";
    for (const limit of cache.data.limits.filter(
      (l) => l.endpoint.includes(endpoint) && l.endpoint.includes(action),
    )) {
      const period =
        limit.window === "minute" ? 60 : limit.window === "hour" ? 3600 : 86400;
      if (limit.limit === 0 || limit.remaining === 0)
        throw new ApolloError(
          429,
          "Cached Apollo endpoint limit is exhausted. Refresh counters after the reset; no request was sent.",
          period,
        );
      if (limit.limit > 0)
        cooldown = Math.max(cooldown, Math.ceil(period / limit.limit));
    }
  }
  const token = isSearch ? null : await gate(db);
  try {
    const claimed = await db
      .update(ops)
      .set({ status: "running", version: r.version + 1, updatedAt: new Date() })
      .where(
        and(
          eq(ops.id, id),
          eq(ops.version, r.version),
          eq(ops.status, r.status),
        ),
      )
      .returning();
    if (!claimed.length) return readOperation(db, actor, id);
    r = { ...r, version: r.version + 1 };
    const data = structuredClone(r.data);
    data.confirmed = true;
    data.message = undefined;
    data.retryAt = undefined;
    const pending = data.items
      .filter((i) => i.status === "pending")
      .slice(0, 10);
    pending.forEach((i) => {
      i.status = "running";
    });
    await db.update(ops).set({ data }).where(eq(ops.id, id));
    const operationName =
      data.type === "search"
        ? `${data.kind === "company" ? "company" : "people"}_search`
        : `${data.items.length > 1 ? "bulk_" : ""}${data.kind}_enrichment`;
    const usageId = `${id}:${data.type === "search" ? 0 : data.items.filter((i) => i.status !== "pending").length}`;
    const estimate =
      data.type === "search"
        ? data.estimate
        : pending.length *
          (data.kind === "company"
            ? data.policy.companyEnrich
            : data.policy.personEnrich +
              (data.phones ? data.policy.phoneAdditional : 0));
    await db.insert(usage).values({
      id: usageId,
      operationId: id,
      actorId: actor.id,
      actorName: actor.name,
      company: r.company,
      branch: r.branch,
      operation: operationName,
      count: 0,
      estimatedCredits: estimate,
      status: "reserved; result not yet confirmed",
      createdAt: new Date(),
    });
    try {
      let page: ProspectPage;
      let actual: number | undefined;
      if (data.type === "search") {
        page = await provider.search(data.criteria);
        actual = page.actualCredits;
        if (page.prospects.length > data.criteria.perPage)
          throw new ApolloError(
            503,
            "Provider returned an oversized page. Charge unknown.",
            0,
            true,
          );
      } else {
        if (!provider.bulk)
          fail(503, "Native bulk enrichment is unavailable for this provider.");
        const result: BulkResult = await provider.bulk!(
          pending.map((i) => i.prospect),
          data.phones,
        );
        actual = result.actualCredits;
        for (const item of pending) {
          const found = result.items.find((i) => i.id === item.prospect.id);
          item.status = found?.status || "unknown";
          item.message =
            found?.message ||
            (!found
              ? "Provider omitted this item; do not repeat without checking usage."
              : undefined);
          if (found?.status === "succeeded" || found?.status === "no_data")
            item.prospect = mergeEnrichment(item.prospect, found.prospect);
          else item.prospect = { ...item.prospect, enrichmentStatus: "Failed" };
          if (
            data.phones &&
            item.status === "succeeded" &&
            !item.prospect.phone
          )
            item.prospect.enrichmentStatus = "Partially enriched";
        }
        if (result.phoneRequestId)
          data.phoneJobs = [
            ...(data.phoneJobs || []),
            {
              requestId: result.phoneRequestId,
              ids: pending.map((i) => i.prospect.id),
              done: false,
              retryAt: Date.now() + 15000,
            },
          ];
        page = {
          criteria: data.criteria,
          source: "Apollo",
          page: 1,
          hasMore: false,
          enriched: true,
          prospects: data.items.map((i) => i.prospect),
        };
      }
      if (actual !== undefined)
        data.actualCredits = (data.actualCredits || 0) + actual;
      data.actualComplete =
        data.actualComplete !== false && actual !== undefined;
      page.operationIds = [
        ...new Set([...(data.sourceOperationIds || []), id]),
      ];
      const stageId = data.resultStageId || crypto.randomUUID();
      data.resultStageId = stageId;
      for (const i of data.items)
        i.resultRef = { stageId, providerId: i.prospect.id };
      const hasPending = data.items.some((i) => i.status === "pending");
      await db.batch([
        db
          .insert(stages)
          .values({
            id: stageId,
            actorId: actor.id,
            company: r.company,
            branch: r.branch,
            fingerprint: `operation:${id}`,
            expiresAt:
              data.type === "search" ? new Date(Date.now() + TEN) : r.expiresAt,
            data: page,
          })
          .onConflictDoUpdate({ target: stages.id, set: { data: page } }),
        db
          .update(usage)
          .set({
            count:
              data.type === "search"
                ? page.prospects.length
                : pending.filter((i) => i.status === "succeeded").length,
            actualCredits: actual ?? null,
            status: pending.some(
              (i) => i.status === "failed" || i.status === "unknown",
            )
              ? "partial"
              : "completed",
          })
          .where(eq(usage.id, usageId)),
        db
          .update(ops)
          .set({
            data,
            status: hasPending ? "paused" : "completed",
            updatedAt: new Date(),
          })
          .where(eq(ops.id, id)),
      ]);
    } catch (e) {
      const uncertain =
        !(e instanceof CommercialError) ||
        (e instanceof ApolloError && e.uncertain);
      const retryAfter = e instanceof ApolloError ? e.retryAfter : 0;
      cooldown = isSearch ? retryAfter : Math.max(3, retryAfter);
      if (
        isSearch &&
        e instanceof ApolloError &&
        e.status === 429 &&
        retryAfter > 0
      ) {
        await db
          .insert(gates)
          .values({
            id: searchGateId,
            token: "",
            until: Date.now() + retryAfter * 1000,
          })
          .onConflictDoUpdate({
            target: gates.id,
            set: { until: Date.now() + retryAfter * 1000 },
          });
      }
      const msg =
        e instanceof CommercialError
          ? e.message
          : "The request outcome could not be recorded. Charge unknown; no automatic retry.";
      for (const item of pending) {
        item.status = uncertain ? "unknown" : "failed";
        item.prospect = { ...item.prospect, enrichmentStatus: "Failed" };
        item.message = msg;
      }
      data.message = msg;
      data.retryAt = cooldown > 0 ? Date.now() + cooldown * 1000 : undefined;
      data.actualComplete = false;
      if (data.type === "enrich") {
        const stageId = data.resultStageId || crypto.randomUUID();
        data.resultStageId = stageId;
        data.items.forEach((i) => {
          i.resultRef = { stageId, providerId: i.prospect.id };
        });
        const snapshot: ProspectPage = {
          criteria: data.criteria,
          source: "Apollo",
          page: 1,
          hasMore: false,
          prospects: data.items.map((i) => i.prospect),
          operationIds: [...new Set([...(data.sourceOperationIds || []), id])],
        };
        await db
          .insert(stages)
          .values({
            id: stageId,
            actorId: actor.id,
            company: r.company,
            branch: r.branch,
            fingerprint: `operation:${id}`,
            expiresAt: r.expiresAt,
            data: snapshot,
          })
          .onConflictDoUpdate({ target: stages.id, set: { data: snapshot } });
      }
      await db.batch([
        db
          .update(usage)
          .set({
            status: uncertain ? "unknown" : "rejected",
            actualCredits: uncertain ? null : 0,
          })
          .where(eq(usage.id, usageId)),
        db
          .update(ops)
          .set({
            data,
            status: uncertain ? "unknown" : "failed",
            updatedAt: new Date(),
          })
          .where(eq(ops.id, id)),
      ]);
    }
    return readOperation(db, actor, id);
  } finally {
    if (token) await release(db, token, cooldown);
  }
}
export async function retryFailed(
  db: Database,
  actor: Actor,
  id: string,
  requestId: string,
) {
  const r = await operation(db, actor, id);
  if (r.status === "running" || r.status === "unknown")
    fail(
      409,
      "An operation has an unknown charge. Reconcile Apollo usage before any new enrichment.",
    );
  if (r.data.retryAt && r.data.retryAt > Date.now())
    throw new ApolloError(
      429,
      "Wait before retrying failed items.",
      Math.ceil((r.data.retryAt - Date.now()) / 1000),
    );
  if (r.data.type === "search") {
    if (r.status !== "failed")
      fail(400, "Only a rejected search can be retried.");
    return prepare(db, actor, {
      requestId,
      company: r.company,
      branch: r.branch,
      type: "search",
      criteria: r.data.criteria,
    });
  }
  const failed = r.data.items.filter(
    (i) => i.status === "failed" || i.status === "pending",
  );
  if (!failed.length) fail(400, "There are no safely retryable items.");
  // Re-stage ONLY unsuccessful items from the reserved snapshot, without another provider call.
  const stageId = `retry-${await requestIdentity(actor, "apollo-retry", requestId)}`;
  await db
    .insert(stages)
    .values({
      id: stageId,
      actorId: actor.id,
      company: r.company,
      branch: r.branch,
      fingerprint: stageId,
      expiresAt: r.expiresAt,
      data: {
        criteria: r.data.criteria,
        source: "Apollo",
        page: 1,
        hasMore: false,
        prospects: failed.map((i) => i.prospect),
        operationIds: [...new Set([...(r.data.sourceOperationIds || []), id])],
      },
    })
    .onConflictDoNothing();
  return prepare(db, actor, {
    requestId,
    company: r.company,
    branch: r.branch,
    type: "enrich",
    refs: failed.map((i) => ({ stageId, providerId: i.prospect.id })),
    phones: r.data.phones,
  });
}
export async function stagedPage(db: Database, actor: Actor, stageId: string) {
  const r = await db
    .select()
    .from(stages)
    .where(
      and(
        eq(stages.id, stageId),
        eq(stages.actorId, actor.id),
        gt(stages.expiresAt, new Date()),
      ),
    )
    .get();
  if (!r) throw unavailable();
  prospectScope(actor, r.company, r.branch);
  return { stageId: r.id, ...r.data, expiresAt: r.expiresAt };
}
export async function dataset(
  db: Database,
  actor: Actor,
  refs: ProspectRef[],
): Promise<DatasetItem[]> {
  refsInput.parse(refs);
  const result: DatasetItem[] = [];
  const contexts = new Map<string, Awaited<ReturnType<typeof reviewContext>>>();
  const seen = new Set<string>();
  for (const ref of refs) {
    const { stage, prospect } = await staged(
      db,
      actor,
      ref.stageId,
      ref.providerId,
    );
    if (seen.has(`${prospect.kind}:${prospect.id}`)) continue;
    seen.add(`${prospect.kind}:${prospect.id}`);
    // A prior CRM link is not an authorization bypass if its owner/scope has since changed.
    const receipt = await db
      .select()
      .from(apolloImports)
      .where(
        and(
          eq(apolloImports.company, stage.company),
          eq(apolloImports.branch, stage.branch),
          eq(apolloImports.providerKind, prospect.kind),
          eq(apolloImports.providerId, prospect.id),
        ),
      )
      .get();
    if (receipt) {
      await parent(db, actor, receipt.customerId, ["customers"]);
      if (receipt.leadId) await parent(db, actor, receipt.leadId, ["leads"]);
      if (receipt.contactId) {
        const c = await db
          .select()
          .from(contacts)
          .where(eq(contacts.id, receipt.contactId))
          .get();
        if (!c || c.parentId !== receipt.customerId) throw unavailable();
      }
    }
    const key = JSON.stringify([stage.company, stage.branch]);
    if (!contexts.has(key))
      contexts.set(
        key,
        await reviewContext(db, actor, stage.company, stage.branch),
      );
    const review = await importReview(db, actor, ref.stageId, ref.providerId),
      exact = review.customers.filter((c) =>
        c.reasons.includes("Same Apollo company reference"),
      );
    result.push({
      ref,
      prospect,
      criteria: stage.data.criteria,
      imported: !!receipt,
      match: receipt?.contactId
        ? "Existing Contact"
        : receipt || exact.length === 1
          ? "Existing Customer"
          : review.customers.length
            ? "Possible Customer match"
            : "No match in checked records",
      customerId:
        receipt?.customerId || (exact.length === 1 ? exact[0].id : undefined),
      contactId: receipt?.contactId || undefined,
    });
  }
  return result;
}
export async function pollPhones(
  db: Database,
  actor: Actor,
  id: string,
  provider: ApolloProvider,
) {
  const r = await operation(db, actor, id);
  if (r.status === "running")
    fail(409, "Wait for the enrichment batch to finish.");
  const data = structuredClone(r.data),
    job = data.phoneJobs?.find((j) => !j.done);
  if (!job) return readOperation(db, actor, id);
  if (job.retryAt > Date.now())
    throw new ApolloError(
      429,
      "Phone results are still processing. Check again after the indicated time.",
      Math.ceil((job.retryAt - Date.now()) / 1000),
    );
  if (!provider.phoneResult)
    fail(503, "Phone result retrieval is unavailable.");
  const token = await gate(db);
  try {
    const result = await provider.phoneResult!(job.requestId);
    job.retryAt = Date.now() + Math.max(15, result.retryAfter) * 1000;
    if (!result.pending) {
      job.done = true;
      job.actualCredits = result.actualCredits;
      for (const p of result.phones) {
        const i = data.items.find(
          (i) => i.prospect.id === p.id && job.ids.includes(p.id),
        );
        if (i && p.phone)
          i.prospect = mergeEnrichment(i.prospect, {
            ...i.prospect,
            phone: p.phone,
            phoneType: p.type,
          });
      }
    }
    const observation = !result.pending
      ? [
          db
            .insert(usage)
            .values({
              id: `${id}:phone:${await hash(job.requestId)}`,
              operationId: id,
              actorId: actor.id,
              actorName: actor.name,
              company: r.company,
              branch: r.branch,
              operation: "person_phone_result",
              count: result.phones.filter((p) => p.phone).length,
              estimatedCredits: 0,
              actualCredits: result.actualCredits ?? null,
              status:
                "Phone-result observation only; may overlap initial enrichment charge. Not added to totals.",
              createdAt: new Date(),
            })
            .onConflictDoNothing(),
        ]
      : [];
    const write = db
      .update(ops)
      .set({ data, version: r.version + 1 })
      .where(and(eq(ops.id, id), eq(ops.version, r.version)));
    if (data.resultStageId)
      await db.batch([
        write,
        ...observation,
        db
          .update(stages)
          .set({
            data: {
              criteria: data.criteria,
              source: "Apollo",
              page: 1,
              hasMore: false,
              enriched: true,
              prospects: data.items.map((i) => i.prospect),
              operationIds: [
                ...new Set([...(data.sourceOperationIds || []), id]),
              ],
            },
          })
          .where(eq(stages.id, data.resultStageId)),
      ]);
    else await db.batch([write, ...observation]);
    return readOperation(db, actor, id);
  } finally {
    await release(db, token);
  }
}
