# Enercore AI — V1 Phase 1

Cloudflare Workers AI only. No other AI provider, no vector database, no embeddings, no transcription or recording analysis, and no document ingestion.

## Principles

1. **Enercore does the maths. The AI explains it.** Counts, totals, overdue days, stages and dates are computed in TypeScript over D1 and passed to the model as *facts*. Money is summed per currency and never converted.
2. **The AI can only see what the person can see.** Every tool re-checks access for the current request:
   - role;
   - module access (including `moduleAccess` overrides);
   - company and branch;
   - own-records-only roles;
   - Collaboration membership;
   - meeting authorisation.

   The model never queries D1 itself.
3. **Text people wrote is data, never instructions.** Notes, descriptions, Meeting Chat and Collaboration messages are:
   - sanitised;
   - fenced in `<untrusted>` blocks;
   - flagged if they read like instructions.
4. **The AI can't change anything.** It reads, summarises, drafts and recommends. Suggested changes are applied only after the person reviews them and selects **Apply change**. The browser then calls the ordinary `PATCH /api/records`, which checks rights, enforces workflow rules and writes the audit trail as that person's change.

## Architecture

```
UI (AI panel / workspace)
  └─ POST /api/ai/{lead|customer|meeting|conversation|ask}      src/app/api/ai/*
       aiEndpoint: employee session · same origin · not preview · rate limits
       └─ tool (permission-checked context builder)              src/lib/ai/tools/*
            readableRecords / requireMeeting / requireRead        (existing access rules)
            AiContext: FACTS · RECORDS · REFERENCES · UNTRUSTED   src/lib/ai/context.ts
       └─ gateway: Workers AI, JSON-schema output, zod-validated  src/lib/ai/gateway.ts
            primary → fallback model · 30 s timeout · usage log
       └─ reviewSuggestions: re-checks each suggestion            src/lib/ai/suggestions.ts
  ◄─ { answer, references, suggestions, flaggedText, model }
Apply (person's explicit choice) → PATCH /api/records (existing, audited)
```

| File | Role |
| --- | --- |
| `src/lib/ai/config.ts` | Models, limits, binding lookup. There is no AI in preview. |
| `src/lib/ai/sanitize.ts` | Secret redaction, clipping, prompt-injection detection, fencing. |
| `src/lib/ai/context.ts` | The context builder, references and prompt budget. |
| `src/lib/ai/schema.ts` | Answer and routing schemas (zod, sent as JSON Schema). |
| `src/lib/ai/gateway.ts` | Model calls, validation, rate limits, usage log. |
| `src/lib/ai/records.ts` | Readable records, per-currency totals. |
| `src/lib/ai/tools/crm.ts` | Lead AI, Customer 360. |
| `src/lib/ai/tools/management.ts` | Fixed management tools and keyword routing. |
| `src/lib/ai/tools/meetings-collab.ts` | Meeting and conversation summaries. |
| `src/lib/ai/suggestions.ts` | Validates suggestions and builds the exact records-API call. |
| `src/lib/ai/route.ts` | The shared endpoint wrapper. |
| `src/lib/ai/client.ts` | Browser calls, reference navigation. |
| `src/components/ai/*` | Answer panel, review dialog, AI workspace. |

## Models

Workers AI enforces the JSON schema while it generates the answer, but never shows the schema to the model. Every field is therefore required, and the prompt spells out the answer format (`ANSWER_FORMAT` / `ROUTE_FORMAT` in `schema.ts`). Without both, the models put everything into `summary`; this was verified against the real models.

Before validation, `prepareAnswer` tidies the raw JSON. It **drops** any suggestion type other than the three allowed, removes malformed references, and cuts over-long lists and text. The shape is then validated by zod.

- **Primary:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. It has strong instruction-following and supports JSON-schema `response_format`.
- **Fallback:** `@cf/meta/llama-4-scout-17b-16e-instruct`. It is used only if the primary errors, times out or returns invalid output.

Both run at temperature 0.2 with at most 1,400 output tokens. The context is capped at 24,000 characters and each untrusted block at 1,500 characters.

## Features

- **Lead AI.** Runs from the lead's detail view, using "Brief me on this lead". It produces:
  - a brief (stage n/8, value, age, idle days, whether the follow-up is overdue);
  - linked quotations and meetings;
  - risks and next actions;
  - a draft follow-up email;
  - at most 3 suggestions.
