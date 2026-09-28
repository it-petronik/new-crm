# Phase 7 Apollo workspace — local release hold

This extends Prospecting only. BusinessRecord/Contact/Lead/Deal remain the reviewed CRM authorities. Supplier sourcing, RFQs, Offers, revisions, scenarios, costing and quotation approval retain their existing implementations. No outbound communication, sequence enrollment, R2 or Phase 8 was added.

## Provider contract and pricing

Public Apollo OpenAPI and reference pages reviewed 2026-09-28:
- https://docs.apollo.io/reference/organization-search
- https://docs.apollo.io/reference/people-api-search
- https://docs.apollo.io/reference/bulk-organization-enrichment
- https://docs.apollo.io/reference/bulk-people-enrichment
- https://docs.apollo.io/reference/view-credit-usage-stats
- https://docs.apollo.io/reference/view-api-usage-stats
- https://docs.apollo.io/reference/poll-webhook-result
- https://docs.apollo.io/docs/api-pricing

The allowlisted filter catalog maps separately to each endpoint. Industry is returned information, not an undocumented industry-ID filter. Explicit pages support 25, 50 or 100 results within Apollo's 500-page/50,000-result display limits. The employee selects a page, never the entire result universe.

Prices are dated, centrally defined server estimates, copied into each confirmation. Apollo's documented credit-usage API reports balances, not a dynamic price catalog. Current standard assumptions are 1 credit/company search page, up to 1/organization enrichment and up to 1/person without phone lookup. Optional native phone lookup has an 8-credit additional allowance/person; legacy plans and returned data can affect the charge. Actual credits are recorded only from explicit provider credit fields. Phone-result observations are presented separately to avoid double counting overlapping provider responses.

Single and multi-item enrichment use native bulk endpoints, maximum 10 records/request, preserving exact staged identities. Personal-email reveal and third-party waterfall are off. Native phone lookup uses `poll_only`; signed 64-bit request IDs remain strings. Phone results are retrieved only on explicit user request. Only numbers Apollo explicitly classifies as work/work_direct enter a business-phone field; other returned numbers may still incur provider billing and are not retained.

The prior Basic plan review is historical. No account-specific paid endpoint or real key was used during this expansion. Bulk and usage endpoint scopes must be enabled on the eventual live key. Scope/plan denials remain visible; the app does not infer an upgrade is required from a generic denial.

## Spend, retention and concurrency

`0015_apollo_workspace.sql` adds ApolloOperation, ApolloUsage, ApolloSavedSearch, ApolloAccountCache and ApolloGate. All are additive; 0014 is unchanged. Only the isolated local review database was migrated.

A prepared operation reserves a durable, actor-bound request identity and immutable cost/snapshot before any provider call. Confirmation claims it using a version guard. Same-identity retries cannot intentionally call Apollo twice; a changed payload under the same identity is rejected. Fresh identical requests can reuse a short-lived operation. Native chunks run serially behind a D1-wide gate, with a minimum 3-second cooldown and stricter fresh account limits where reported. There are no automatic retries of rejected/uncertain provider calls.

Each chunk logs its reservation before network I/O. A timeout, malformed/oversized successful response, persistence uncertainty or crash leaves an unknown result; a running request older than one minute displays reconciliation guidance and is never reset to pending. The app cannot guarantee provider-side exactly-once billing after a transport failure; it deliberately refuses to repeat the same operation identity. Failed-item retries require a new reviewed confirmation and exclude successful/no-data/unknown items.

Regular search result staging lasts 10 minutes. An explicit operation reserves only its bounded selection (up to 100 prospects) for 30 minutes so a review or chunk does not expire halfway through. Access enforces expiry immediately. Workspace access and the existing cleanup schedule purge expired payloads; the small spend receipt/hash survives without prospect data. Usage metadata is retained for 90 days. Saved filters contain no results. Account counters are cached for 10 minutes and fetched only by an explicit refresh. The lead/shared counter is labeled as external and is never added to unreliable phone buckets.

## Reviewed CRM import, export and report

Each item independently rechecks role, scope, parent access and duplicates. Possible matches require employee review; only exact Apollo organization identity can group confirmed new Customer creations within a bulk import. Ambiguous or invalid items do not prevent valid peers from importing. The existing unique ApolloImport receipt prevents repeat creation across request identities, and existing record writes preserve optimistic version guards. Customer-only, Contact, Lead and optional Deal choices are separate. A previous completed import reopens its existing records; it does not create extra Leads on replay.

Applying enrichment to an existing Customer/Contact remains an explicit current-versus-suggested, selected-field action. Empty provider values cannot erase CRM data. Enriched fields carry minimal Apollo/time provenance while staged. “Enriched” describes successful selected data retrieval, not completeness of Apollo's database. Unknown or absent emails/phones are never fabricated.

