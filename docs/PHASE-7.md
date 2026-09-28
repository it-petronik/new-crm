# Phase 7: local implementation and operating contract

Status: local candidate for review. No commit, push, deployment, production migration, R2 activation, sequences or Phase 8 work is authorized by this document.

## Architecture

BusinessRecord remains authoritative for Customer, Product, Supplier, Lead, Quotation and Order. Contact, Deal and SupplierProductCapability are reused. A Deal is still the single room attached to its originating Lead. Lead fields own the requirement, stage, owner and next follow-up.

Migration `0014_deal_execution.sql` adds DealSupplier, SupplierRFQ, immutable-revision SupplierOffer, CommercialScenario, temporary ApolloStage and ApolloImport receipts. No Phase 1–6 migration is edited. No PriceObservation table is needed: offers, scenarios and existing quotations already supply clearly labelled internal commercial history.

RFQs are Draft → Prepared → Sent externally → Responded → Closed. Sending is a human-recorded external action; Enercore does not send or enroll anyone. Sent RFQ terms are preserved; prepare another round for changes. Supplier offers retain all revisions; a unique series/revision and current-series index prevent concurrent duplicate V2s. Scenario inputs become immutable on review. Selection is explicit, with at most one selected scenario per Deal. D1 batches combine guards, writes and audit events.

## Apollo

The server-only provider reads `APOLLO_API_KEY` from the Worker environment. Never put the value in a public environment variable, source, browser, log, fixture, response or configuration committed to Git. The currently shared credential should be replaced through the owner's normal credential process before any production release. No credential is installed by this local implementation.

Provider endpoints: `mixed_companies/search`, `mixed_people/api_search`, `organizations/enrich`, `people/match`. Only supported structured filters are sent. Search is explicit and paged at 25 results, at most 500 pages. No prefetch or automatic retries. Organization search may cost one credit per page; people search has no search-credit cost. Individual enrichment may cost one credit. Personal-email reveal, phone unlock and waterfall are disabled. Actual billing remains Apollo's endpoint/account policy.

Normalized results are staged for ten minutes, scoped to actor/company/branch. They are not CRM records. A unique D1 reservation prevents simultaneous identical paid calls across isolates. A failed request clears its reservation; an abandoned reservation expires. Explicit subsequent searches and the existing daily retention cron purge expired stages. A crash can leave a reservation until expiry. No raw provider payload is persisted.

Import requires reviewed names and dedupe resolution. Customer evidence includes normalized name, company reference, domain, email and phone; contact evidence includes reviewed name, email and phone. Heuristics never silently merge identities. Search results may contain masked names; employees must verify the complete name or explicitly enrich. Import can create Customer/Contact plus an optional Lead and its existing Deal atomically. A receipt deduplicates provider identity within company/branch, including network retries. A later Lead for an already imported identity can be created through the normal Lead workflow.

Enrichment is optional and separate. Existing fields change only after a current-versus-suggested review and field selection. Empty values cannot overwrite CRM fields. A record version change requires re-review. Supplier costs, ownership, permissions and financial values cannot be supplied by enrichment.

Search failure states include invalid credentials, plan/API restriction, exhausted credits, rate limits, timeout, malformed provider results and unavailable service. CRM remains usable. No live enrichment is part of tests. The test named entrypoint supplies a fictional provider only when the Worker APP_URL is localhost; no request flag can enable it.

## Permissions and commercial calculations

Apollo is for existing authorized Sales/management roles with writable Leads and Customers. Buy costs and sourcing mutations are conservatively restricted to MD, Group Manager and Branch Manager, subject to Lead access and existing Supplier/Product module access. Every linked child is independently authorized. HR, IT, Accounts and ordinary Sales do not gain buy-cost visibility. The common session layer rejects deactivated users.

Supplier capability means recorded potential only, not confirmed availability, stock, a price or an offer. Matches require the Lead product and an active supplier/capability; recorded conflicting grade/origin is excluded. Missing fields remain unknown. Offers group by currency, price unit and Incoterm; there is no automatic winner or cross-group ranking.

Financial inputs are decimal strings with at most six places. Rational BigInt arithmetic extends each component and manual FX before rounding that component to cents, half away from zero. Landed cost is the sum of rounded supplier/freight/insurance/handling/bank/commission/other components. Margin is selling total minus landed cost; percentage divides by selling total. Invalid, negative, zero-quantity, incompatible-unit, missing/duplicate/nonpositive-FX and unsafe-range inputs are rejected. No implied unit conversion, density conversion or FX provider exists.

Quotation preparation requires a selected reviewed scenario and a current, non-declined, non-expired offer. It checks two-decimal unit prices, compatible existing quotation limits, USD/AED/EUR/SGD handoff currency and employee-entered quotation validity. Other supported scenario currencies require an explicitly converted, reviewed scenario before handoff. Only reviewed sell values and customer-facing terms enter the ordinary Draft quotation; private scenario notes and buy costs do not. Existing separate-manager approval and Accepted → Order/Shipment/Invoice logic remains authoritative. No margin-exception policy or second approval inbox is invented.

## Existing surfaces

Prospecting has a workspace entry and product/Lead-context entry with company/branch preserved. Deal execution shows sourcing, RFQs, offer comparisons, revisions, scenarios and quotation links. Supplier/Product history lists independently authorized offers, revisions, RFQs and related Deals. Global search includes neutral RFQ/offer labels without prices. Action Center adds deterministic sent-RFQ follow-up and offer-validity signals.

Existing explicit Deal AI and Sales Copilot receive authorized sourcing facts, untrusted notes and code-calculated scenario figures. They cannot select, price, approve, send or create business records. Passive views make zero Workers AI calls. No natural-language filter helper, per-result AI qualification, autonomous outreach, price-observation duplication or supplier scoring is introduced.

## Bounds and recovery

Commercial aggregates return at most 200 sourcing rows and 100 scenarios; history at most 100 offers and 100 RFQs. Dedupe checks at most 1,000 authorized customers and 5,000 scoped contacts, then requires human review. These are disclosed result windows, not global totals. External record descriptions remain untrusted provider claims.

Recovery adds an explicit `phase7` schema profile while pinning historical phase6 to migrations through 0013. SupplierOffer's self-reference is restored in ascending revision order; unrelated physical cycles still fail closed. The isolated-target checks and restore journal architecture are unchanged. After a separately approved release, backups require `BACKUP_SCHEMA_VERSION=phase7`; pre-0014 backups continue to use phase6. Never restore over an existing production database.

## Targeted verification

Use the three `tests/phase7-*.test.ts` files plus affected `tests/commercial.test.ts` and `tests/quotation.test.ts`, then typecheck and Cloudflare build. Run only `phase7.spec.ts` and `commercial.spec.ts` against the existing local Worker harness, with `COLLAB_TEST_NO_R2=1`, installed Chrome, and zero retries. `scripts/phase7-performance.ts` and `scripts/phase7-recovery-test.py` create only fictional local fixtures under ignored `work/phase7`. The implementation report records final counts, timings, D1 restore receipts and the candidate fingerprint.