- **Customer 360.** Runs from the customer's detail view. It covers pipeline, order totals, outstanding and overdue receivables, and last activity, with money summed per currency and never combined.

  **Limitation — heuristic relationships.** Sales records have no `customerId` link yet. Related records are the ones in the same company whose name (the record title) matches this customer's name **exactly** after normalising case, spacing and punctuation, plus anything raised from them (quotation → order → shipment/invoice). There is no fuzzy matching: "Zephyr Lubricants LLC" is a different customer from "Zephyr Lubricants". If another customer record in the company has exactly the same name, even one the viewer can't see, **nothing is attributed** to either, because the histories can't be separated. The answer always says its relationships are name-based, and records are labelled `relationship=heuristic (name match)`. The fix is a real customer link, which this release deliberately doesn't add.
- **Management questions.** Asked in the Enercore AI workspace (sidebar). The model only *routes* the question to one fixed tool:
  - `pipeline_summary`;
  - `overdue_followups`;
  - `status_breakdown`;
  - `top_open_deals`;
  - `receivables`.

  Only the tools the person's modules allow are offered, and only their own companies are accepted as filters. If routing fails, a keyword router is used instead.
- **Meeting intelligence.** Runs from the Meeting Report. It uses attendance, the invited and absent lists, and the meeting's own chat. It says explicitly that there is no transcript or recording. Decisions and actions are listed only if the chat states them. Suggestions go only to the related CRM record, and only if the person can edit it.
- **Collaboration summary.** The ✦ button in a conversation header. It uses the latest page of messages, and every point cites the message it came from. It makes no suggestions and no drafts.

## Suggestions (human-approved)

Only three types exist, all checked on the server against the person's **current** rights:

| Type | Checks | Applied as |
| --- | --- | --- |
| `add_note` | The record was offered as a target, and `canWrite`. | `{action:"note"}`, tagged "Suggested by Enercore AI, reviewed by …" |
| `set_follow_up` | A valid date between today and one year ahead, and not the current date. | `{action:"note", due}` |
| `change_status` | Leads only; a real stage; a dry run of the CRM's own `transition()` passes. | `{action:"status"}` |

There are no suggestion types for delete, assign, approve, create an order, change a price or record a payment. They would be discarded.

## References

Every fact, record, message and meeting in the context has an id (`R1`, `R2`, …). The model may cite only those ids, and the server drops any others. In the UI, each reference opens its record, meeting (details or report) or conversation message through the workspace's normal navigation. That navigation re-checks access.

## Disclosures the model can't skip

Some statements are added by Enercore alongside every answer (the `scope` field), so they don't depend on the model:

- **Meeting:** "No transcript or recording is available — this is based only on attendance, meeting activity and the meeting chat (N messages)."
- **Conversation:** "Based on the N most recent messages only — older history wasn't included", or "Based on all N messages…".
- **Customer 360:** the name-based relationship caveat above.

Enercore's own computed figures (`figures`) are returned with the answer and shown as "Figures from Enercore". The model's text explains them; the figures themselves never come from the model.

## Usage, rate and capacity limits

- **Per person:** 20 requests per 10 minutes and 200 per day.
- **Whole company:** 3,000 per day.

These counters reuse the existing `LoginAttempt` counters. A management question makes up to two model calls (route, then answer) but counts as one request.

Every model attempt (primary or fallback) is logged in `AiUsage`: feature, model, status (`ok | invalid | error | timeout | limited`), duration, prompt and output sizes, token counts when Workers AI reports them, and the number of flagged blocks. The log **never** stores prompts, answers or CRM text. A failed attempt also writes an operational log line with the model and the provider's error text, never content.

**Quota.** A Workers AI account quota error (for example `4006` "daily free allocation" or `3036` "account limited") stops immediately, without trying the fallback, which runs on the same account. The user sees: "AI capacity has been reached for today. Your normal CRM workflows are still available." The company-wide daily limit shows the same message.

**Failures.** The primary model is tried, then the fallback **once**; there is never a loop. An error, a timeout (30 s) or invalid output on both gives a clear "try again" message.

## Configuration

- `wrangler.jsonc` sets `env.live.ai = { binding: "AI" }`. There is no binding in preview; with no binding, the AI is off and its buttons are hidden.
- Migration `drizzle/0010_ai_usage.sql` is additive: it adds the `AiUsage` table.

## Testing

- **Unit** (`tests/ai.test.ts`, `tests/ai-verification.test.ts`) covers:
  - the sanitiser: secrets removed, business values kept;
  - injection fencing;
  - GST dates and follow-up boundaries, including leap years;
  - answer tidying and references;
  - primary → fallback → error, timeouts and quota;
  - the rate-limit thresholds.
