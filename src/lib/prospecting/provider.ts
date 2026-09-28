import {
  diagnosticEndpoint,
  diagnosticException,
  diagnosticErrorCode,
  emitApolloDiagnostic,
  type ApolloDiagnostic,
} from "./diagnostics";
import {
  searchInput,
  domainOf,
  type Prospect,
  type ProspectPage,
  type SearchInput,
} from "./model";
import { filters, splitList } from "./filters";
import type { BulkResult, AccountUsage, PhoneResult } from "./operations-model";
import { CommercialError } from "../commercial/model";
export interface ApolloProvider {
  search(input: SearchInput): Promise<ProspectPage>;
  enrich(p: Prospect): Promise<Prospect>;
  bulk?(prospects: Prospect[], phones: boolean): Promise<BulkResult>;
  account?(): Promise<AccountUsage>;
  phoneResult?(requestId: string): Promise<PhoneResult>;
}
export class ApolloError extends CommercialError {
  constructor(
    status: number,
    message: string,
    public readonly retryAfter = 0,
    public readonly uncertain = false,
  ) {
    super(status, message);
  }
}
const creditNumber = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
const safeUrl = (v: unknown) => {
  try {
    const u = new URL(String(v));
    return ["http:", "https:"].includes(u.protocol)
      ? u.toString().slice(0, 500)
      : "";
  } catch {
    return "";
  }
};
const text = (v: unknown, max = 300) =>
  typeof v === "string" ? v.slice(0, max) : "";
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export function normalizeProspect(
  value: unknown,
  kind: "company" | "person",
  enriched = false,
): Prospect | null {
  const p = object(value),
    org = kind === "company" ? p : object(p.organization),
    providerId = text(p.id, 100);
  if (!providerId) return null;
  const last = text(p.last_name);
  const complete = kind === "company" || !!text(p.name) || !!last;
  const name =
    kind === "company"
      ? text(p.name)
      : text(p.name) ||
        [text(p.first_name), last || text(p.last_name_obfuscated)]
          .filter(Boolean)
          .join(" ");
  const email = text(p.email, 200);
  return {
    id: providerId,
    kind,
    name,
    nameComplete: complete,
    companyId: kind === "company" ? providerId : text(org.id, 100),
    companyName: text(org.name),
    domain: domainOf(text(org.primary_domain) || text(org.website_url)),
    country: text(org.country) || text(p.country),
    industry: text(org.industry),
    size:
      typeof org.estimated_num_employees === "number"
        ? String(org.estimated_num_employees)
        : "",
    description: text(org.short_description, 1000),
    title: kind === "person" ? text(p.title) : "",
    email:
      enriched &&
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) &&
      !email.includes("email_not_unlocked")
        ? email
        : "",
    phone: enriched && kind === "company" ? text(org.phone, 50) : "",
    companyPhone: enriched ? text(org.phone, 50) : "",
    seniority: text(p.seniority, 100),
    profileUrl: safeUrl(p.linkedin_url),
    emailStatus: enriched ? text(p.email_status, 50) : "",
    enrichmentStatus: enriched ? "Partially enriched" : "Not enriched",
  };
}
export class RealApollo implements ApolloProvider {
  constructor(
    private key: string,
    private transport: typeof fetch = fetch,
  ) {}
  private async call(
    path: string,
    method: string,
    body: Record<string, unknown>,
  ) {
    if (!this.key)
      throw new CommercialError(
        503,
        "Apollo is not configured. CRM remains available.",
      );
    const started = performance.now();
    const diagnostic: ApolloDiagnostic = {
      endpoint: diagnosticEndpoint(path),
      upstreamStatus: null,
      errorCategory: null,
      errorCode: null,
      durationMs: 0,
      timeout: false,
      responseParse: "not_attempted",
      fetchException: null,
    };
    let phase: "fetch" | "response_read" | "parse" | "complete" = "fetch";
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 12000);
    try {
      const query =
        method === "GET"
          ? `?${new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]))}`
          : "";
      // Native Workers fetch must not receive this provider as its receiver.
      const transport = this.transport;
      const res = await transport(
        `https://api.apollo.io/api/v1/${path}${query}`,
        {
          method,
          headers: {
            "x-api-key": this.key,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: method === "GET" ? undefined : JSON.stringify(body),
          signal: controller.signal,
          redirect: "manual",
          cache: "no-store",
        },
      );
      diagnostic.upstreamStatus = res.status;
      phase = "response_read";
      // Never follow a redirect or forward the Apollo credential elsewhere.
      if (res.status >= 300 && res.status < 400) {
        diagnostic.errorCategory = "redirect_rejected";
        throw new ApolloError(
          503,
          "Apollo returned a redirect. It was not followed. Charge unknown; no automatic retry.",
          0,
          true,
        );
      }
      if (res.status === 404 && path.startsWith("webhook_result/")) {
        phase = "parse";
        const r = object(await res.json());
        diagnostic.responseParse = "success";
        diagnostic.errorCode = diagnosticErrorCode(r.error_code);
        phase = "complete";
        if (r.error_code === "result_pending")
          return {
            webhook_status: "in_progress",
            retry_after_seconds: creditNumber(r.retry_after_seconds) ?? 15,
          };
        throw new CommercialError(
          404,
          "Apollo no longer has this pending result. Do not resubmit enrichment without reviewing prior usage.",
        );
      }
      if (!res.ok) {
        diagnostic.errorCategory = `upstream_http_${res.status}`;
        // Bounded diagnostic-only read; never retain or log the raw body.
        try {
          const reader = res.body?.getReader();
          let raw = "";
          if (reader) {
            const decoder = new TextDecoder();
            while (raw.length <= 4096) {
              const chunk = await reader.read();
              if (chunk.done) break;
              raw += decoder.decode(chunk.value.subarray(0, 4097), {
                stream: true,
              });
            }
            void reader.cancel().catch(() => {});
          }
          if (raw.length <= 4096) {
            const errorBody = object(JSON.parse(raw));
            diagnostic.responseParse = "success";
            diagnostic.errorCode = diagnosticErrorCode(
              errorBody.error_code ??
                errorBody.code ??
                object(errorBody.error).code,
            );
          }
        } catch {
          diagnostic.responseParse = "failure";
        }
        phase = "complete";
        if (res.status === 429)
          throw new ApolloError(
            429,
            "Apollo rate limit reached.",
            Math.min(
              86400,
              Math.max(
                0,
                Number(res.headers.get("Retry-After")) ||
                  (Date.parse(res.headers.get("Retry-After") || "") -
                    Date.now()) /
                    1000 ||
                  0,
              ),
            ),
          );
        if (res.status === 401)
          throw new CommercialError(
            503,
            "Apollo credential is invalid. Ask an administrator to review the integration.",
          );
        if (res.status === 402)
          throw new CommercialError(
            503,
            "Apollo credits are exhausted. Review credit usage before trying again.",
          );
        if (res.status === 403)
          throw new CommercialError(
            503,
            "This Apollo action is restricted by the account plan or API permissions.",
          );
        throw new ApolloError(
          503,
          "Apollo is unavailable. The charge may be unknown; this request will not be repeated automatically.",
          0,
          true,
        );
      }
      const raw = await res.text();
      if (raw.length > 2000000)
        throw new ApolloError(
          503,
          "Apollo returned too much data. Charge unknown; no automatic retry.",
          0,
          true,
        );
      phase = "parse";
      const parsed = object(
        JSON.parse(
          raw.replace(/("request_id"\s*:\s*)(-?\d+)(?=\s*[,}])/g, '$1"$2"'),
        ),
      );
      diagnostic.responseParse = "success";
      phase = "complete";
      return parsed;
    } catch (e) {
      if (phase === "parse") diagnostic.responseParse = "failure";
      if (e instanceof CommercialError) {
        diagnostic.errorCategory ||= "provider_rejection";
        throw e;
      }
      diagnostic.errorCategory = controller.signal.aborted
        ? "timeout"
        : phase === "parse"
          ? "response_parse_failure"
          : phase === "fetch"
            ? "fetch_exception"
            : "response_read_exception";
      diagnostic.fetchException =
        phase === "parse" ? null : diagnosticException(e);
      throw new ApolloError(
        503,
        controller.signal.aborted
          ? "Apollo timed out. Charge unknown; no automatic retry."
          : "Apollo is unavailable. Charge unknown; no automatic retry.",
        0,
        true,
      );
    } finally {
      clearTimeout(timer);
      diagnostic.durationMs = Math.round(performance.now() - started);
      diagnostic.timeout = controller.signal.aborted;
      emitApolloDiagnostic(diagnostic);
    }
  }
  async search(raw: SearchInput): Promise<ProspectPage> {
    const s = searchInput.parse(raw),
      args: Record<string, unknown> = { page: s.page, per_page: s.perPage };
    for (const f of filters) {
      if (f.mode && f.mode !== s.kind) continue;
      const value =
        (["keywords", "location", "domain", "titles"].includes(f.key)
          ? s[f.key as "keywords" | "location" | "domain" | "titles"]
          : s.advanced[f.key]) || "";
      if (!value) continue;
      const key =
        f.key === "keywords" && s.kind === "company"
          ? "q_organization_keyword_tags"
          : f.api;
      if (f.key === "domain") {
        const domains = splitList(value).map(domainOf);
        if (domains.some((d) => !d))
          throw new CommercialError(400, "Enter valid company domains.");
        args[key] = domains;
      } else if (f.key === "employeeRanges")
        args[key] = value.split(";").map((v) => v.trim());
      else
        args[key] =
          f.type === "number"
            ? Number(value)
            : f.type === "list" ||
                (f.key === "keywords" && s.kind === "company")
              ? splitList(value)
              : value;
    }
    if (s.companySize && !args.organization_num_employees_ranges)
      args.organization_num_employees_ranges = [s.companySize];
    if (s.kind === "person") {
      args.include_similar_titles = s.similarTitles;
      if (s.seniority && !args.person_seniorities)
        args.person_seniorities = [s.seniority];
    }
    const data = await this.call(
      s.kind === "company"
        ? "mixed_companies/search"
        : "mixed_people/api_search",
      "POST",
      args,
    );
    const values = data[s.kind === "company" ? "organizations" : "people"];
    const prospects = (Array.isArray(values) ? values : [])
      .slice(0, s.perPage)
      .map((p) => normalizeProspect(p, s.kind))
      .filter((p): p is Prospect => !!p);
    const pagination = object(data.pagination),
      total = Number(data.total_entries ?? pagination.total_entries);
    return {
      prospects,
      page: s.page,
      hasMore:
        s.page < 500 &&
        (Number.isFinite(total)
          ? s.page * s.perPage < Math.min(total, 50000)
          : prospects.length === s.perPage),
      total: Number.isFinite(total) && total >= 0 ? total : undefined,
      actualCredits: creditNumber(data.credits_consumed),
      criteria: s,
      source: "Apollo",
    };
  }
  async bulk(prospects: Prospect[], phones = false): Promise<BulkResult> {
    if (
      !prospects.length ||
      prospects.length > 10 ||
      prospects.some((p) => p.kind !== prospects[0].kind)
    )
      throw new CommercialError(
        400,
        "Use up to 10 prospects of one type per request.",
      );
    const kind = prospects[0].kind;
    const data = await this.call(
      kind === "company" ? "organizations/bulk_enrich" : "people/bulk_match",
      "POST",
      kind === "company"
        ? { details: prospects.map((p) => ({ domain: p.domain })) }
        : {
            details: prospects.map((p) => ({ id: p.id })),
            reveal_personal_emails: false,
            reveal_phone_number: phones,
            poll_only: phones,
            run_waterfall_email: false,
            run_waterfall_phone: false,
          },
    );
    if (data.status && data.status !== "success")
      throw new ApolloError(
        503,
        "Apollo did not confirm this enrichment. Charge unknown; no automatic retry.",
        0,
        true,
      );
    const values = data[kind === "company" ? "organizations" : "matches"];
    if (!Array.isArray(values))
      throw new ApolloError(
        503,
        "Apollo returned an incomplete response. Charge unknown.",
        0,
        true,
      );
    const normalized = values
      .map((v) => normalizeProspect(v, kind, true))
      .filter((p): p is Prospect => !!p);
    return {
      items: prospects.map((p) => {
        const match = normalized.find((v) => v.id === p.id);
        // No fuzzy replacement of a staged identity, even when Apollo returns a similar domain.
        return {
          id: p.id,
          prospect: match || null,
          status: match ? "succeeded" : "no_data",
        };
      }),
      actualCredits: creditNumber(data.credits_consumed),
      phoneRequestId:
        phones && /^-?\d+$/.test(String(data.request_id))
          ? String(data.request_id)
          : undefined,
    };
  }
  async account(): Promise<AccountUsage> {
    const result: AccountUsage = {
      checkedAt: new Date().toISOString(),
      available: null,
      used: null,
      allowance: null,
      cycleStart: null,
      cycleEnd: null,
      limits: [],
      source:
        "External Apollo lead/shared credit counter; other buckets are not summed",
    };
    try {
      const r = await this.call("usage_stats/credit_usage_stats", "POST", {}),
        c = object(object(r.credit_usage_stats).lead_credit),
        cycle = object(r.current_credit_cycle);
      result.available = creditNumber(c.left_over) ?? null;
      result.used = typeof c.consumed === "number" ? c.consumed : null;
      result.allowance = creditNumber(c.limit) ?? null;
      result.cycleStart = text(cycle.start_date, 40) || null;
      result.cycleEnd = text(cycle.end_date, 40) || null;
    } catch (e) {
      result.creditError =
        e instanceof CommercialError ? e.message : "Credit counter unavailable";
    }
    try {
      const r = await this.call("usage_stats/api_usage_stats", "POST", {});
      for (const [endpoint, raw] of Object.entries(r)) {
        if (!/mixed_companies|mixed_people|organizations|people/.test(endpoint))
          continue;
        for (const window of ["minute", "hour", "day"]) {
          const v = object(object(raw)[window]);
          if (creditNumber(v.limit) !== undefined)
            result.limits.push({
              endpoint: endpoint.slice(0, 150),
              window,
              limit: Number(v.limit),
              remaining: creditNumber(v.left_over) ?? null,
            });
        }
      }
    } catch (e) {
      result.limitsError =
        e instanceof CommercialError ? e.message : "API limits unavailable";
    }
    return result;
  }
  async phoneResult(requestId: string): Promise<PhoneResult> {
    if (!/^-?\d+$/.test(requestId))
      throw new CommercialError(400, "Invalid pending result identity");
    const r = await this.call(`webhook_result/${requestId}`, "GET", {}),
      body = object(r.webhook_result);
    if (!r.webhook_result || r.webhook_status === "in_progress")
      return {
        pending: true,
        retryAfter: creditNumber(r.retry_after_seconds) ?? 15,
        phones: [],
      };
    const people = Array.isArray(body.people) ? body.people : [];
    return {
      pending: false,
      retryAfter: 0,
      actualCredits: creditNumber(body.credits_consumed),
      phones: people.map((v) => {
        const p = object(v),
          ns = Array.isArray(p.phone_numbers) ? p.phone_numbers : [];
        const n = object(
          ns.find(
            (n) =>
              object(n).type_cd === "work" ||
              object(n).type_cd === "work_direct",
          ),
        );
        return {
          id: text(p.id, 100),
          phone: text(n.sanitized_number, 50) || text(n.raw_number, 50),
          type: text(n.type_cd, 50),
        };
      }),
    };
  }
  async enrich(p: Prospect) {
    const result =
      p.kind === "company"
        ? await this.call("organizations/enrich", "GET", { domain: p.domain })
        : await this.call("people/match", "POST", {
            id: p.id,
            reveal_personal_emails: false,
            reveal_phone_number: false,
            run_waterfall_email: false,
            run_waterfall_phone: false,
          });
    const normalized = normalizeProspect(
      p.kind === "company" ? result.organization : result.person,
      p.kind,
      true,
    );
    if (!normalized || normalized.id !== p.id)
      throw new CommercialError(
        409,
        "Apollo returned no exact matching identity. Nothing was changed.",
      );
    return normalized;
  }
}
export async function apolloProvider(): Promise<ApolloProvider> {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const env = (await getCloudflareContext({ async: true })).env as unknown as {
    APOLLO_API_KEY?: string;
    APOLLO_TEST?: { fetch: typeof fetch };
    APP_URL?: string;
  };
  // Only the local test entry can supply this service binding. No request flag selects a fake.
  if (
    env.APOLLO_TEST &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(env.APP_URL || "")
  ) {
    const transport = env.APOLLO_TEST;
    const fixture = async <T>(path: string, body: unknown): Promise<T> => {
      const r = await transport.fetch(`https://fixture/${path}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const d = (await r.json()) as T & {
        error?: string;
        retryAfter?: number;
        uncertain?: boolean;
      };
      if (!r.ok)
        throw new ApolloError(
          r.status,
          d.error || "Fictional provider error",
          d.retryAfter,
          d.uncertain,
        );
      return d;
    };
    return {
      bulk: (prospects, phones) =>
        fixture<BulkResult>("bulk", { prospects, phones }),
      account: () => fixture<AccountUsage>("account", {}),
      phoneResult: (requestId) => fixture<PhoneResult>("phone", { requestId }),
      search: async (input) => {
        const r = await transport.fetch("https://fixture/search", {
          method: "POST",
          body: JSON.stringify(input),
        });
        if (!r.ok) {
          const e = (await r.json()) as { error: string };
          throw new CommercialError(r.status, e.error);
        }
        return r.json() as Promise<ProspectPage>;
      },
      enrich: async (p) => {
        const r = await transport.fetch("https://fixture/enrich", {
          method: "POST",
          body: JSON.stringify(p),
        });
        if (!r.ok) {
          const e = (await r.json()) as { error: string };
          throw new CommercialError(r.status, e.error);
        }
        return r.json() as Promise<Prospect>;
      },
    };
  }
  return new RealApollo(env.APOLLO_API_KEY || "");
}