CSV, XLSX and deterministic reports reauthorize staged ownership, scope and current CRM-linked parent/Lead/Contact access on the server. They do not accept client-supplied prospect payloads, call Apollo, use AI or include buy costs, API keys or raw provider responses. CSV formula prefixes are escaped; XLSX uses inline text cells without formulas, macros or external links. Four workbook sheets expose Prospects, Companies, People and Summary with filters, a frozen top row, typed dates and readable widths. Counts describe the staged selection; CRM matching is bounded to 1,000 authorized Customers and 5,000 scoped Contacts and is labeled accordingly. Credits shown on a selection report are whole related operations, not fictitious per-prospect allocations.

Reports are browser-printable without R2. Saved searches load structured filters and Product/market context without execution. Product and Lead/Deal entry points continue to prefill context only. Recent operations are short-lived recovery history, not permanently retained prospect history. Sequences and AI narrative were intentionally omitted as optional features.

## Local verification

Run only `tests/phase7-apollo.test.ts`, `tests/phase7-apollo-workspace.test.ts` and `playwright.apollo.config.ts`, plus typecheck and Cloudflare build. `APOLLO_REVIEW_SERVER=1` uses the existing local fake-provider review server without resetting its data. The normal focused browser configuration starts a fictional no-R2 server. No historical Phase 1–6 or unaffected sourcing/costing regression is required for this change.

The recovery validator gains an explicit `phase7-apollo` profile for schema through 0015; its existing phase7 profile remains through 0014. Backups/restores of a future approved 0015 deployment must select the new profile. Do not run production migrations or release this candidate without a separate release instruction.

## Search-first AI interpretation upgrade — local only

Prospecting opens with a natural-language query field and examples; examples and typing are passive. An explicit submit calls the existing Workers AI gateway with one primary-model attempt, no automatic fallback and no AI cache. Existing per-person/global AI limits and metadata-only usage logging apply. The new `prospecting` feature identifies that usage. Existing AI features keep their prior fallback/cache behavior.

The interpreter receives only the bounded employee query, never CRM data. JSON output has an intent, bounded key/value filter list and five permitted role groups. Unknown/mode-incompatible filters are omitted with visible notices; invalid supported values and malformed output are rejected. The existing `searchInput` validates the final criteria. Exact allowlisted provider mapping remains authoritative: query/provenance metadata never becomes an Apollo HTTP parameter. Manual field overrides (including removals), page size and similar-title preference survive reinterpretation. The original query, suggested roles and unsupported-filter notices travel in optional structured criteria metadata through saved searches, stages and deterministic reports; no schema migration was needed.

The UI presents potential keyword matches, never verified importers. Advanced filters are available in a side drawer or full-width phone sheet. Applying filters does not execute Apollo; Search Apollo opens the existing credit reservation/confirmation. Company decision-maker actions map role groups to supported titles and exact Apollo organization IDs, then require the same explicit search. Company and people result tabs retain their current local staged views. Single enrichment updates its card while preserving other staged results; the earliest displayed expiry remains authoritative for mixed stages.

AI failures leave manual Apollo search available. No conversational chatbot or optional AI report narrative was added. All verification uses FakeAi/FakeApollo and includes seven requested commercial queries, unsupported filters, invalid output, one-attempt failure, injection, role/scope denial, manual override and the responsive UI. Live model interpretation quality remains unverified by fictional outputs. Release remains HOLD.

## One-action search correction (28 September 2026)

This section supersedes the earlier search review flow. Enter/Search interprets a changed natural-language query, validates allowlisted criteria and performs one Apollo search. Manual filters and saved searches run without AI; interpretation service failures fall back to a supported keyword query. Authorization failures and unsupported-action interpretation do not fall back. Nothing calls AI or Apollo on passive navigation.

Search cost appears inline: approximately 1 credit per company page, 0 search credits for people. Ordinary search never opens CreditDialog. Each explicit search creates a fresh request identity; an atomic operation claim prevents replay of that identity. Identical filters under a new identity are legitimate searches. An unknown prior charge does not block future searches. Search honors only actual provider Retry-After timing; enrichment keeps its existing reservation, review and duplicate protection. Staging retention is unchanged and does not lock search.

Native Workers fetch must be invoked as a standalone function, never as `this.transport(...)`; workerd rejects the latter receiver before dispatch. The provider uses the documented zero-credit `usage_stats/credit_usage_stats` endpoint for lead/shared-pool balance, consumed amount and billing-cycle dates. Separate endpoint rate limits come from `usage_stats/api_usage_stats`. No bucket summing or hard-coded balance. Explicit account refresh is cached for 60 seconds; balance absence does not block search. Internal operation estimates/observations stay separate from Apollo's account counter.

Targeted verification: three Phase 7 Apollo/AI unit suites, `playwright.apollo.config.ts` with the fictional provider, typecheck, Cloudflare build, exact-candidate secret and whitespace review. No historical CRM, sourcing or costing suites are required by this change. Production release and one bounded company search are authorized by the current user brief; preview follows only a successful LIVE search.