- **API and browser suites** (`e2e/collab/ai.spec.ts`, `ai-ui.spec.ts`) run against the built Worker and D1 in live mode. The `AI` binding is a local fake (`scripts/fake-ai-worker.ts`, test only) that records every prompt in the test database. That lets the suite prove exactly which records, and which fenced text, reached the model for each role, branch and company. Fictional data is in `e2e/collab/ai-data.ts`.
- **Preview** (`e2e/ai-preview.spec.ts`): no AI endpoints and no AI navigation.
- **Real-model checks** are run manually through a scratch Worker using the same model code with fictional context only; they are not part of CI.

---

# Phase 2 — Sales Copilot

Phase 2 is built on the Phase 1 gateway, tools, sanitiser, limits and suggestion flow, without replacing them.

## Layers

| Layer | File | AI? |
| --- | --- | --- |
| Sales Signals and priorities | `src/lib/sales/signals.ts` | No — pure, deterministic |
| Commercial Requirement Profile | `src/lib/sales/requirements.ts` | Extraction only, verified |
| Draft and suggestion safety | `src/lib/sales/safety.ts` | No — runs after the model |
| Output schemas | `src/lib/ai/sales-schema.ts`, `src/lib/sales/sections.ts` | — |
| Tools | `src/lib/ai/tools/sales.ts`, `tools/management.ts` | Explain / extract / draft |
| API | `src/app/api/ai/sales/[task]/route.ts` | GET: no · POST: yes |
| UI | `src/components/ai/sales-copilot.tsx` | On request only |

## Sales Signals (deterministic)

| Signal | Rule |
| --- | --- |
| `FOLLOW_UP_OVERDUE` | An open lead's `due` is before today (GST). |
| `FOLLOW_UP_TODAY` | An open lead's `due` is today. |
| `LEAD_GONE_QUIET` | An open lead with no update or note for 14+ days. |
| `NEGOTIATION_STALLED` | A lead in Negotiation idle for 7+ days. |
| `HIGH_VALUE_NO_NEXT_ACTION` | An open lead over the value threshold for its currency (USD 50k, EUR 45k, SGD 65k, AED 180k) with no follow-up date. |
| `REQUIREMENT_INCOMPLETE` | A lead at Qualified or Negotiation with no product, quantity or destination. |
| `QUOTATION_WAITING` | A quotation that is Sent with no activity for 3+ days. |
| `QUOTATION_EXPIRING` | A Sent or Approved quotation whose validity ends within 7 days. |
| `QUOTATION_EXPIRED` | A Sent or Approved quotation whose validity has passed. |
| `MEETING_TODAY` | A scheduled or live meeting linked to the record, dated today. |
| `MEETING_OUTCOME_MISSING` | A linked meeting ended in the last 14 days with no note on the record since. |

Priorities are records with at least one signal, ranked by a fixed score: the strongest signal, plus 5 for each additional signal, plus a value boost. At most 10 are shown. The AI only explains an item and picks its action from that item's allowed actions; it never ranks.

**Next best action.** Enercore computes an ordered candidate list from the signals, stage, quotation and meeting state, and missing information. The model may pick one of those candidates and write a one-sentence "why". Anything else falls back to the first candidate, with a "why" built from the facts.

## Commercial Requirement Profile

The profile is derived on each request and not stored; there is no new table.

- **Recorded values** come from the lead's fields and from its quotations (Incoterm, payment terms, line packaging).
- **Stated values** are extracted by the model from notes and meeting chat. Each must quote its evidence, and the server keeps a value only if that evidence is found in the cited block and supports the value.
- **Conflicts.** Different values for the same field are shown as "Conflicting information" with every source; none is chosen.
- **Missing information** is the list of fields a quotation needs (product, quantity, destination, Incoterm, packaging, payment terms, delivery timeline) that have no value. Price, freight, availability and validity are always set by the seller and are never proposed by the AI.

## Commercial claim status

A value that is mentioned is not a confirmed commercial fact. Every requirement value carries its **source** and a **status**:

| Status | Meaning | Example |
| --- | --- | --- |
| `recorded` | A CRM field, or Enercore's own quotation | Lead field · Quantity |
| `confirmed` / `agreed` | The text says it was confirmed or agreed | "We agreed on LC at sight." |
| `requested` | The customer asks for or needs it (including a target price) | "We require CIF Mombasa.", "Our target is USD 800." |
| `preferred` | "We prefer…" | "We prefer LC at sight." |
| `proposed` | Our side offered it | "We can offer FOB Jebel Ali." |
| `discussed` | A question or a mention only | "Can you do LC at sight?", "Can you supply 500 MT?" |

- **Status cap.** The model proposes a status, but it is capped by what the value's own sentence says (`statusFromSentence`). A question or a request can never become "agreed", and "have not agreed" is read as discussed.
- **Readiness buckets.** Quotation readiness uses four: **known / confirmed**, **requested / discussed — not confirmed**, **missing**, **conflicting**.
- **Commercial terms** (Incoterm, payment terms, target price, delivery timeline) are never taken as Enercore's acceptance:
  - a quotation draft is pre-filled with them only when recorded or agreed;
  - a post-meeting review never writes a merely requested term onto the lead;
  - meeting prep asks "…can we agree it?".
- **What to quote** (product, quantity, destination, packaging) may follow the customer's request.
- **Drafts** may acknowledge a request ("We noted your request for LC at sight") but never confirm it. Sentences that confirm, accept or agree to a requested value, or say it "is fine", are removed after the model answers.

## Drafts

- **Channels:** email, WhatsApp or general message.
- **Tones:** professional (the default), concise or warm.
- **Model:** the fast model.
- **Safety filter:** after the model answers, the server removes any sentence that claims stock or availability, guaranteed delivery, a confirmed price or offer, or accepted payment terms. It also removes any money amount not found in the context. Removals are listed to the user.
- **Nothing is sent.** The user can Copy the draft, edit it, or use it as a note (the ordinary records API).

## Post-meeting workflow

For an ended meeting linked to a lead, **Review outcome** produces:

- what happened, decisions, requirements mentioned, action items and the next step;
- the scope line "No transcript is available. This summary uses meeting details and Meeting Chat.";
- a checklist of suggested updates:
  - **Outcome note** — pre-ticked. Composed by Enercore and labelled as coming from the meeting chat.
  - **Follow-up date** — pre-ticked.
  - **Requirement update** — pre-ticked. The lead's fields, applied as the ordinary edit, guarded by the record version seen when it was suggested.
  - **Status change** — never pre-ticked.

Apply selected goes through `PATCH /api/records`, as the person, and is audited.

## Quotation preparation

This shows the profile, what is missing, any conflicts, and the "set by you" fields. **Create quotation draft** is enabled only when product and quantity are settled (known and not conflicting). It opens the normal quotation form pre-filled with settled values only, with a unit price of 0. The person reviews, prices and saves it; nothing is approved or sent.

## Manager tools and search

These are added to the fixed tool catalogue:

- `leads_attention`
- `quotations_waiting`
- `high_value_no_next_action`
- `search`

`search` checks structured fields first (title, product, destination and country, contact, packaging, Incoterm), then notes. It uses a small synonym list (asphalt ↔ bitumen). The pipeline answer now includes quiet, stalled and waiting counts, and no forecast.

Anything grouped by person is reported as operational facts. The system rules forbid judging or ranking people.

## Model routing, cost and freshness

- **Primary tier** (70B, with Scout as fallback): lead brief, requirement extraction, customer brief and 360, meeting prep, post-meeting review.
- **Fast tier** (`@cf/meta/llama-3.1-8b-instruct-fast`, with the primary as fallback): drafts and priority explanations.
- **No model** for signals, priorities, lead intelligence (GET) or quotation preparation (which reuses the cached extraction).
- **Cache.** Identical requests from the same person reuse the answer for 30 minutes from the edge cache. The key is a hash of exactly what the model would see, so any change to a record, note, message or meeting, or a new day, produces a fresh answer. Cache hits are logged as `cached` in `AiUsage` and still count toward the rate limits.
- **No background AI.** AI never runs on page load, per record, or in a loop. My Day shows deterministic signals only.

## Safety additions

- **Rules:** proposals are written in future tense, nothing is claimed as done unless the CRM records it, and people are never judged.
- **Completed-event claims** ("email sent", "customer agreed") in AI text, suggestions or next actions are dropped unless the context records them.
- **"Tell the AI to…"** and **"mark this lead Won"** are flagged as injection. While any flagged text is present, no status change is proposed.

## Schema

There is **no new migration.** `AiUsage.status` can now also be `cached`, and there are two new nullable token columns. Those columns are part of migration 0010, which Phase 1 already applied.
